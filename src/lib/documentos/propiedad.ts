/**
 * Documentos de la propiedad y del vendedor.
 *
 * La diferencia con los del comprador es la **vigencia**: los certificados
 * del Conservador y de la municipalidad caducan, y el banco o la notaría
 * rechazan la escritura si llegan vencidos. Una compraventa se cae por un
 * dominio vigente de hace 45 días más seguido de lo que parece.
 */

import type { EtapaCierre, Responsable } from "@/lib/dominio/cierre";

export type DocumentoPropiedadId =
  | "dominio_vigente"
  | "hipotecas_gravamenes"
  | "prohibiciones_interdicciones"
  | "no_expropiacion_serviu"
  | "no_expropiacion_municipal"
  | "deuda_contribuciones"
  | "deuda_gastos_comunes"
  | "recepcion_final"
  | "escritura_anterior"
  | "reglamento_copropiedad"
  | "certificado_matrimonio_vendedor"
  | "certificado_deuda_hipotecaria";

export interface DocumentoPropiedad {
  id: DocumentoPropiedadId;
  nombre: string;
  /** Días de vigencia desde su emisión. null si no caduca. */
  vigenciaDias: number | null;
  donde: string;
  motivo: string;
  responsable: Responsable;
  /** Etapa en la que tiene que estar arriba. */
  requeridoEn: EtapaCierre;
  obligatorio: boolean;
  /** Solo aplica a departamentos y condominios. */
  soloCopropiedad?: boolean;
}

export const DOCUMENTOS_PROPIEDAD: DocumentoPropiedad[] = [
  {
    id: "dominio_vigente",
    nombre: "Certificado de dominio vigente",
    vigenciaDias: 30,
    donde: "Conservador de Bienes Raíces, en línea.",
    motivo: "Acredita quién es el dueño hoy. Sin esto el banco no hace el estudio de títulos.",
    responsable: "vendedor",
    requeridoEn: "evaluacion_bancaria",
    obligatorio: true,
  },
  {
    id: "hipotecas_gravamenes",
    nombre: "Certificado de hipotecas y gravámenes",
    vigenciaDias: 30,
    donde: "Conservador de Bienes Raíces.",
    motivo: "Muestra si la propiedad tiene hipotecas vigentes que haya que alzar antes de vender.",
    responsable: "vendedor",
    requeridoEn: "evaluacion_bancaria",
    obligatorio: true,
  },
  {
    id: "prohibiciones_interdicciones",
    nombre: "Certificado de prohibiciones e interdicciones",
    vigenciaDias: 30,
    donde: "Conservador de Bienes Raíces.",
    motivo: "Revela embargos o prohibiciones de enajenar que impedirían la venta.",
    responsable: "vendedor",
    requeridoEn: "evaluacion_bancaria",
    obligatorio: true,
  },
  {
    id: "no_expropiacion_serviu",
    nombre: "Certificado de no expropiación SERVIU",
    vigenciaDias: 60,
    donde: "SERVIU de la región.",
    motivo: "Confirma que la propiedad no está afecta a expropiación por obras públicas.",
    responsable: "vendedor",
    requeridoEn: "escrituracion",
    obligatorio: true,
  },
  {
    id: "no_expropiacion_municipal",
    nombre: "Certificado de no expropiación municipal",
    vigenciaDias: 60,
    donde: "Dirección de Obras de la municipalidad.",
    motivo: "Lo mismo, pero por obras del municipio. El banco pide los dos.",
    responsable: "municipalidad",
    requeridoEn: "escrituracion",
    obligatorio: true,
  },
  {
    id: "deuda_contribuciones",
    nombre: "Certificado de deuda de contribuciones",
    vigenciaDias: 30,
    donde: "sii.cl o Tesorería General de la República.",
    motivo: "Las contribuciones impagas siguen a la propiedad: hay que pagarlas antes de escriturar.",
    responsable: "vendedor",
    requeridoEn: "escrituracion",
    obligatorio: true,
  },
  {
    id: "deuda_gastos_comunes",
    nombre: "Certificado de gastos comunes al día",
    vigenciaDias: 30,
    donde: "Administración del edificio o condominio.",
    motivo: "La deuda de gastos comunes también sigue a la propiedad.",
    responsable: "vendedor",
    requeridoEn: "escrituracion",
    obligatorio: true,
    soloCopropiedad: true,
  },
  {
    id: "recepcion_final",
    nombre: "Recepción final de obras",
    vigenciaDias: null,
    donde: "Dirección de Obras Municipales.",
    motivo: "Acredita que la construcción está recibida. Sin esto no se puede inscribir.",
    responsable: "vendedor",
    requeridoEn: "evaluacion_bancaria",
    obligatorio: true,
  },
  {
    id: "escritura_anterior",
    nombre: "Escritura de compraventa anterior",
    vigenciaDias: null,
    donde: "Copia de la notaría donde se firmó, o del vendedor.",
    motivo: "Título de dominio del vendedor. Es la base del estudio de títulos.",
    responsable: "vendedor",
    requeridoEn: "evaluacion_bancaria",
    obligatorio: true,
  },
  {
    id: "reglamento_copropiedad",
    nombre: "Reglamento de copropiedad",
    vigenciaDias: null,
    donde: "Administración del edificio o Conservador.",
    motivo: "Define derechos sobre estacionamientos, bodegas y uso de espacios comunes.",
    responsable: "vendedor",
    requeridoEn: "escrituracion",
    obligatorio: false,
    soloCopropiedad: true,
  },
  {
    id: "certificado_matrimonio_vendedor",
    nombre: "Certificado de matrimonio del vendedor",
    vigenciaDias: 60,
    donde: "registrocivil.cl, gratis y en línea.",
    motivo: "Según el régimen, el cónyuge también tiene que firmar la venta.",
    responsable: "vendedor",
    requeridoEn: "escrituracion",
    obligatorio: false,
  },
  {
    id: "certificado_deuda_hipotecaria",
    nombre: "Certificado de deuda del crédito del vendedor",
    vigenciaDias: 15,
    donde: "Banco acreedor del vendedor.",
    motivo: "Cuando la propiedad tiene hipoteca vigente: dice cuánto pagar para alzarla.",
    responsable: "vendedor",
    requeridoEn: "escrituracion",
    obligatorio: false,
  },
];

export function documentoPropiedad(id: DocumentoPropiedadId): DocumentoPropiedad | undefined {
  return DOCUMENTOS_PROPIEDAD.find((item) => item.id === id);
}

/** Documentos que corresponden según el tipo de propiedad. */
export function documentosDeLaOperacion(opciones: {
  esCopropiedad: boolean;
  vendedorConHipoteca: boolean;
  vendedorCasado: boolean;
}): DocumentoPropiedad[] {
  return DOCUMENTOS_PROPIEDAD.filter((item) => {
    if (item.soloCopropiedad && !opciones.esCopropiedad) return false;
    if (item.id === "certificado_deuda_hipotecaria") return opciones.vendedorConHipoteca;
    if (item.id === "certificado_matrimonio_vendedor") return opciones.vendedorCasado;
    return true;
  });
}

export interface DocumentoNegocio {
  documento: DocumentoPropiedadId;
  /** Fecha de emisión del certificado: de ahí se calcula el vencimiento. */
  emitidoEn: string | null;
  recibidoEn: string | null;
  /** Solo metadatos; el archivo vive fuera de la base. */
  archivo: { nombre: string; mime: string; referencia: string } | null;
  nota: string | null;
}

export type EstadoVigencia = "sin_recibir" | "vigente" | "por_vencer" | "vencido" | "sin_vencimiento";

export interface Vigencia {
  estado: EstadoVigencia;
  venceEn: string | null;
  diasRestantes: number | null;
}

/** Días antes del vencimiento en que conviene volver a pedir el certificado. */
export const DIAS_AVISO_VENCIMIENTO = 7;

export function vigenciaDocumento(
  registro: DocumentoNegocio,
  ahora = new Date(),
): Vigencia {
  const definicion = documentoPropiedad(registro.documento);

  if (!registro.recibidoEn) {
    return { estado: "sin_recibir", venceEn: null, diasRestantes: null };
  }
  if (!definicion || definicion.vigenciaDias === null) {
    return { estado: "sin_vencimiento", venceEn: null, diasRestantes: null };
  }

  // Vence desde la emisión, no desde que lo recibimos: un certificado
  // sacado hace tres semanas llega con tres semanas menos de vida.
  const base = new Date(registro.emitidoEn ?? registro.recibidoEn);
  const vence = new Date(base);
  vence.setDate(vence.getDate() + definicion.vigenciaDias);

  const diasRestantes = Math.ceil((vence.getTime() - ahora.getTime()) / 86_400_000);

  return {
    estado:
      diasRestantes < 0 ? "vencido" : diasRestantes <= DIAS_AVISO_VENCIMIENTO ? "por_vencer" : "vigente",
    venceEn: vence.toISOString(),
    diasRestantes,
  };
}
