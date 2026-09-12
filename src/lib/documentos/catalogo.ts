/**
 * Documentos que pide la banca chilena para evaluar un crédito hipotecario.
 *
 * Cada uno lleva el motivo por el que se solicita: la Ley 21.719 exige
 * informar la finalidad, y además baja la desconfianza del comprador cuando
 * le piden papeles sensibles.
 */

import type { DocumentoId } from "@/lib/dominio/tipos";

export type TipoTrabajador = "dependiente" | "independiente" | "cualquiera";

export interface Documento {
  id: DocumentoId;
  nombre: string;
  /** Qué se hace con él. Va textual en el correo. */
  motivo: string;
  /** Cómo obtenerlo, que es la duda que siempre aparece. */
  comoObtenerlo: string;
  aplicaA: TipoTrabajador;
  obligatorio: boolean;
  /** Palabras que suelen aparecer en el nombre del archivo. */
  pistas: string[];
}

export const DOCUMENTOS: Documento[] = [
  {
    id: "cedula_identidad",
    nombre: "Cédula de identidad por ambos lados",
    motivo: "Acreditar tu identidad ante el banco y la notaría.",
    comoObtenerlo: "Una foto nítida de cada lado, o el PDF de la cédula digital del Registro Civil.",
    aplicaA: "cualquiera",
    obligatorio: true,
    pistas: ["cedula", "carnet", "ci", "identidad", "rut"],
  },
  {
    id: "liquidaciones_sueldo",
    nombre: "Últimas 3 liquidaciones de sueldo",
    motivo: "Acreditar tu renta líquida, que define el monto de crédito que te pueden aprobar.",
    comoObtenerlo: "Te las entrega el área de personas de tu empresa o el portal de remuneraciones.",
    aplicaA: "dependiente",
    obligatorio: true,
    pistas: ["liquidacion", "liquidaciones", "sueldo", "remuneracion", "nomina"],
  },
  {
    id: "certificado_afp",
    nombre: "Certificado de cotizaciones de AFP (últimos 12 meses)",
    motivo: "Confirmar la continuidad de tus cotizaciones, que el banco usa para validar la renta.",
    comoObtenerlo: "Gratis en el sitio de tu AFP con tu clave, o en afiliadosonline.cl.",
    aplicaA: "dependiente",
    obligatorio: true,
    pistas: ["afp", "cotizacion", "cotizaciones", "previsional"],
  },
  {
    id: "certificado_antiguedad",
    nombre: "Certificado de antigüedad laboral",
    motivo: "Acreditar la estabilidad de tu empleo; la banca pide al menos un año de antigüedad.",
    comoObtenerlo: "Lo emite el área de personas de tu empresa.",
    aplicaA: "dependiente",
    obligatorio: false,
    pistas: ["antiguedad", "contrato", "laboral", "certificado de trabajo"],
  },
  {
    id: "carpeta_tributaria",
    nombre: "Carpeta tributaria para solicitar créditos",
    motivo: "Acreditar tus ingresos cuando trabajas a honorarios o tienes empresa.",
    comoObtenerlo: "Gratis en sii.cl: Servicios online, Situación tributaria, Carpeta tributaria electrónica.",
    aplicaA: "independiente",
    obligatorio: true,
    pistas: ["carpeta", "tributaria", "sii", "boleta", "honorarios", "f22", "renta"],
  },
  {
    id: "cartola_ahorro",
    nombre: "Cartola de la cuenta donde tienes el pie",
    motivo: "Acreditar el origen y la disponibilidad del pie, que es el 20% que no financia el banco.",
    comoObtenerlo: "La descargas del sitio de tu banco. Basta la de los últimos 3 meses.",
    aplicaA: "cualquiera",
    obligatorio: true,
    pistas: ["cartola", "ahorro", "cuenta", "saldo", "estado de cuenta"],
  },
  {
    id: "certificado_matrimonio",
    nombre: "Certificado de matrimonio",
    motivo: "Necesario cuando la compra es en conjunto, para saber bajo qué régimen se inscribe.",
    comoObtenerlo: "Gratis en registrocivil.cl, en línea y al instante.",
    aplicaA: "cualquiera",
    obligatorio: false,
    pistas: ["matrimonio", "acuerdo de union", "auc", "conyugal"],
  },
];

export function documento(id: DocumentoId): Documento | undefined {
  return DOCUMENTOS.find((item) => item.id === id);
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Nombre reducido a palabras, sin acentos ni separadores. */
function palabras(texto: string): string {
  return ` ${normalizar(texto).replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/**
 * Busca la pista como palabra completa, no como subcadena: "ci" (de cédula)
 * aparece dentro de "liquidacion" y haría calzar el documento equivocado.
 */
function contienePista(nombreArchivo: string, pista: string): boolean {
  return palabras(nombreArchivo).includes(palabras(pista));
}

/**
 * Adivina qué documento es un adjunto por su nombre de archivo.
 *
 * Es deliberadamente conservador: si no hay una pista clara devuelve null y
 * el adjunto queda para que lo clasifique una persona, en vez de marcar como
 * recibido un documento que no llegó.
 */
export function clasificarAdjunto(nombreArchivo: string | null, mime: string): DocumentoId | null {
  if (!nombreArchivo) return null;
  // Los ejecutables y similares no son documentos: se descartan de plano.
  if (!/^(application\/pdf|image\/|application\/vnd|application\/msword|text\/)/.test(mime)) {
    return null;
  }

  const coincidencias = DOCUMENTOS.filter((item) =>
    item.pistas.some((pista) => contienePista(nombreArchivo, pista)),
  );

  // Con dos candidatos no se adivina: mejor que lo revise alguien.
  return coincidencias.length === 1 ? coincidencias[0].id : null;
}

/** Documentos que corresponden según el tipo de renta y la situación del comprador. */
export function documentosPara(opciones: {
  independiente: boolean;
  compraEnPareja: boolean;
}): Documento[] {
  return DOCUMENTOS.filter((item) => {
    if (item.id === "certificado_matrimonio") return opciones.compraEnPareja;
    if (item.aplicaA === "cualquiera") return true;
    return opciones.independiente ? item.aplicaA === "independiente" : item.aplicaA === "dependiente";
  });
}
