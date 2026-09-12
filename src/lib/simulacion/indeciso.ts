/**
 * Simulación de un comprador indeciso, temeroso y lleno de dudas.
 *
 * La venta fácil ya está simulada en `venta.ts`: alguien que sabe lo que
 * quiere, puede pagarlo y confirma la visita al primer mensaje. Ese no es el
 * comprador habitual. El habitual es este: no tiene claro qué busca, le da
 * miedo endeudarse a 25 años, pregunta qué pasa si pierde la pega, encuentra
 * todo caro, está mirando otras opciones y desconfía de que esto sea serio.
 *
 * Lo que esta simulación muestra no es que el agente convenza. Es cómo
 * convence y dónde se detiene:
 *
 *  - descubre antes de recomendar, en vez de tirar un catálogo;
 *  - responde cada miedo con un número verificable (el dividendo que sale de
 *    su renta, el arriendo de mercado, lo que cubre el seguro de cesantía);
 *  - cuando la unidad está sobre lo que el banco le va a prestar, lo dice y
 *    ofrece algo en su rango, en vez de empujar;
 *  - pasa la desconfianza a una persona del equipo;
 *  - a la tercera vez que aparece el mismo miedo, deja de insistir.
 *
 * Cada respuesta del agente sale del mismo código que corre en producción:
 * `procesarEntrante` detecta la objeción y `responderObjecion` la contesta.
 * Lo único escrito acá son los mensajes del comprador.
 */

import "server-only";

import { procesarEntrante } from "@/lib/agente/conversacion";
import { gestionarLead } from "@/lib/agente/gestor";
import { ETIQUETA_OBJECION, type TipoObjecion } from "@/lib/agente/objeciones";
import { sumarDiasHabiles } from "@/lib/cierre/negocio";
import { tienda } from "@/lib/datos";
import { inventario } from "@/lib/datos/inventario";
import { nuevoId } from "@/lib/datos/tienda";
import { valorUf } from "@/lib/dominio/chile";
import { nuevoLead, nuevoMensaje } from "@/lib/dominio/fabricas";
import { capacidadCompra } from "@/lib/dominio/financiamiento";
import type { Lead } from "@/lib/dominio/tipos";
import type { Entrante } from "@/lib/mensajeria/tipos";
import { fecharMensajesNuevos, restarDiasHabiles } from "@/lib/simulacion/reloj";

export type Voz = "comprador" | "agente" | "ejecutivo" | "sistema";

export interface TurnoIndeciso {
  /** Día hábil desde la primera consulta. */
  dia: number;
  fecha: string;
  voz: Voz;
  texto: string;
  canal: "whatsapp" | "email" | "portal" | null;
  objecion: TipoObjecion | null;
  etiquetaObjecion: string | null;
  /** Qué hizo el sistema con ese mensaje, cuando vale la pena decirlo. */
  nota: string | null;
}

export interface ObjecionTratada {
  tipo: TipoObjecion;
  etiqueta: string;
  intentos: number;
}

export interface ResumenIndeciso {
  leadId: string;
  comprador: string;
  proyecto: string | null;
  /** Lo que el banco le financiaría, según su renta y su ahorro. */
  techoUf: number | null;
  objeciones: ObjecionTratada[];
  mensajesDelAgente: number;
  escalamientos: number;
  /** true si el agente llegó a decir que no iba a seguir insistiendo. */
  seDetuvo: boolean;
  desenlace: string;
}

export interface ResultadoIndeciso {
  turnos: TurnoIndeciso[];
  resumen: ResumenIndeciso;
}

/**
 * Lo que escribe el comprador, en días hábiles desde la consulta.
 *
 * El orden importa: el miedo a la deuda vuelve tres veces a propósito, para
 * que se vea el freno de las dos insistencias.
 */
const GUION: Array<{ dia: number; texto: string; nota?: string }> = [
  {
    dia: 0,
    texto:
      "Gracias por responder. La verdad no sé bien qué busco, recién estoy empezando a mirar y me da lata equivocarme.",
    nota: "No pide nada: está evaluando. El agente pregunta antes de recomendar.",
  },
  {
    dia: 2,
    texto: "Me da miedo endeudarme a 25 años, es mucho tiempo.",
  },
  {
    dia: 3,
    texto: "¿Y si pierdo la pega en un par de años? Me da vueltas eso.",
    nota: "La respuesta parte reconociendo que el riesgo existe.",
  },
  {
    dia: 4,
    texto: "Igual lo encuentro caro, se me va del presupuesto.",
  },
  {
    dia: 5,
    texto: "Y la verdad no tengo el pie completo, ahorro poco al mes.",
  },
  {
    dia: 8,
    texto: "Estoy viendo otro proyecto de otra inmobiliaria también.",
    nota: "No se habla mal de la competencia: se ofrece la comparación con números.",
  },
  {
    dia: 9,
    texto: "¿Cómo sé que ustedes son serios? Me da desconfianza dejar plata en una reserva.",
  },
  {
    dia: 12,
    texto: "Prefiero esperar a que bajen las tasas, ¿no le parece?",
  },
  {
    dia: 13,
    texto: "Lo voy a pensar y lo converso con mi pareja.",
  },
  {
    dia: 20,
    texto: "Sigue dándome miedo endeudarme tanto tiempo.",
    nota: "Segunda vez con el mismo miedo: se responde de nuevo.",
  },
  {
    dia: 22,
    texto: "No sé, me sigue dando miedo la deuda.",
    nota: "Tercera vez: acá el agente deja de insistir por código, no por criterio.",
  },
  {
    dia: 30,
    texto: "¿Qué documentos necesito para la preaprobación? Sin compromiso por ahora.",
    nota: "El paso que sí dio: gratis, sin obligación y con la decisión todavía suya.",
  },
];

const ULTIMO_DIA = GUION[GUION.length - 1].dia;

export interface OpcionesIndeciso {
  nombre?: string;
  telefono?: string;
  email?: string;
  ejecutivoId?: string | null;
}

export async function simularCompradorIndeciso(
  opciones: OpcionesIndeciso = {},
): Promise<ResultadoIndeciso> {
  const db = tienda();
  const turnos: TurnoIndeciso[] = [];

  const inicio = restarDiasHabiles(new Date(), ULTIMO_DIA);
  const fechaDe = (dia: number) => sumarDiasHabiles(inicio, dia);

  const proyectos = await inventario();
  const proyecto = proyectos.find((item) => item.modelos.length > 0) ?? proyectos[0] ?? null;

  // --------------------------------------------------------------- la consulta
  const nombre = opciones.nombre ?? "Sofía Reyes";
  const consulta =
    "Hola, vi un aviso de ustedes. Gano $1.800.000 líquidos con contrato indefinido y tengo como $18.000.000 ahorrados. No tengo idea de si me alcanza para algo.";

  const lead: Lead = nuevoLead({
    nombre,
    email: opciones.email ?? "sofia.reyes@gmail.com",
    telefono: opciones.telefono ?? "+56 9 5544 3322",
    canal: "whatsapp",
    proyectoIdInteres: proyecto?.id ?? null,
    ejecutivoId: opciones.ejecutivoId ?? null,
    mensajeInicial: consulta,
    creadoEn: fechaDe(0).toISOString(),
    ultimoEntranteEn: fechaDe(0).toISOString(),
  });
  await db.crearLead(lead);
  await db.guardarMensaje(
    nuevoMensaje({
      leadId: lead.id,
      direccion: "entrante",
      canal: "whatsapp",
      cuerpo: consulta,
      estado: "entregado",
      enviadoEn: fechaDe(0).toISOString(),
    }),
  );

  turnos.push({
    dia: 0,
    fecha: fechaDe(0).toISOString(),
    voz: "comprador",
    texto: consulta,
    canal: "whatsapp",
    objecion: null,
    etiquetaObjecion: null,
    nota: "Llega con los números pero sin saber qué quiere.",
  });

  const marcaConsulta = await db.listarMensajes(lead.id);
  const gestion = await gestionarLead(lead.id, { ahora: fechaDe(0) });
  await volcarMensajes(lead.id, marcaConsulta, fechaDe(0), 0, turnos, null);

  const techoUf = gestion.calificacion.presupuestoUfEstimado;

  // ------------------------------------------------------------- la conversación
  let escalamientos = 0;
  let seDetuvo = false;

  for (const paso of GUION) {
    const marca = await db.listarMensajes(lead.id);
    const resultado = await procesarEntrante(entrante(lead, paso.texto));
    const nuevos = await fecharMensajesNuevos(lead.id, marca, fechaDe(paso.dia));

    for (const mensaje of nuevos) {
      turnos.push({
        dia: paso.dia,
        fecha: mensaje.enviadoEn,
        voz: mensaje.direccion === "entrante" ? "comprador" : "agente",
        texto: mensaje.cuerpo,
        canal: mensaje.canal === "portal" ? "portal" : mensaje.canal === "email" ? "email" : "whatsapp",
        objecion: (mensaje.objecion as TipoObjecion | null) ?? null,
        etiquetaObjecion: mensaje.objecion
          ? (ETIQUETA_OBJECION[mensaje.objecion as TipoObjecion] ?? null)
          : null,
        nota: mensaje.direccion === "entrante" ? (paso.nota ?? null) : null,
      });
    }

    if (/deja de insistir/.test(resultado.accion)) seDetuvo = true;

    // Una duda que conviene que tome una persona: el agente contesta con
    // hechos, ofrece un ejecutivo y se aparta. Acá el ejecutivo llama y le
    // devuelve la conversación, que es lo que pasa en la práctica.
    const actual = await db.obtenerLead(lead.id);
    if (actual?.enManosDeHumano) {
      escalamientos += 1;
      const cuando = new Date(fechaDe(paso.dia).getTime() + 4 * 3600_000);
      turnos.push({
        dia: paso.dia,
        fecha: cuando.toISOString(),
        voz: "ejecutivo",
        texto:
          "Llamada de un ejecutivo del equipo: le da los datos de la corredora, le explica que la reserva se paga a la inmobiliaria con comprobante a su nombre y queda de vuelta con el agente.",
        canal: null,
        objecion: null,
        etiquetaObjecion: null,
        nota: "El agente no sigue solo con una desconfianza: la toma una persona.",
      });
      await db.actualizarLead(lead.id, { enManosDeHumano: false });
      await db.registrarActividad({
        id: nuevoId("act"),
        leadId: lead.id,
        tipo: "derivado_a_humano",
        detalle: "El ejecutivo conversó la desconfianza y devolvió la conversación al agente",
        autor: "humano",
        ocurridaEn: cuando.toISOString(),
      });
    }

    // Contestar la primera duda de descubrimiento cambia lo que sabemos de
    // ella, así que se vuelve a calificar con la información nueva: es lo que
    // haría un corredor después de preguntar.
    if (paso.dia === 0) {
      const respuesta =
        "Es para vivir yo. Necesito dos dormitorios y me sirve Ñuñoa o Macul, cerca del metro.";
      const cuando = new Date(fechaDe(1).getTime());
      await db.guardarMensaje(
        nuevoMensaje({
          leadId: lead.id,
          direccion: "entrante",
          canal: "whatsapp",
          cuerpo: respuesta,
          estado: "entregado",
          enviadoEn: cuando.toISOString(),
        }),
      );
      await db.actualizarLead(lead.id, {
        comunasInteres: ["Ñuñoa", "Macul"],
        // El perfil se arma con todo lo que el comprador ha dicho, no solo
        // con el primer mensaje.
        mensajeInicial: `${consulta} ${respuesta}`,
        ultimoEntranteEn: cuando.toISOString(),
      });
      turnos.push({
        dia: 1,
        fecha: cuando.toISOString(),
        voz: "comprador",
        texto: respuesta,
        canal: "whatsapp",
        objecion: null,
        etiquetaObjecion: null,
        nota: "Responde las tres preguntas. Recién ahora hay algo que recomendar.",
      });

      const marcaRecalificacion = await db.listarMensajes(lead.id);
      await gestionarLead(lead.id, { ahora: fechaDe(1) });
      await volcarMensajes(lead.id, marcaRecalificacion, fechaDe(1), 1, turnos, null);
    }
  }

  // ------------------------------------------------------------------ el cierre
  const [mensajes, solicitud, uf, oportunidad] = await Promise.all([
    db.listarMensajes(lead.id),
    db.solicitudDeLead(lead.id),
    valorUf(),
    db.oportunidadDeLead(lead.id),
  ]);

  const capacidad = capacidadCompra(
    oportunidad?.calificacion?.perfil ?? lead.perfil,
    uf.valor,
  );

  const objeciones: ObjecionTratada[] = [];
  for (const mensaje of mensajes) {
    if (!mensaje.objecion) continue;
    const tipo = mensaje.objecion as TipoObjecion;
    const existente = objeciones.find((item) => item.tipo === tipo);
    if (existente) existente.intentos += 1;
    else objeciones.push({ tipo, etiqueta: ETIQUETA_OBJECION[tipo] ?? tipo, intentos: 1 });
  }

  const desenlace =
    solicitud !== null
      ? "Pidió los documentos de la preaprobación: un paso gratis y sin compromiso. No hubo reserva ni visita forzada."
      : "Quedó en pensarlo. El agente dejó de insistir y la ficha queda abierta para cuando quiera retomar.";

  turnos.sort((uno, otro) => uno.fecha.localeCompare(otro.fecha));

  return {
    turnos,
    resumen: {
      leadId: lead.id,
      comprador: nombre,
      proyecto: oportunidad?.proyectoId
        ? ((await db.obtenerProyecto(oportunidad.proyectoId))?.nombre ?? null)
        : (proyecto?.nombre ?? null),
      techoUf: techoUf ?? capacidad.precioMaximoUf,
      objeciones,
      mensajesDelAgente: mensajes.filter(
        (mensaje) => mensaje.direccion === "saliente" && mensaje.automatico,
      ).length,
      escalamientos,
      seDetuvo,
      desenlace,
    },
  };
}

// ------------------------------------------------------------------ auxiliares

function entrante(lead: Lead, texto: string): Entrante {
  return {
    canal: "whatsapp",
    idProveedor: `sim_${nuevoId("ind")}`,
    de: (lead.telefono ?? "").replace(/\D/g, ""),
    nombreRemitente: lead.nombre,
    // Con la hora real: es lo que abre la ventana de 24 horas de WhatsApp.
    // La fecha del guion se le pone después, igual que a la respuesta.
    recibidoEn: new Date().toISOString(),
    texto,
    asunto: null,
    token: null,
    adjuntos: [],
  };
}

/** Pasa a turnos lo que el agente acaba de escribir. */
async function volcarMensajes(
  leadId: string,
  marca: Array<{ id: string }>,
  cuando: Date,
  dia: number,
  turnos: TurnoIndeciso[],
  nota: string | null,
): Promise<void> {
  const nuevos = await fecharMensajesNuevos(leadId, marca, cuando);
  for (const mensaje of nuevos) {
    turnos.push({
      dia,
      fecha: mensaje.enviadoEn,
      voz: mensaje.direccion === "entrante" ? "comprador" : "agente",
      texto: mensaje.cuerpo,
      canal: mensaje.canal === "portal" ? "portal" : mensaje.canal === "email" ? "email" : "whatsapp",
      objecion: (mensaje.objecion as TipoObjecion | null) ?? null,
      etiquetaObjecion: mensaje.objecion
        ? (ETIQUETA_OBJECION[mensaje.objecion as TipoObjecion] ?? null)
        : null,
      nota,
    });
  }
}
