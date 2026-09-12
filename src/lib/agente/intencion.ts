/**
 * Clasificación de lo que quiere el comprador en un mensaje entrante.
 *
 * Cuando el mensaje viene de un botón de plantilla no se usa el modelo: el
 * identificador del botón ya dice la intención y adivinarla sería peor.
 */

import { z } from "zod";

export const INTENCIONES = [
  "confirma_visita",
  "reagendar",
  "cancelar",
  "enviara_documentos",
  "consulta_documentos",
  "pregunta_precio",
  "pregunta_general",
  "pide_humano",
  "opt_out",
  "saludo",
  "otro",
] as const;

export type Intencion = (typeof INTENCIONES)[number];

export const EsquemaIntencion = z.object({
  intencion: z.enum(INTENCIONES),
  /** Preferencia de horario tal como la escribió, si mencionó alguna. */
  preferenciaHorario: z.string().nullable(),
  /** Pregunta concreta a responder, si hay una. */
  pregunta: z.string().nullable(),
  urgente: z.boolean().describe("Si espera respuesta hoy"),
  resumen: z.string().describe("Una frase con lo que pide"),
});

export type LecturaIntencion = z.infer<typeof EsquemaIntencion>;

/** Identificadores de los botones de las plantillas del catálogo. */
const INTENCION_POR_BOTON: Record<string, Intencion> = {
  confirmar_visita: "confirma_visita",
  reagendar_visita: "reagendar",
  cancelar_visita: "cancelar",
};

export function intencionDeBoton(idBoton: string | null): Intencion | null {
  if (!idBoton) return null;
  return INTENCION_POR_BOTON[idBoton] ?? null;
}

/** Reglas para operar sin modelo. Cubre las respuestas cortas, que son la mayoría. */
export function intencionHeuristica(texto: string): LecturaIntencion {
  const plano = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

  const detectar = (): Intencion => {
    if (/^(si|si!|sii+|dale|ok|okey|confirmo|confirmado|perfecto|dale gracias|de acuerdo)\b/.test(plano)) {
      return "confirma_visita";
    }
    if (/\b(confirm)/.test(plano) && !/\bno\b/.test(plano)) return "confirma_visita";
    if (/\b(reagend|otro (dia|horario)|cambiar (la )?hora|mover|puedo otro|no puedo ese)/.test(plano)) {
      return "reagendar";
    }
    if (/\b(cancel|ya no (puedo|quiero|me interesa)|desisto)/.test(plano)) return "cancelar";
    if (/\b(mando|env[ií]o|te paso|adjunto|ahi van|los subo) (los |las )?(documento|papel|liquidacion|cartola)/.test(plano)) {
      return "enviara_documentos";
    }
    if (/\b(que documento|cuales documento|que papeles|que necesito|que piden)/.test(plano)) {
      return "consulta_documentos";
    }
    if (/\b(precio|cuanto (vale|cuesta|sale)|descuento|rebaja|dividendo|pie|gastos comunes)/.test(plano)) {
      return "pregunta_precio";
    }
    if (/\b(hablar con|una persona|un ejecutivo|llamar|telefono)/.test(plano)) return "pide_humano";
    if (/\b(baja|stop|no me escrib|desuscrib)/.test(plano)) return "opt_out";
    if (/^(hola|buenas|buenos dias|buenas tardes|que tal|hey)\b/.test(plano) && plano.length < 30) {
      return "saludo";
    }
    if (/\?/.test(texto)) return "pregunta_general";
    return "otro";
  };

  const horario = texto.match(
    /\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[áa]bado|domingo|ma[ñn]ana|hoy|pasado ma[ñn]ana)[^.,;!?]*/i,
  );

  return {
    intencion: detectar(),
    preferenciaHorario: horario ? horario[0].trim() : null,
    pregunta: texto.includes("?") ? texto : null,
    urgente: /\bhoy\b|\burgente\b|\bahora\b/.test(plano),
    resumen: texto.slice(0, 120),
  };
}
