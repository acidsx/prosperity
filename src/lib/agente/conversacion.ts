/**
 * Agente conversacional: qué hacer con un mensaje entrante.
 *
 * Orden de decisión, de lo más determinante a lo más interpretable:
 *   1. ¿Ya procesamos este mensaje? (los webhooks se reintentan)
 *   2. ¿Pidió que no le escribamos más? Eso manda sobre todo.
 *   3. ¿Hay que escalar a una persona? (precio, reclamo, pide humano)
 *   4. ¿Trae documentos adjuntos?
 *   5. ¿Tocó un botón de plantilla? El identificador ya dice la intención.
 *   6. Recién ahí se interpreta el texto libre.
 */

import "server-only";

import { clasificarIntencion, responderConversacion } from "@/lib/agente/claude";
import { gestionarLead } from "@/lib/agente/gestor";
import {
  detectarObjecion,
  ETIQUETA_OBJECION,
  responderObjecion,
  type TipoObjecion,
} from "@/lib/agente/objeciones";
import {
  intencionDeBoton,
  intencionHeuristica,
  type Intencion,
  type LecturaIntencion,
} from "@/lib/agente/intencion";
import { tienda } from "@/lib/datos";
import { nuevoId } from "@/lib/datos/tienda";
import { clasificarAdjunto, documento } from "@/lib/documentos/catalogo";
import {
  correoSolicitud,
  crearSolicitud,
  nombresDe,
  persistirSolicitud,
  registrarRecepcion,
} from "@/lib/documentos/solicitud";
import { bloquesDisponibles, formatearFecha, valorUf } from "@/lib/dominio/chile";
import { capacidadCompra } from "@/lib/dominio/financiamiento";
import { nuevaVisita, nuevoLead, nuevoMensaje } from "@/lib/dominio/fabricas";
import type { Actividad, Lead, SolicitudDocumentos, Visita } from "@/lib/dominio/tipos";
import { correoDesdeEntorno } from "@/lib/mensajeria/correo";
import { despachar } from "@/lib/mensajeria/despachador";
import { ejerceDerechos, motivoDeEscalamiento, pideBaja } from "@/lib/mensajeria/politica";
import type { Entrante } from "@/lib/mensajeria/tipos";

export const FIRMA = process.env.GESTOR_FIRMA ?? "Equipo Comercial";
const NOMBRE_CORREDORA = process.env.NOMBRE_CORREDORA ?? "la corredora";

export interface ResultadoConversacion {
  leadId: string | null;
  intencion: Intencion | "duplicado" | "documentos" | "escalado" | "opt_out";
  accion: string;
  respondio: boolean;
  avisos: string[];
}

async function registrar(
  leadId: string | null,
  tipo: Actividad["tipo"],
  detalle: string,
  autor: Actividad["autor"] = "agente",
): Promise<void> {
  await tienda().registrarActividad({
    id: nuevoId("act"),
    leadId,
    tipo,
    detalle,
    autor,
    ocurridaEn: new Date().toISOString(),
  });
}

/** Calza el mensaje con un lead: por token de solicitud, teléfono o correo. */
async function identificar(entrante: Entrante): Promise<Lead | null> {
  const db = tienda();

  if (entrante.token) {
    const solicitud = await db.solicitudPorToken(entrante.token);
    if (solicitud) {
      const lead = await db.obtenerLead(solicitud.leadId);
      if (lead) return lead;
    }
  }

  return db.buscarLeadPorContacto(
    entrante.canal === "whatsapp" ? { telefono: entrante.de } : { email: entrante.de },
  );
}

/** Un desconocido que escribe es un lead nuevo, no un mensaje que se descarta. */
async function crearLeadDesdeMensaje(entrante: Entrante): Promise<Lead> {
  const lead = nuevoLead({
    nombre: entrante.nombreRemitente ?? (entrante.canal === "whatsapp" ? `WhatsApp ${entrante.de}` : entrante.de),
    telefono: entrante.canal === "whatsapp" ? entrante.de : null,
    email: entrante.canal === "email" ? entrante.de : null,
    canal: entrante.canal === "whatsapp" ? "whatsapp" : "sitio_web",
    mensajeInicial: entrante.texto || "(mensaje sin texto)",
    ultimoEntranteEn: entrante.recibidoEn,
  });
  await tienda().crearLead(lead);
  await registrar(lead.id, "lead_ingresado", `Lead creado desde un mensaje entrante por ${entrante.canal}`);
  return lead;
}

async function guardarEntrante(lead: Lead, entrante: Entrante): Promise<void> {
  const db = tienda();
  await db.guardarMensaje(
    nuevoMensaje({
      leadId: lead.id,
      direccion: "entrante",
      canal: entrante.canal === "whatsapp" ? "whatsapp" : "email",
      cuerpo: entrante.texto || (entrante.adjuntos.length > 0 ? "(adjuntos sin mensaje)" : "(sin contenido)"),
      idProveedor: entrante.idProveedor,
      estado: "entregado",
      asunto: entrante.asunto,
      enviadoEn: entrante.recibidoEn,
    }),
  );
  // Reabre la ventana de 24 horas de WhatsApp.
  await db.actualizarLead(lead.id, { ultimoEntranteEn: entrante.recibidoEn });
  await registrar(lead.id, "mensaje_recibido", `Mensaje por ${entrante.canal}`);
}

function formatoHorario(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Santiago",
  });
}

async function visitaVigente(leadId: string): Promise<Visita | null> {
  const visitas = await tienda().listarVisitas();
  return (
    visitas
      .filter((visita) => visita.leadId === leadId && ["propuesta", "confirmada"].includes(visita.estado))
      .sort((a, b) => a.inicio.localeCompare(b.inicio))[0] ?? null
  );
}

async function moverEstado(leadId: string, estado: "scheduled" | "furtherOn" | "reschedule"): Promise<void> {
  const db = tienda();
  const oportunidad = await db.oportunidadDeLead(leadId);
  if (!oportunidad || oportunidad.estado === estado) return;
  await db.guardarOportunidad({
    ...oportunidad,
    estado,
    actualizadaEn: new Date().toISOString(),
  });
  await registrar(leadId, "estado_cambiado", `Pasó a ${estado} por respuesta del comprador`);
}

async function responder(
  lead: Lead,
  texto: string,
  opciones: {
    canal?: "whatsapp" | "email";
    alternativaPlantilla?: { plantilla: string; variables: string[] };
    asunto?: string;
    objecion?: TipoObjecion;
  } = {},
): Promise<boolean> {
  const canal = opciones.canal ?? (lead.telefono ? "whatsapp" : "email");
  const salida =
    canal === "email"
      ? ({
          tipo: "correo" as const,
          asunto: opciones.asunto ?? "Sobre tu consulta",
          html: `<p>${texto.replace(/\n/g, "<br>")}</p>`,
          texto,
        })
      : ({ tipo: "texto" as const, cuerpo: texto });

  const despacho = await despachar({
    leadId: lead.id,
    canal,
    salida,
    // Contesta algo que el comprador acaba de escribir: no se guarda para
    // mañana por el horario hábil.
    esRespuesta: true,
    alternativaPlantilla: opciones.alternativaPlantilla,
    objecion: opciones.objecion,
  });
  return despacho.resultado !== null;
}

/** Deja la conversación en manos de una persona y avisa al comprador. */
async function escalar(lead: Lead, motivo: string): Promise<void> {
  await tienda().actualizarLead(lead.id, { enManosDeHumano: true });
  await registrar(lead.id, "derivado_a_humano", `Escalado por ${motivo}`);
}

async function procesarAdjuntos(
  lead: Lead,
  entrante: Entrante,
): Promise<{ accion: string; avisos: string[] } | null> {
  if (entrante.adjuntos.length === 0) return null;

  const db = tienda();
  const solicitud = await db.solicitudDeLead(lead.id);
  if (!solicitud) {
    await registrar(
      lead.id,
      "documentos_recibidos",
      `Llegaron ${entrante.adjuntos.length} adjuntos sin una solicitud previa: los revisa una persona`,
    );
    return {
      accion: "adjuntos sin solicitud, derivados a revisión",
      avisos: ["Llegaron adjuntos sin solicitud previa"],
    };
  }

  const recepcion = registrarRecepcion(solicitud, entrante.adjuntos, entrante.idProveedor, clasificarAdjunto);
  const detalle =
    recepcion.reconocidos.length > 0
      ? `Recibidos: ${nombresDe(recepcion.reconocidos)}${
          recepcion.faltantes.length > 0 ? `. Faltan: ${nombresDe(recepcion.faltantes)}` : ". Solicitud completa"
        }`
      : `Llegaron ${entrante.adjuntos.length} adjuntos que no se pudieron identificar`;

  await persistirSolicitud(recepcion.solicitud, detalle, "documentos_recibidos");

  const avisos: string[] = [];
  if (recepcion.sinClasificar.length > 0) {
    avisos.push(
      `${recepcion.sinClasificar.length} adjunto(s) sin clasificar: ${recepcion.sinClasificar
        .map((adjunto) => adjunto.nombre ?? adjunto.mime)
        .join(", ")}`,
    );
  }

  const acuse =
    recepcion.reconocidos.length === 0
      ? `Recibí tus archivos, ${lead.nombre.split(" ")[0]}. Los estoy revisando y te confirmo si falta algo.`
      : recepcion.faltantes.length === 0
        ? `Listo ${lead.nombre.split(" ")[0]}, ya tengo todos los documentos. Los presento al banco y te aviso en cuanto tenga la preaprobación.`
        : `Gracias ${lead.nombre.split(" ")[0]}, recibí ${nombresDe(recepcion.reconocidos)}. Todavía me falta ${nombresDe(
            recepcion.faltantes,
          )}.`;

  await responder(lead, acuse, {
    canal: entrante.canal === "email" ? "email" : "whatsapp",
    asunto:
      recepcion.faltantes.length === 0
        ? "Documentos recibidos: carpeta completa"
        : "Documentos recibidos, falta lo que te indico",
    alternativaPlantilla:
      recepcion.faltantes.length > 0
        ? { plantilla: "documentos_pendientes", variables: [lead.nombre.split(" ")[0], nombresDe(recepcion.faltantes)] }
        : undefined,
  });

  return { accion: detalle, avisos };
}

async function enviarSolicitudDocumentos(lead: Lead): Promise<string> {
  const db = tienda();
  const existente = await db.solicitudDeLead(lead.id);
  const solicitud: SolicitudDocumentos = existente ?? crearSolicitud(lead);

  if (!lead.email) {
    await escalar(lead, "hay que pedirle documentos y no tenemos su correo");
    return "sin correo: derivado a una persona";
  }

  const oportunidad = await db.oportunidadDeLead(lead.id);
  const proyectoId = oportunidad?.proyectoId ?? null;
  const proyecto = proyectoId ? await db.obtenerProyecto(proyectoId) : null;

  const correo = correoSolicitud(lead, solicitud, {
    firma: FIRMA,
    proyecto: proyecto?.nombre,
  });

  const cliente = correoDesdeEntorno();
  const despacho = await despachar({
    leadId: lead.id,
    canal: "email",
    salida: {
      tipo: "correo",
      asunto: correo.asunto,
      html: correo.html,
      texto: correo.texto,
      // Alias con token: así la respuesta calza aunque venga de otra casilla.
      responderA: cliente?.aliasRespuesta(solicitud.token),
    },
    esRespuesta: true,
  });

  await persistirSolicitud(
    solicitud,
    `Solicitud de ${solicitud.documentos.length} documentos enviada a ${lead.email}`,
    "documentos_solicitados",
  );

  // Aviso por WhatsApp de que el correo salió: el correo se lee menos.
  if (lead.telefono) {
    await despachar({
      leadId: lead.id,
      canal: "whatsapp",
      salida: {
        tipo: "texto",
        cuerpo: `Te envié a ${lead.email} el detalle de los ${solicitud.documentos.length} documentos que pide el banco. Cuando los tengas, respondes ese correo con los archivos adjuntos.`,
      },
      alternativaPlantilla: {
        plantilla: "documentos_solicitados",
        variables: [lead.nombre.split(" ")[0], lead.email, String(solicitud.documentos.length)],
      },
    });
  }

  return despacho.resultado?.enviado
    ? `solicitud enviada a ${lead.email}`
    : `solicitud preparada para ${lead.email} (${despacho.resultado?.motivo ?? "no enviada"})`;
}

/**
 * Responde una duda u objeción con hechos y ofrece un paso concreto.
 *
 * Cuenta cuántas veces ya se abordó la misma objeción para no insistir: el
 * límite vive en `responderObjecion`, acá solo se le entrega el conteo.
 */
async function manejarObjecion(
  lead: Lead,
  objecion: TipoObjecion,
  canal: "whatsapp" | "email",
): Promise<{ respondio: boolean; detalle: string }> {
  const db = tienda();
  const [oportunidad, mensajes, uf] = await Promise.all([
    db.oportunidadDeLead(lead.id),
    db.listarMensajes(lead.id),
    valorUf(),
  ]);

  const calificacion = oportunidad?.calificacion ?? null;
  const capacidad = capacidadCompra(calificacion?.perfil ?? lead.perfil, uf.valor);

  const proyecto = oportunidad?.proyectoId ? await db.obtenerProyecto(oportunidad.proyectoId) : null;
  const modelo = proyecto?.modelos.find((item) => item.name === oportunidad?.modelo);

  const vecesTratada = mensajes.filter((mensaje) => mensaje.objecion === objecion).length;

  const respuesta = responderObjecion(objecion, {
    primerNombre: lead.nombre.split(" ")[0],
    capacidad,
    valorUfClp: uf.valor,
    precioUf: modelo?.priceFinal ?? oportunidad?.valorUf ?? proyecto?.precioDesdeUf ?? null,
    proyecto: proyecto?.nombre ?? null,
    comuna: proyecto?.comuna ?? null,
    gastosComunesClp: null,
    vecesTratada,
    nombreCorredora: NOMBRE_CORREDORA,
  });

  const texto = [respuesta.texto, respuesta.siguientePaso].filter(Boolean).join("\n\n");
  const respondio = await responder(lead, texto, { canal, objecion });

  await registrar(
    lead.id,
    "mensaje_enviado",
    `Objeción "${ETIQUETA_OBJECION[objecion]}" respondida${
      vecesTratada > 0 ? ` (intento ${vecesTratada + 1})` : ""
    }${respuesta.seDetiene ? " · el agente deja de insistir" : ""}`,
  );

  if (respuesta.escala) {
    await escalar(lead, `duda que conviene que tome una persona: ${ETIQUETA_OBJECION[objecion]}`);
  }

  return {
    respondio,
    detalle: respuesta.seDetiene
      ? `objeción ${objecion}: se deja de insistir`
      : `objeción ${objecion} respondida`,
  };
}

export async function procesarEntrante(entrante: Entrante): Promise<ResultadoConversacion> {
  const db = tienda();
  const avisos: string[] = [];

  // 1. Los webhooks se reintentan: el mismo mensaje puede llegar dos veces.
  const yaVisto = await db.mensajePorIdProveedor(entrante.idProveedor);
  if (yaVisto) {
    return {
      leadId: yaVisto.leadId,
      intencion: "duplicado",
      accion: "mensaje ya procesado",
      respondio: false,
      avisos: [],
    };
  }

  let lead = await identificar(entrante);
  let esNuevo = false;
  if (!lead) {
    lead = await crearLeadDesdeMensaje(entrante);
    esNuevo = true;
  }

  await guardarEntrante(lead, entrante);
  lead = (await db.obtenerLead(lead.id))!;

  // 2. El opt-out manda sobre todo lo demás.
  if (pideBaja(entrante.texto)) {
    await db.actualizarLead(lead.id, { optOut: true, optOutEn: new Date().toISOString() });
    await registrar(lead.id, "opt_out", `Pidió no recibir más mensajes: "${entrante.texto.slice(0, 80)}"`);

    if (ejerceDerechos(entrante.texto)) {
      await escalar(lead, "ejercicio de derechos sobre sus datos");
      avisos.push("Solicitud de derechos de datos: hay plazo legal para responderla");
    }
    // Un último acuse, dentro de la ventana que abrió su propio mensaje.
    // Va como no automático para que los topes no lo bloqueen: confirmar una
    // baja es obligación, no seguimiento comercial.
    const acuseBaja = "Listo, no te volvemos a escribir. Si más adelante quieres retomar la búsqueda, nos escribes cuando quieras.";
    await despachar({
      leadId: lead.id,
      canal: entrante.canal === "email" ? "email" : "whatsapp",
      salida:
        entrante.canal === "email"
          ? {
              tipo: "correo",
              asunto: "Listo, no te volvemos a escribir",
              html: `<p>${acuseBaja}</p>`,
              texto: acuseBaja,
            }
          : { tipo: "texto", cuerpo: acuseBaja },
      esRespuesta: true,
      automatico: false,
    });

    return { leadId: lead.id, intencion: "opt_out", accion: "baja registrada", respondio: true, avisos };
  }

  // 3. Situaciones que no debe seguir manejando el agente.
  const motivoEscalamiento = motivoDeEscalamiento(entrante.texto);
  if (motivoEscalamiento) {
    // El aviso sale antes de marcar la conversación: una vez marcada, el
    // freno de "la lleva una persona" bloquearía este mismo mensaje.
    const respondio = await responder(
      lead,
      `Dale, ${lead.nombre.split(" ")[0]}, eso lo ve directamente un ejecutivo del equipo. Te contactan hoy mismo.`,
      { canal: entrante.canal === "email" ? "email" : "whatsapp" },
    );
    await escalar(lead, motivoEscalamiento);
    return {
      leadId: lead.id,
      intencion: "escalado",
      accion: `escalado por ${motivoEscalamiento}`,
      respondio,
      avisos,
    };
  }

  // Si una persona ya tomó la conversación, el agente registra y se queda callado.
  if (lead.enManosDeHumano) {
    return {
      leadId: lead.id,
      intencion: "otro",
      accion: "la conversación la lleva una persona",
      respondio: false,
      avisos,
    };
  }

  // 4. Documentos adjuntos.
  const conAdjuntos = await procesarAdjuntos(lead, entrante);
  if (conAdjuntos) {
    return {
      leadId: lead.id,
      intencion: "documentos",
      accion: conAdjuntos.accion,
      respondio: true,
      avisos: [...avisos, ...conAdjuntos.avisos],
    };
  }

  // Un lead nuevo que escribe de la nada se califica primero, como cualquier consulta.
  if (esNuevo) {
    try {
      const resultado = await gestionarLead(lead.id);
      return {
        leadId: lead.id,
        intencion: "otro",
        accion: `lead nuevo calificado (${resultado.calificacion.puntaje}/100)`,
        respondio: true,
        avisos: [...avisos, ...resultado.avisos],
      };
    } catch (error) {
      avisos.push(`No se pudo calificar: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 5. Dudas y objeciones. Van antes de interpretar la intención porque un
  // comprador que duda no está pidiendo nada: está evaluando, y eso se
  // responde distinto.
  const porBoton = intencionDeBoton(entrante.token);
  if (!porBoton) {
    const objecion = detectarObjecion(entrante.texto);
    if (objecion) {
      const resultado = await manejarObjecion(
        lead,
        objecion,
        entrante.canal === "email" ? "email" : "whatsapp",
      );
      return {
        leadId: lead.id,
        intencion: "otro",
        accion: resultado.detalle,
        respondio: resultado.respondio,
        avisos,
      };
    }
  }

  // 6. Botón de plantilla: la intención viene explícita.
  let lectura: LecturaIntencion;
  if (porBoton) {
    lectura = {
      intencion: porBoton,
      preferenciaHorario: null,
      pregunta: null,
      urgente: false,
      resumen: `Tocó el botón ${entrante.token}`,
    };
  } else {
    // 7. Texto libre.
    try {
      lectura = await clasificarIntencion(lead, entrante.texto);
    } catch (error) {
      lectura = intencionHeuristica(entrante.texto);
      avisos.push(
        `Intención por heurística: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const primerNombre = lead.nombre.split(" ")[0];
  const formato = formatoHorario();

  switch (lectura.intencion) {
    case "confirma_visita": {
      const visita = await visitaVigente(lead.id);
      if (!visita) {
        const respondio = await responder(
          lead,
          `Gracias ${primerNombre}. Todavía no tengo una visita reservada a tu nombre: ¿qué día te acomoda?`,
        );
        return { leadId: lead.id, intencion: lectura.intencion, accion: "no había visita por confirmar", respondio, avisos };
      }
      await db.actualizarVisita(visita.id, {
        estado: "confirmada",
        confirmadaEn: new Date().toISOString(),
      });
      await moverEstado(lead.id, "scheduled");
      await registrar(lead.id, "visita_confirmada", `Confirmada para el ${formatearFecha(visita.inicio)}`);
      const proyecto = await db.obtenerProyecto(visita.proyectoId);
      const respondio = await responder(
        lead,
        `Perfecto ${primerNombre}, queda confirmada la visita a ${proyecto?.nombre ?? "el proyecto"} el ${formato.format(
          new Date(visita.inicio),
        )}${proyecto?.direccion ? `. La dirección es ${proyecto.direccion}` : ""}. Cualquier cambio, me escribes.`,
      );
      return { leadId: lead.id, intencion: lectura.intencion, accion: "visita confirmada", respondio, avisos };
    }

    case "reagendar": {
      const visita = await visitaVigente(lead.id);
      const bloques = bloquesDisponibles(new Date(), 3);
      if (visita) {
        await db.actualizarVisita(visita.id, {
          estado: "propuesta",
          inicio: bloques[0].inicio.toISOString(),
          fin: bloques[0].fin.toISOString(),
          confirmadaEn: null,
          notas: `Reagendada a pedido del comprador${lectura.preferenciaHorario ? `: "${lectura.preferenciaHorario}"` : ""}`,
        });
        await registrar(lead.id, "visita_reagendada", `Nueva propuesta: ${formatearFecha(bloques[0].inicio.toISOString())}`);
      } else if (bloques.length > 0) {
        const oportunidad = await db.oportunidadDeLead(lead.id);
        if (oportunidad?.proyectoId) {
          await db.guardarVisita(
            nuevaVisita({
              leadId: lead.id,
              proyectoId: oportunidad.proyectoId,
              inicio: bloques[0].inicio.toISOString(),
              fin: bloques[0].fin.toISOString(),
              notas: "Propuesta tras pedido de reagendamiento",
            }),
          );
        }
      }
      await moverEstado(lead.id, "reschedule");
      const opciones = bloques.slice(0, 2).map((bloque) => formato.format(bloque.inicio));
      const respondio = await responder(
        lead,
        `Sin problema ${primerNombre}. Tengo ${opciones.join(" o ")}. ¿Cuál te acomoda?`,
      );
      return { leadId: lead.id, intencion: lectura.intencion, accion: "nuevos horarios propuestos", respondio, avisos };
    }

    case "cancelar": {
      const visita = await visitaVigente(lead.id);
      if (visita) {
        await db.actualizarVisita(visita.id, { estado: "cancelada", confirmadaEn: null });
      }
      await moverEstado(lead.id, "furtherOn");
      await registrar(lead.id, "estado_cambiado", "El comprador canceló la visita");
      const respondio = await responder(
        lead,
        `Listo ${primerNombre}, cancelo la visita. Si más adelante quieres retomar, me escribes y la reagendamos.`,
      );
      return { leadId: lead.id, intencion: lectura.intencion, accion: "visita cancelada", respondio, avisos };
    }

    case "consulta_documentos":
    case "enviara_documentos": {
      const accion = await enviarSolicitudDocumentos(lead);
      return { leadId: lead.id, intencion: lectura.intencion, accion, respondio: true, avisos };
    }

    case "pregunta_precio":
    case "pregunta_general":
    case "saludo":
    case "otro": {
      const oportunidad = await db.oportunidadDeLead(lead.id);
      const proyecto = oportunidad?.proyectoId ? await db.obtenerProyecto(oportunidad.proyectoId) : null;
      const historial = (await db.listarMensajes(lead.id))
        .sort((a, b) => a.enviadoEn.localeCompare(b.enviadoEn) || a.id.localeCompare(b.id))
        .slice(-8)
        .map((mensaje) => ({ direccion: mensaje.direccion, cuerpo: mensaje.cuerpo }));
      const uf = await valorUf();

      let texto: string;
      try {
        texto = await responderConversacion({
          lead,
          historial,
          proyecto: proyecto
            ? [
                `${proyecto.nombre}, ${proyecto.comuna}`,
                proyecto.precioDesdeUf ? `desde UF ${proyecto.precioDesdeUf}` : null,
                proyecto.reservaClp ? `reserva $${proyecto.reservaClp.toLocaleString("es-CL")}` : null,
                proyecto.entrega ? `entrega ${proyecto.entrega} ${proyecto.anoEntrega ?? ""}` : null,
                proyecto.tags.length ? `beneficios: ${proyecto.tags.join(", ")}` : null,
                proyecto.modelos.length
                  ? `tipologías: ${proyecto.modelos.map((modelo) => `${modelo.name} ${modelo.rooms}D${modelo.bathrooms}B UF ${modelo.priceFinal}`).join("; ")}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : null,
          pregunta: entrante.texto,
          valorUfClp: uf.valor,
        });
      } catch (error) {
        // Sin modelo no se improvisa una respuesta a una pregunta abierta:
        // la toma una persona.
        avisos.push(
          `Pregunta derivada a una persona: ${error instanceof Error ? error.message : String(error)}`,
        );
        const respondio = await responder(
          lead,
          `Gracias ${primerNombre}, le paso tu consulta a un ejecutivo del equipo y te responde a la brevedad.`,
        );
        await escalar(lead, "pregunta abierta sin modelo disponible para responder");
        return { leadId: lead.id, intencion: lectura.intencion, accion: "derivado a una persona", respondio, avisos };
      }

      const respondio = await responder(lead, texto);
      return { leadId: lead.id, intencion: lectura.intencion, accion: "consulta respondida", respondio, avisos };
    }

    case "pide_humano": {
      const respondio = await responder(
        lead,
        `Claro ${primerNombre}, un ejecutivo te contacta hoy. ¿Prefieres que te llamen o por acá?`,
      );
      await escalar(lead, "pidió hablar con una persona");
      return { leadId: lead.id, intencion: lectura.intencion, accion: "escalado a una persona", respondio, avisos };
    }

    case "opt_out": {
      await db.actualizarLead(lead.id, { optOut: true, optOutEn: new Date().toISOString() });
      await registrar(lead.id, "opt_out", "Pidió no recibir más mensajes");
      return { leadId: lead.id, intencion: "opt_out", accion: "baja registrada", respondio: false, avisos };
    }
  }
}

/** Documentos que faltan por lead, para los recordatorios. */
export async function solicitudesIncompletas(): Promise<
  Array<{ solicitud: SolicitudDocumentos; faltantes: string }>
> {
  const solicitudes = await tienda().listarSolicitudes();
  return solicitudes
    .filter((solicitud) => solicitud.estado !== "completa")
    .map((solicitud) => ({
      solicitud,
      faltantes: solicitud.documentos
        .filter((pedido) => pedido.recibidoEn === null && (documento(pedido.documento)?.obligatorio ?? false))
        .map((pedido) => documento(pedido.documento)?.nombre ?? pedido.documento)
        .join(", "),
    }));
}
