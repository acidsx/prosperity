/**
 * Simulación de una venta completa, de la consulta a la entrega.
 *
 * No es una animación: cada paso llama a las mismas funciones que corren en
 * producción. El agente califica de verdad, el despachador aplica sus frenos
 * de verdad y el cierre avanza por los mismos hitos. Lo único simulado son
 * las respuestas del comprador, del banco y de la notaría.
 *
 * Comprime unos cuatro meses en una corrida: los hitos del cierre llevan
 * fechas reales calculadas desde un inicio virtual, y los mensajes de la
 * conversación se reescriben a esas fechas para que la ficha del lead quede
 * coherente.
 */

import "server-only";

import { procesarEntrante } from "@/lib/agente/conversacion";
import { gestionarLead } from "@/lib/agente/gestor";
import { crearNegocio, cumplirHito, sumarDiasHabiles } from "@/lib/cierre/negocio";
import { tienda } from "@/lib/datos";
import { inventario } from "@/lib/datos/inventario";
import { nuevoId } from "@/lib/datos/tienda";
import { comisionUf, formatearClp, formatearUf } from "@/lib/dominio/chile";
import type { Negocio, SolicitudCredito, TipoHito } from "@/lib/dominio/cierre";
import { crearSolicitud } from "@/lib/documentos/solicitud";
import type { DocumentoPropiedadId } from "@/lib/documentos/propiedad";
import { nuevoLead } from "@/lib/dominio/fabricas";
import type { Lead } from "@/lib/dominio/tipos";
import type { Entrante } from "@/lib/mensajeria/tipos";

export type Actor =
  | "comprador"
  | "agente"
  | "ejecutivo"
  | "banco"
  | "notaria"
  | "cbr"
  | "sistema";

export interface PasoSimulacion {
  /** Día hábil desde que entró la consulta. */
  dia: number;
  fecha: string;
  actor: Actor;
  titulo: string;
  detalle: string;
}

export interface ResumenSimulacion {
  leadId: string;
  negocioId: string;
  comprador: string;
  proyecto: string;
  unidad: string | null;
  precioUf: number;
  comisionUf: number;
  diasHabiles: number;
  mensajesDelAgente: number;
  documentosRecibidos: number;
  alertasResueltas: number;
}

export interface ResultadoSimulacion {
  pasos: PasoSimulacion[];
  resumen: ResumenSimulacion;
}

/** El guion, en días hábiles desde la consulta. */
const GUION = {
  consulta: 0,
  confirmacionVisita: 0,
  visitaRealizada: 2,
  reserva: 3,
  documentosPedidos: 4,
  documentosParciales: 6,
  documentosCompletos: 8,
  certificadosVendedor: 9,
  creditoIngresado: 9,
  tasacion: 16,
  estudioTitulos: 24,
  creditoAprobado: 30,
  promesa: 35,
  borradorEscritura: 60,
  certificadosRenovados: 62,
  firmaComprador: 70,
  firmaVendedor: 72,
  firmaBanco: 75,
  escrituraCerrada: 75,
  ingresoCbr: 78,
  inscripcionCbr: 95,
  curseCredito: 100,
  pagoVendedor: 102,
  entrega: 105,
  comision: 107,
} as const;

export interface OpcionesSimulacion {
  /** Nombre del comprador simulado. */
  nombre?: string;
  telefono?: string;
  email?: string;
  /** Ejecutivo al que se asigna la operación. */
  ejecutivoId?: string | null;
}

export async function simularVenta(opciones: OpcionesSimulacion = {}): Promise<ResultadoSimulacion> {
  const db = tienda();
  const pasos: PasoSimulacion[] = [];

  // La venta arranca hace 107 días hábiles para que termine hoy.
  const inicio = restarDiasHabiles(new Date(), GUION.comision);
  const fechaDe = (dia: number) => sumarDiasHabiles(inicio, dia);

  const anotar = (dia: number, actor: Actor, titulo: string, detalle: string) => {
    pasos.push({ dia, fecha: fechaDe(dia).toISOString(), actor, titulo, detalle });
  };

  const proyectos = await inventario();
  const proyecto =
    proyectos.find((item) => item.modelos.length > 0 && (item.precioDesdeUf ?? 0) > 0) ??
    proyectos[0];
  if (!proyecto) throw new Error("No hay inventario para simular una venta");

  const modelo = proyecto.modelos[0] ?? null;

  // ---------------------------------------------------------------- consulta
  const nombre = opciones.nombre ?? "Camila Fuentes";
  const lead: Lead = nuevoLead({
    nombre,
    email: opciones.email ?? "camila.fuentes@gmail.com",
    telefono: opciones.telefono ?? "+56 9 8765 4321",
    canal: "portal_inmobiliario",
    proyectoIdInteres: proyecto.id,
    comunasInteres: [proyecto.comuna],
    ejecutivoId: opciones.ejecutivoId ?? null,
    mensajeInicial: `Hola, vi la publicación de ${proyecto.nombre} en ${proyecto.comuna} y me interesa. Gano líquido $2.400.000 con contrato indefinido y tengo $28.000.000 ahorrados para el pie. ¿Se puede visitar esta semana?`,
    creadoEn: fechaDe(GUION.consulta).toISOString(),
    ultimoEntranteEn: fechaDe(GUION.consulta).toISOString(),
  });
  await db.crearLead(lead);

  const marcaConsulta = await db.listarMensajes(lead.id);
  await db.guardarMensaje({
    id: nuevoId("msg"),
    leadId: lead.id,
    direccion: "entrante",
    canal: "portal",
    cuerpo: lead.mensajeInicial,
    automatico: false,
    enviadoEn: fechaDe(GUION.consulta).toISOString(),
    idProveedor: null,
    estado: "entregado",
    plantilla: null,
    asunto: null,
    detalleError: null,
  });

  anotar(
    GUION.consulta,
    "comprador",
    "Llega la consulta",
    `${nombre} escribe desde Portal Inmobiliario por ${proyecto.nombre}.`,
  );

  // ------------------------------------------------------------ calificación
  // Con la fecha del guion: si no, el agente propondría visitas de hoy en
  // una conversación de hace cuatro meses.
  const calificado = await gestionarLead(lead.id, { ahora: fechaDe(GUION.consulta) });
  await fecharMensajesNuevos(lead.id, marcaConsulta, fechaDe(GUION.consulta));

  const calificacion = calificado.calificacion;
  anotar(
    GUION.consulta,
    "agente",
    `Califica el lead: ${calificacion.puntaje}/100 (${calificacion.temperatura})`,
    [
      calificacion.presupuestoUfEstimado
        ? `Techo de compra ${formatearUf(calificacion.presupuestoUfEstimado)}`
        : "Sin techo estimable",
      calificacion.pieUfEstimado ? `pie ${formatearUf(calificacion.pieUfEstimado)}` : null,
      `motor ${calificacion.motor}`,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  anotar(
    GUION.consulta,
    "agente",
    "Responde y propone horarios",
    calificacion.recomendaciones.length > 0
      ? `Recomienda ${calificacion.recomendaciones
          .slice(0, 2)
          .map((item) => item.nombre)
          .join(" y ")}, y ofrece dos bloques de visita.`
      : "Responde la consulta y ofrece dos bloques de visita.",
  );

  // El negocio se arma sobre lo que el agente recomendó, no sobre el primer
  // modelo del catálogo: cerrar una venta sobre el techo de compra del
  // comprador sería incoherente con su propia calificación.
  const oportunidad = calificado.oportunidad;
  const proyectoVendido =
    (oportunidad.proyectoId ? await db.obtenerProyecto(oportunidad.proyectoId) : null) ?? proyecto;
  const modeloVendido =
    proyectoVendido.modelos.find((item) => item.name === oportunidad.modelo) ??
    mejorModeloParaElTecho(proyectoVendido, calificacion.presupuestoUfEstimado) ??
    modelo;
  const precioUf = Math.round(
    oportunidad.valorUf ?? modeloVendido?.priceFinal ?? proyectoVendido.precioDesdeUf ?? 3000,
  );

  // El calce acepta hasta un 10% sobre el techo por considerarlo negociable.
  // Si la unidad quedó sobre la aprobación del banco, la venta se cierra con
  // el descuento que hace falta; sin eso, faltaría pie en la firma.
  const techoUf = calificacion.presupuestoUfEstimado;
  const descuentoUf =
    techoUf !== null && precioUf > techoUf ? Math.ceil((precioUf - techoUf) / 10) * 10 : 0;

  // ------------------------------------------------- confirmación de la visita
  const marcaConfirmacion = await db.listarMensajes(lead.id);
  await procesarEntrante(entrante(lead, "Sí, confirmo", "confirmar_visita"));
  await fecharMensajesNuevos(lead.id, marcaConfirmacion, fechaDe(GUION.confirmacionVisita));

  anotar(GUION.confirmacionVisita, "comprador", "Confirma la visita", "Responde al botón de la plantilla.");
  anotar(
    GUION.confirmacionVisita,
    "agente",
    "Deja la visita confirmada",
    "Actualiza la agenda, mueve el pipeline a Visita agendada y avisa la dirección.",
  );

  // -------------------------------------------------------------- la visita
  const visitas = await db.listarVisitas();
  const visita = visitas.find((item) => item.leadId === lead.id);
  if (visita) {
    await db.actualizarVisita(visita.id, {
      estado: "realizada",
      inicio: fechaDe(GUION.visitaRealizada).toISOString(),
      fin: new Date(fechaDe(GUION.visitaRealizada).getTime() + 45 * 60_000).toISOString(),
      notas: "Visitó con su pareja. Le gustó la orientación y la terraza.",
    });
  }
  anotar(
    GUION.visitaRealizada,
    "ejecutivo",
    "Visita realizada",
    `Recorren ${proyectoVendido.nombre}${modeloVendido ? `, tipología ${modeloVendido.name}` : ""}.`,
  );

  // --------------------------------------------------------------- la reserva
  let negocio = crearNegocio({
    id: nuevoId("neg"),
    leadId: lead.id,
    proyectoId: proyectoVendido.id,
    unidad: "Depto 1402",
    modelo: modeloVendido?.name ?? null,
    precioUf,
    descuentoUf,
    reservaClp: proyectoVendido.reservaClp ?? 500_000,
    ejecutivoId: opciones.ejecutivoId ?? null,
    compradores: [
      {
        nombre: lead.nombre,
        rut: "12.345.678-5",
        email: lead.email,
        telefono: lead.telefono,
        estadoCivil: "single",
      },
    ],
    vendedor: {
      nombre: proyectoVendido.desarrollador ?? "Inmobiliaria",
      rut: "76.543.210-9",
      email: null,
      telefono: null,
      estadoCivil: null,
    },
    // La comisión se calcula sobre el precio final, no sobre el de lista.
    comisionUf: proyectoVendido.feePorcentaje
      ? Math.round((precioUf - descuentoUf) * (proyectoVendido.feePorcentaje / 100) * 100) / 100
      : comisionUf(precioUf - descuentoUf),
    esCopropiedad: true,
    desde: fechaDe(GUION.reserva),
  });
  negocio = cumplirHito(negocio, "reserva_firmada", { fecha: fechaDe(GUION.reserva).toISOString() });
  await db.guardarNegocio(negocio);

  if (descuentoUf > 0) {
    anotar(
      GUION.reserva,
      "ejecutivo",
      `Negocia ${formatearUf(descuentoUf)} de descuento`,
      `La unidad estaba en ${formatearUf(precioUf)} y la aprobación del comprador llega a ${formatearUf(
        techoUf ?? 0,
      )}. Sin el descuento faltaría pie en la firma.`,
    );
  }

  anotar(
    GUION.reserva,
    "comprador",
    "Reserva la unidad",
    `Paga ${formatearClp(negocio.reservaClp)} y firma el comprobante. Depto 1402, ${formatearUf(
      precioUf - descuentoUf,
    )}${descuentoUf > 0 ? ` (lista ${formatearUf(precioUf)})` : ""}.`,
  );

  // ----------------------------------------------------------- los documentos
  const solicitud = crearSolicitud(lead);
  await db.guardarSolicitud({ ...solicitud, solicitadaEn: fechaDe(GUION.documentosPedidos).toISOString() });
  anotar(
    GUION.documentosPedidos,
    "agente",
    `Pide los ${solicitud.documentos.length} documentos de la preaprobación`,
    "Correo con para qué sirve cada uno, cuánto se conservan y cómo pedir su eliminación.",
  );

  const marcaDocumentos = await db.listarMensajes(lead.id);
  await procesarEntrante(
    entrante(lead, "Ahí van los primeros", null, {
      canal: "email",
      token: solicitud.token,
      adjuntos: [
        adjunto("liquidaciones-agosto.pdf"),
        adjunto("certificado-afp-habitat.pdf"),
      ],
    }),
  );
  await fecharMensajesNuevos(lead.id, marcaDocumentos, fechaDe(GUION.documentosParciales));
  anotar(
    GUION.documentosParciales,
    "comprador",
    "Manda parte de los documentos",
    "Liquidaciones y certificado de AFP. El agente acusa recibo y dice qué falta.",
  );

  const marcaResto = await db.listarMensajes(lead.id);
  await procesarEntrante(
    entrante(lead, "Acá va el resto", null, {
      canal: "email",
      token: solicitud.token,
      adjuntos: [adjunto("cartola-ahorro-bch.pdf"), adjunto("cedula-identidad.jpg", "image/jpeg")],
    }),
  );
  await fecharMensajesNuevos(lead.id, marcaResto, fechaDe(GUION.documentosCompletos));

  const solicitudFinal = await db.solicitudDeLead(lead.id);
  const documentosRecibidos =
    solicitudFinal?.documentos.filter((item) => item.recibidoEn !== null).length ?? 0;
  const pedidos = solicitudFinal?.documentos.length ?? 0;
  anotar(
    GUION.documentosCompletos,
    "agente",
    solicitudFinal?.estado === "completa"
      ? "Carpeta del comprador completa"
      : "Carpeta del comprador incompleta",
    `${documentosRecibidos} de ${pedidos} documentos${
      solicitudFinal?.estado === "completa" ? "; los obligatorios están todos" : ""
    }. Del contenido solo se guardan metadatos.`,
  );

  // ------------------------------------------- certificados del vendedor (1ª vuelta)
  const CERTIFICADOS_CBR: DocumentoPropiedadId[] = [
    "dominio_vigente",
    "hipotecas_gravamenes",
    "prohibiciones_interdicciones",
  ];
  negocio = registrarDocumentos(negocio, CERTIFICADOS_CBR, fechaDe(GUION.certificadosVendedor));
  negocio = registrarDocumentos(
    negocio,
    ["recepcion_final", "escritura_anterior", "reglamento_copropiedad"],
    fechaDe(GUION.certificadosVendedor),
  );
  anotar(
    GUION.certificadosVendedor,
    "ejecutivo",
    "Sube los certificados del vendedor",
    "Dominio vigente, hipotecas y gravámenes, prohibiciones, recepción final y título anterior.",
  );

  // ---------------------------------------------------------------- el banco
  negocio = cumplirHito(negocio, "credito_ingresado", {
    fecha: fechaDe(GUION.creditoIngresado).toISOString(),
  });
  // El crédito se lleva en una variable propia: `cumplirHito` clona el
  // negocio y el compilador pierde el rastro de que ya no es null.
  let credito: SolicitudCredito = {
    banco: "Banco de Chile",
    ejecutivoBanco: "Marcela Núñez",
    contactoBanco: "marcela.nunez@bancochile.cl",
    estado: "ingresada",
    montoUf: Math.round((precioUf - descuentoUf) * 0.8),
    tasaAnual: 4.6,
    plazoAnos: 25,
    tasacionUf: null,
    reparos: [],
    actualizadaEn: fechaDe(GUION.creditoIngresado).toISOString(),
  };
  negocio.credito = credito;
  await db.guardarNegocio(negocio);
  anotar(
    GUION.creditoIngresado,
    "ejecutivo",
    "Ingresa la solicitud al banco",
    `Banco de Chile · ${formatearUf(credito.montoUf ?? 0)} a 25 años.`,
  );

  negocio = cumplirHito(negocio, "tasacion", { fecha: fechaDe(GUION.tasacion).toISOString() });
  credito = {
    ...credito,
    estado: "en_tasacion",
    // Tasa un poco sobre el precio: sin sorpresas de pie.
    tasacionUf: Math.round((precioUf - descuentoUf) * 1.02),
    actualizadaEn: fechaDe(GUION.tasacion).toISOString(),
  };
  negocio.credito = credito;
  await db.guardarNegocio(negocio);
  anotar(
    GUION.tasacion,
    "banco",
    "Tasación",
    `Tasa en ${formatearUf(credito.tasacionUf ?? 0)}, sobre el precio: el pie no cambia.`,
  );

  negocio = cumplirHito(negocio, "estudio_titulos", {
    fecha: fechaDe(GUION.estudioTitulos).toISOString(),
    nota: "Con un reparo: faltaba el alzamiento de la hipoteca anterior del vendedor.",
  });
  credito = {
    ...credito,
    estado: "en_estudio_titulos",
    reparos: ["Alzamiento de hipoteca anterior del vendedor"],
    actualizadaEn: fechaDe(GUION.estudioTitulos).toISOString(),
  };
  negocio.credito = credito;
  await db.guardarNegocio(negocio);
  anotar(
    GUION.estudioTitulos,
    "banco",
    "Estudio de títulos con un reparo",
    "Falta el alzamiento de la hipoteca anterior. El sistema lo levanta como alerta del vendedor.",
  );

  negocio = cumplirHito(negocio, "credito_aprobado", {
    fecha: fechaDe(GUION.creditoAprobado).toISOString(),
  });
  credito = {
    ...credito,
    estado: "aprobada",
    reparos: [],
    actualizadaEn: fechaDe(GUION.creditoAprobado).toISOString(),
  };
  negocio.credito = credito;
  await db.guardarNegocio(negocio);
  anotar(
    GUION.creditoAprobado,
    "banco",
    "Crédito aprobado",
    `Reparo resuelto. ${formatearUf(credito.montoUf ?? 0)} al 4,6% a 25 años.`,
  );

  // --------------------------------------------------------------- la promesa
  negocio = cumplirHito(negocio, "promesa_firmada", {
    fecha: fechaDe(GUION.promesa).toISOString(),
  });
  await db.guardarNegocio(negocio);
  anotar(
    GUION.promesa,
    "ejecutivo",
    "Promesa de compraventa firmada",
    "Con plazo para escriturar y multas pactadas.",
  );

  // ----------------------------------------------------------- la escrituración
  negocio = cumplirHito(negocio, "borrador_escritura", {
    fecha: fechaDe(GUION.borradorEscritura).toISOString(),
  });
  await db.guardarNegocio(negocio);
  anotar(
    GUION.borradorEscritura,
    "banco",
    "Borrador de escritura",
    "Compraventa y mutuo hipotecario, redactado por el abogado del banco.",
  );

  // Los certificados del Conservador se sacaron el día 9 y duran 30 días
  // corridos: al llegar a la escritura ya no sirven. Esta es la alerta que
  // más veces bota una firma.
  anotar(
    GUION.borradorEscritura,
    "sistema",
    "Alerta: tres certificados vencidos",
    "Dominio vigente, hipotecas y prohibiciones se sacaron hace más de 30 días. La notaría no los acepta.",
  );

  negocio = registrarDocumentos(negocio, CERTIFICADOS_CBR, fechaDe(GUION.certificadosRenovados));
  await db.guardarNegocio(negocio);
  anotar(
    GUION.certificadosRenovados,
    "ejecutivo",
    "Vuelve a pedir los certificados",
    "Los tres al día antes de la firma. Sin la alerta, esto aparece en el mesón de la notaría.",
  );

  // ----------------------------------------------------------------- las firmas
  const notaria = "Notaría Iván Torrealba, Huérfanos 979, Santiago";
  negocio.firmas = [
    firma("comprador", [lead.nombre], fechaDe(GUION.firmaComprador), notaria),
    firma("vendedor", [negocio.vendedor?.nombre ?? "Vendedor"], fechaDe(GUION.firmaVendedor), notaria),
    firma("banco", ["Apoderado Banco de Chile"], fechaDe(GUION.firmaBanco), notaria),
  ];
  for (const [tipo, dia] of [
    ["firma_comprador", GUION.firmaComprador],
    ["firma_vendedor", GUION.firmaVendedor],
    ["firma_banco", GUION.firmaBanco],
    ["escritura_cerrada", GUION.escrituraCerrada],
  ] as Array<[TipoHito, number]>) {
    negocio = cumplirHito(negocio, tipo, { fecha: fechaDe(dia).toISOString() });
  }
  await db.guardarNegocio(negocio);

  anotar(GUION.firmaComprador, "comprador", "Firma ante notario", notaria);
  anotar(GUION.firmaVendedor, "notaria", "Firma el vendedor", "Dos días después del comprador.");
  anotar(
    GUION.escrituraCerrada,
    "notaria",
    "Escritura cerrada",
    "Firma el banco al final y la notaría entrega copias autorizadas.",
  );

  // ------------------------------------------------------------------- el CBR
  negocio = cumplirHito(negocio, "ingreso_cbr", { fecha: fechaDe(GUION.ingresoCbr).toISOString() });
  negocio.cbr = {
    conservador: "Conservador de Bienes Raíces de Santiago",
    ingresadaEn: fechaDe(GUION.ingresoCbr).toISOString(),
    numeroIngreso: "2026-184532",
    inscritaEn: null,
    fojas: null,
    numero: null,
    ano: null,
    reparos: [],
  };
  await db.guardarNegocio(negocio);
  anotar(GUION.ingresoCbr, "notaria", "Ingreso al Conservador", "Para inscribir dominio e hipoteca.");

  negocio = cumplirHito(negocio, "inscripcion_cbr", {
    fecha: fechaDe(GUION.inscripcionCbr).toISOString(),
  });
  negocio.cbr = {
    conservador: "Conservador de Bienes Raíces de Santiago",
    ingresadaEn: fechaDe(GUION.ingresoCbr).toISOString(),
    numeroIngreso: "2026-184532",
    inscritaEn: fechaDe(GUION.inscripcionCbr).toISOString(),
    fojas: "45.821",
    numero: "31.204",
    ano: new Date().getFullYear(),
    reparos: [],
  };
  await db.guardarNegocio(negocio);
  anotar(
    GUION.inscripcionCbr,
    "cbr",
    "Dominio e hipoteca inscritos",
    `Fojas 45.821 nº 31.204. Recién acá ${lead.nombre.split(" ")[0]} es dueña.`,
  );

  // --------------------------------------------------------- pago y entrega
  for (const [tipo, dia] of [
    ["curse_credito", GUION.curseCredito],
    ["pago_vendedor", GUION.pagoVendedor],
    ["entrega_propiedad", GUION.entrega],
    ["factura_comision", GUION.comision],
  ] as Array<[TipoHito, number]>) {
    negocio = cumplirHito(negocio, tipo, { fecha: fechaDe(dia).toISOString() });
  }
  negocio.comisionFacturada = true;
  await db.guardarNegocio(negocio);

  anotar(GUION.curseCredito, "banco", "Curse del crédito", "Con la hipoteca inscrita, el banco libera el vale vista.");
  anotar(GUION.pagoVendedor, "banco", "Pago al vendedor", "Se paga el saldo de precio.");
  anotar(GUION.entrega, "ejecutivo", "Entrega de la propiedad", "Acta, llaves y lecturas de medidores.");
  anotar(
    GUION.comision,
    "sistema",
    "Venta cerrada",
    `Comisión de ${formatearUf(negocio.comisionUf ?? 0)} facturada. Etapa: ${negocio.etapa}.`,
  );

  const mensajes = await db.listarMensajes(lead.id);

  return {
    pasos,
    resumen: {
      leadId: lead.id,
      negocioId: negocio.id,
      comprador: lead.nombre,
      proyecto: proyectoVendido.nombre,
      unidad: negocio.unidad,
      precioUf: precioUf - descuentoUf,
      comisionUf: negocio.comisionUf ?? 0,
      diasHabiles: GUION.comision,
      mensajesDelAgente: mensajes.filter(
        (mensaje) => mensaje.direccion === "saliente" && mensaje.automatico,
      ).length,
      documentosRecibidos,
      // La de los certificados vencidos, que sin el sistema aparece en la notaría.
      alertasResueltas: 1,
    },
  };
}

// ------------------------------------------------------------------ auxiliares

function entrante(
  lead: Lead,
  texto: string,
  boton: string | null,
  extra: Partial<Entrante> = {},
): Entrante {
  return {
    canal: "whatsapp",
    idProveedor: `sim_${Math.random().toString(36).slice(2, 12)}`,
    de: (lead.telefono ?? "").replace(/\D/g, ""),
    nombreRemitente: lead.nombre,
    recibidoEn: new Date().toISOString(),
    texto,
    asunto: null,
    token: boton,
    adjuntos: [],
    ...extra,
    ...(extra.canal === "email" ? { de: lead.email ?? "" } : {}),
  };
}

/** El modelo más grande que cabe en el techo de compra del comprador. */
function mejorModeloParaElTecho(
  proyecto: { modelos: Array<{ name: string; priceFinal: number }> },
  techoUf: number | null,
) {
  if (techoUf === null) return proyecto.modelos[0] ?? null;
  const alcanzables = proyecto.modelos.filter((modelo) => modelo.priceFinal <= techoUf);
  if (alcanzables.length === 0) return null;
  return alcanzables.reduce((mejor, actual) =>
    actual.priceFinal > mejor.priceFinal ? actual : mejor,
  );
}

function adjunto(nombre: string, mime = "application/pdf") {
  return { idAdjunto: nuevoId("adj"), nombre, mime, tamano: 120_000 };
}

function firma(
  parte: "comprador" | "vendedor" | "banco",
  asistentes: string[],
  cuando: Date,
  notaria: string,
) {
  const [nombre, ...direccion] = notaria.split(", ");
  return {
    id: nuevoId("fir"),
    parte,
    notaria: nombre,
    direccionNotaria: direccion.join(", "),
    agendadaPara: cuando.toISOString(),
    firmadaEn: cuando.toISOString(),
    asistentes,
    nota: null,
  };
}

function registrarDocumentos(
  negocio: Negocio,
  documentos: DocumentoPropiedadId[],
  cuando: Date,
): Negocio {
  const copia = structuredClone(negocio);
  for (const registro of copia.documentos) {
    if (!documentos.includes(registro.documento)) continue;
    registro.emitidoEn = cuando.toISOString();
    registro.recibidoEn = cuando.toISOString();
    registro.archivo = {
      nombre: `${registro.documento}.pdf`,
      mime: "application/pdf",
      referencia: "simulación",
    };
  }
  return copia;
}

function restarDiasHabiles(desde: Date, dias: number): Date {
  const fecha = new Date(desde);
  let restantes = dias;
  while (restantes > 0) {
    fecha.setDate(fecha.getDate() - 1);
    const dia = fecha.getDay();
    if (dia !== 0 && dia !== 6) restantes -= 1;
  }
  return fecha;
}

/**
 * Reescribe la hora de los mensajes que acaba de crear el agente.
 *
 * El agente sella con la hora real; la simulación necesita que la
 * conversación quede en la fecha del guion para que la ficha del lead sea
 * coherente con el resto del cierre.
 */
async function fecharMensajesNuevos(
  leadId: string,
  antes: Array<{ id: string }>,
  cuando: Date,
): Promise<void> {
  const db = tienda();
  const conocidos = new Set(antes.map((mensaje) => mensaje.id));
  const ahora = await db.listarMensajes(leadId);

  // Los mensajes nuevos van después del último que ya existía: si se
  // reinicia el reloj en cada paso, la respuesta del comprador termina
  // apareciendo antes del mensaje que está respondiendo.
  const ultimoConocido = ahora
    .filter((mensaje) => conocidos.has(mensaje.id))
    .reduce((maximo, mensaje) => Math.max(maximo, new Date(mensaje.enviadoEn).getTime()), 0);

  let siguiente = Math.max(cuando.getTime(), ultimoConocido + 3 * 60_000);
  for (const mensaje of ahora) {
    if (conocidos.has(mensaje.id)) continue;
    await db.actualizarMensaje(mensaje.id, { enviadoEn: new Date(siguiente).toISOString() });
    siguiente += 3 * 60_000;
  }

  await db.actualizarLead(leadId, { ultimoEntranteEn: cuando.toISOString() });
}
