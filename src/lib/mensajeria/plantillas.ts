/**
 * Catálogo de plantillas de WhatsApp.
 *
 * Fuera de la ventana de 24 horas desde el último mensaje del comprador,
 * Meta solo permite enviar plantillas previamente aprobadas. Este archivo es
 * lo que hay que dar de alta en el WhatsApp Manager; `validarPlantilla`
 * comprueba las reglas de formato de Meta antes de mandarlas a revisión, que
 * es donde se pierden los días.
 */

export type CategoriaPlantilla = "UTILITY" | "MARKETING" | "AUTHENTICATION";

export interface BotonRespuesta {
  /** Máximo 20 caracteres, según Meta. */
  texto: string;
  /** Identificador que llega en el webhook cuando el comprador lo toca. */
  id: string;
}

export interface Plantilla {
  nombre: string;
  categoria: CategoriaPlantilla;
  idioma: string;
  /** Cuerpo con marcadores {{1}}, {{2}}, … */
  cuerpo: string;
  /** Qué representa cada variable, en orden. Para el formulario de Meta. */
  variables: string[];
  /** Ejemplos que Meta exige al enviar la plantilla a revisión. */
  ejemplo: string[];
  botones?: BotonRespuesta[];
  /** Para qué se usa; no va a Meta, es para el equipo. */
  proposito: string;
}

export const PLANTILLAS: Plantilla[] = [
  {
    nombre: "confirmacion_visita",
    categoria: "UTILITY",
    idioma: "es",
    cuerpo:
      "Hola {{1}}, soy de {{2}}. Te reservé la visita a {{3}} para el {{4}}. ¿La confirmas?",
    variables: ["nombre del comprador", "nombre de la corredora", "proyecto", "día y hora"],
    ejemplo: ["Camila", "Prosperity Latam", "Mirador Alto", "sábado 12 de septiembre a las 10:00"],
    botones: [
      { texto: "Confirmar", id: "confirmar_visita" },
      { texto: "Cambiar horario", id: "reagendar_visita" },
      { texto: "Cancelar", id: "cancelar_visita" },
    ],
    proposito: "Pedir confirmación de una visita agendada fuera de la ventana de 24 h.",
  },
  {
    nombre: "recordatorio_visita",
    categoria: "UTILITY",
    idioma: "es",
    cuerpo:
      "Hola {{1}}, te recuerdo tu visita a {{2}} mañana {{3}}. La dirección es {{4}}. Si necesitas cambiarla, respóndeme por acá.",
    variables: ["nombre del comprador", "proyecto", "día y hora", "dirección"],
    ejemplo: ["Camila", "Mirador Alto", "sábado a las 10:00", "Av. Apoquindo 6400, Las Condes"],
    proposito: "Recordar la visita el día anterior y bajar la inasistencia.",
  },
  {
    nombre: "documentos_solicitados",
    categoria: "UTILITY",
    idioma: "es",
    cuerpo:
      "Hola {{1}}, te envié a {{2}} el detalle de los {{3}} documentos que pide el banco para la preaprobación. Cuando los tengas, respondes ese correo con los archivos adjuntos.",
    variables: ["nombre del comprador", "correo de destino", "cantidad de documentos"],
    ejemplo: ["Camila", "camila@gmail.com", "4"],
    proposito: "Avisar por WhatsApp que la solicitud de documentos salió por correo.",
  },
  {
    nombre: "documentos_pendientes",
    categoria: "UTILITY",
    idioma: "es",
    cuerpo:
      "Hola {{1}}, de los documentos para tu preaprobación todavía falta: {{2}}. Los puedes responder al correo que te envié.",
    variables: ["nombre del comprador", "lista de documentos faltantes"],
    ejemplo: ["Camila", "liquidaciones de sueldo, certificado de AFP"],
    proposito: "Recordar los documentos que faltan, sin volver a pedir los recibidos.",
  },
  {
    nombre: "seguimiento_cotizacion",
    categoria: "UTILITY",
    idioma: "es",
    cuerpo:
      "Hola {{1}}, te escribo por la cotización de {{2}} que te envié el {{3}}. ¿Quedaste con alguna duda o preferirías ver otra alternativa?",
    variables: ["nombre del comprador", "proyecto", "fecha de la cotización"],
    ejemplo: ["Camila", "Mirador Alto", "8 de septiembre"],
    proposito: "Retomar una cotización enviada que no tuvo respuesta.",
  },
  {
    nombre: "reactivacion_lead",
    categoria: "MARKETING",
    idioma: "es",
    cuerpo:
      "Hola {{1}}, ¿sigues buscando en {{2}}? Entraron opciones nuevas en tu rango de precio. Si ya no estás buscando, respóndeme BAJA y no te vuelvo a escribir.",
    variables: ["nombre del comprador", "comuna"],
    ejemplo: ["Camila", "Ñuñoa"],
    proposito: "Reactivar un lead frío. Es MARKETING: requiere opt-in y se puede bloquear.",
  },
];

export function plantilla(nombre: string): Plantilla | undefined {
  return PLANTILLAS.find((item) => item.nombre === nombre);
}

/** Rellena {{1}}, {{2}}, … para dejar el texto legible en el CRM. */
export function renderizar(plantillaUsada: Plantilla, variables: string[]): string {
  return plantillaUsada.cuerpo.replace(/\{\{(\d+)\}\}/g, (_, indice: string) => {
    const valor = variables[Number(indice) - 1];
    return valor ?? `{{${indice}}}`;
  });
}

export interface ProblemaPlantilla {
  plantilla: string;
  problema: string;
}

/**
 * Reglas de formato que aplica Meta al revisar una plantilla. Cada una de
 * estas es un rechazo, y un rechazo cuesta días de espera.
 */
export function validarPlantilla(item: Plantilla): ProblemaPlantilla[] {
  const problemas: ProblemaPlantilla[] = [];
  const reportar = (problema: string) => problemas.push({ plantilla: item.nombre, problema });

  if (!/^[a-z0-9_]+$/.test(item.nombre)) {
    reportar("el nombre solo admite minúsculas, números y guion bajo");
  }
  if (item.nombre.length > 512) reportar("el nombre supera los 512 caracteres");
  if (item.cuerpo.length > 1024) reportar("el cuerpo supera los 1024 caracteres");

  const marcadores = [...item.cuerpo.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));

  // Meta exige numeración corrida desde 1, sin saltos ni repetidos.
  const esperados = Array.from({ length: marcadores.length }, (_, i) => i + 1);
  if (marcadores.join(",") !== esperados.join(",")) {
    reportar(`los marcadores deben ir corridos desde {{1}}; llegaron ${marcadores.join(", ") || "ninguno"}`);
  }

  if (marcadores.length !== item.variables.length) {
    reportar(`hay ${marcadores.length} marcadores y ${item.variables.length} variables descritas`);
  }
  if (marcadores.length !== item.ejemplo.length) {
    reportar(`hay ${marcadores.length} marcadores y ${item.ejemplo.length} ejemplos`);
  }

  // Una variable pegada al inicio o al final se rechaza.
  if (/^\s*\{\{\d+\}\}/.test(item.cuerpo)) reportar("el cuerpo no puede empezar con una variable");
  if (/\{\{\d+\}\}\s*$/.test(item.cuerpo)) reportar("el cuerpo no puede terminar con una variable");

  // Dos variables consecutivas también se rechazan.
  if (/\{\{\d+\}\}[\s,.;:-]*\{\{\d+\}\}/.test(item.cuerpo)) {
    reportar("no puede haber dos variables seguidas sin texto entre medio");
  }

  if (/[\n\t]/.test(item.cuerpo) && item.cuerpo.includes("{{")) {
    // Los saltos de línea son válidos, pero no dentro del valor de la variable.
    // Se avisa porque es una causa habitual de rechazo.
    reportar("revisa que ningún valor de variable traiga saltos de línea o tabulaciones");
  }

  for (const boton of item.botones ?? []) {
    if (boton.texto.length > 20) {
      reportar(`el botón "${boton.texto}" supera los 20 caracteres`);
    }
  }
  if ((item.botones?.length ?? 0) > 3) {
    reportar("Meta admite como máximo 3 botones de respuesta rápida");
  }

  return problemas;
}

export function validarCatalogo(): ProblemaPlantilla[] {
  return PLANTILLAS.flatMap(validarPlantilla);
}
