/**
 * Frenos de envío. El agente es autónomo, pero dentro de estos límites.
 *
 * Sin esto, un agente que responde solo termina escribiendo a las 3 de la
 * mañana, insistiéndole cinco veces a alguien que no contesta, o siguiendo
 * la conversación cuando el comprador ya pidió hablar con una persona.
 */

import { ZONA_HORARIA } from "@/lib/dominio/chile";
import type { Lead, Mensaje } from "@/lib/dominio/tipos";

export interface Politica {
  /** Horario en que se puede escribir, hora de Chile. */
  horaInicio: number;
  horaFin: number;
  /** Tope de mensajes automáticos al mismo lead en un día. */
  maxPorDia: number;
  /** Tope de seguimientos consecutivos sin que el comprador responda. */
  maxSinRespuesta: number;
  /** Minutos mínimos entre dos mensajes automáticos al mismo lead. */
  minutosEntreMensajes: number;
  /**
   * Tope que no se salta ni contestando. Es la red de seguridad contra un
   * bucle: si algo se descontrola, el agente se detiene igual.
   */
  maxPorDiaAbsoluto: number;
}

export const POLITICA_POR_DEFECTO: Politica = {
  horaInicio: 9,
  horaFin: 21,
  maxPorDia: 3,
  maxSinRespuesta: 3,
  minutosEntreMensajes: 10,
  maxPorDiaAbsoluto: 12,
};

export interface Veredicto {
  permitido: boolean;
  motivo?: string;
  /** Cuándo se podría enviar, si el bloqueo es por horario. */
  reintentarEn?: Date;
}

function horaEnChile(fecha: Date): number {
  return Number(
    new Intl.DateTimeFormat("es-CL", {
      timeZone: ZONA_HORARIA,
      hour: "2-digit",
      hour12: false,
    }).format(fecha),
  );
}

function diaEnChile(fecha: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_HORARIA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(fecha);
}

/**
 * Ventana de 24 horas de WhatsApp: fuera de ella solo se pueden enviar
 * plantillas aprobadas, no texto libre.
 */
export function dentroDeVentana24h(lead: Lead, ahora = new Date()): boolean {
  if (!lead.ultimoEntranteEn) return false;
  const transcurrido = ahora.getTime() - new Date(lead.ultimoEntranteEn).getTime();
  return transcurrido < 24 * 60 * 60 * 1000;
}

export function horasRestantesDeVentana(lead: Lead, ahora = new Date()): number | null {
  if (!lead.ultimoEntranteEn) return null;
  const restante =
    24 * 60 * 60 * 1000 - (ahora.getTime() - new Date(lead.ultimoEntranteEn).getTime());
  return restante > 0 ? Math.round((restante / 3600000) * 10) / 10 : null;
}

/** Próximo instante dentro del horario permitido. */
function proximaHoraHabil(politica: Politica, ahora: Date): Date {
  const hora = horaEnChile(ahora);
  const proximo = new Date(ahora);
  if (hora < politica.horaInicio) {
    proximo.setUTCHours(proximo.getUTCHours() + (politica.horaInicio - hora));
  } else {
    proximo.setUTCHours(proximo.getUTCHours() + (24 - hora + politica.horaInicio));
  }
  return proximo;
}

export interface ContextoEnvio {
  lead: Lead;
  mensajes: Mensaje[];
  /**
   * El mensaje contesta algo que el comprador acaba de escribir.
   *
   * En ese caso no aplican el horario, el tope diario ni el espaciado: esos
   * frenos existen para que el agente no insista por iniciativa propia, no
   * para impedirle responder. Sí siguen aplicando el opt-out, la conversación
   * tomada por una persona y el tope absoluto del día.
   */
  esRespuesta?: boolean;
  ahora?: Date;
  politica?: Politica;
}

export function puedeEnviar(contexto: ContextoEnvio): Veredicto {
  const politica = contexto.politica ?? POLITICA_POR_DEFECTO;
  const ahora = contexto.ahora ?? new Date();
  const { lead, mensajes } = contexto;

  if (lead.optOut) {
    return { permitido: false, motivo: "El comprador pidió no recibir más mensajes" };
  }

  if (lead.enManosDeHumano) {
    return { permitido: false, motivo: "La conversación la tomó una persona del equipo" };
  }

  const automaticosHoy = mensajes.filter(
    (mensaje) =>
      mensaje.direccion === "saliente" &&
      mensaje.automatico &&
      diaEnChile(new Date(mensaje.enviadoEn)) === diaEnChile(ahora),
  );

  // Este tope no se salta nunca, ni contestando.
  if (automaticosHoy.length >= politica.maxPorDiaAbsoluto) {
    return {
      permitido: false,
      motivo: `Se alcanzó el tope absoluto de ${politica.maxPorDiaAbsoluto} mensajes en el día`,
    };
  }

  // Contestar lo que el comprador acaba de escribir no espera al horario ni
  // al espaciado: esos frenos son para los seguimientos por iniciativa propia.
  if (contexto.esRespuesta) return { permitido: true };

  const hora = horaEnChile(ahora);
  if (hora < politica.horaInicio || hora >= politica.horaFin) {
    return {
      permitido: false,
      motivo: `Fuera del horario de contacto (${politica.horaInicio}:00 a ${politica.horaFin}:00 en Chile)`,
      reintentarEn: proximaHoraHabil(politica, ahora),
    };
  }

  if (automaticosHoy.length >= politica.maxPorDia) {
    return {
      permitido: false,
      motivo: `Se alcanzó el tope de ${politica.maxPorDia} mensajes automáticos en el día`,
    };
  }

  const ultimo = [...mensajes]
    .filter((mensaje) => mensaje.direccion === "saliente" && mensaje.automatico)
    .sort((a, b) => b.enviadoEn.localeCompare(a.enviadoEn))[0];
  if (ultimo) {
    const minutos = (ahora.getTime() - new Date(ultimo.enviadoEn).getTime()) / 60000;
    if (minutos < politica.minutosEntreMensajes) {
      return {
        permitido: false,
        motivo: `Hace ${Math.round(minutos)} min se envió otro mensaje; el mínimo es ${politica.minutosEntreMensajes} min`,
      };
    }
  }

  // Seguimientos consecutivos sin respuesta: después del último entrante,
  // cuántos salientes automáticos van seguidos.
  const ordenados = [...mensajes].sort((a, b) => a.enviadoEn.localeCompare(b.enviadoEn));
  let seguidos = 0;
  for (let i = ordenados.length - 1; i >= 0; i--) {
    const mensaje = ordenados[i];
    if (mensaje.direccion === "entrante") break;
    if (mensaje.automatico) seguidos += 1;
  }
  if (seguidos >= politica.maxSinRespuesta) {
    return {
      permitido: false,
      motivo: `Van ${seguidos} mensajes sin respuesta; corresponde que lo tome una persona`,
    };
  }

  return { permitido: true };
}

/**
 * Quita acentos antes de comparar. La gente escribe "borrenme" tanto como
 * "bórrenme", y una tilde no debería hacer que se pierda una solicitud de
 * baja o de supresión de datos.
 */
function sinAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Frases con que la gente pide en Chile que no le escriban más. */
const FRASES_BAJA = [
  /\bbaja\b/i,
  /\bstop\b/i,
  /\bno me (escrib|contact|llame|moleste)/i,
  /\bd[ée]jenme (en paz|tranquil)/i,
  /\bno estoy interesad/i,
  /\bya no me interesa\b/i,
  /\bquiero darme de baja\b/i,
  /\bdesuscrib/i,
];

export function pideBaja(texto: string): boolean {
  const limpio = sinAcentos(texto.trim());
  return FRASES_BAJA.some((frase) => frase.test(limpio));
}

/** Ejercicio de derechos de la Ley 21.719: hay que atenderlo, no responderlo con una plantilla. */
const FRASES_DERECHOS = [
  // Cubre las conjugaciones: elimina, elimine, eliminen, eliminar, borren…
  /\b(elimin|borr|supr)\w*\s+(mis|los|todos los)\s+datos\b/i,
  /\b(elimin|borr|supr)\w*\s+(mis|los|todos los)?\s*datos\b/i,
  /\bmis datos\s+(personales\s+)?(deben|los)?\s*(elimin|borr)/i,
  /\bderecho a (supresi[óo]n|acceso|rectificaci[óo]n|portabilidad|oposici[óo]n)\b/i,
  /\bqu[ée] datos (tienen|manejan|guardan) (de m[íi]|m[íi]os)\b/i,
  /\bley 21\.?719\b/i,
  /\bprotecci[óo]n de datos\b/i,
  /\bdarme de baja del registro\b/i,
];

export function ejerceDerechos(texto: string): boolean {
  const limpio = sinAcentos(texto);
  return FRASES_DERECHOS.some((frase) => frase.test(limpio));
}

/** Situaciones en que el agente no debe seguir solo. */
const FRASES_ESCALAMIENTO: Array<{ patron: RegExp; motivo: string }> = [
  { patron: /\bdescuento|rebaja|bajar el precio|contraoferta|ofrezco\b/i, motivo: "negociación de precio" },
  // "estafa" no está acá a propósito: la desconfianza se responde con hechos
  // y además se ofrece un ejecutivo, en vez de traspasarla en silencio.
  { patron: /\breclamo|sernac|abogad|demanda\b/i, motivo: "reclamo o asunto legal" },
  { patron: /\bhablar con (alguien|una persona|un ejecutivo|el corredor)\b/i, motivo: "pidió hablar con una persona" },
  { patron: /\beres un bot\b|\beres una m[áa]quina\b|\bhablo con un robot\b/i, motivo: "preguntó si es un bot" },
  { patron: /\bpromesa de compraventa|escritura|conservador de bienes\b/i, motivo: "trámite de cierre" },
];

export function motivoDeEscalamiento(texto: string): string | null {
  if (ejerceDerechos(texto)) return "ejercicio de derechos sobre sus datos";
  const limpio = sinAcentos(texto);
  for (const { patron, motivo } of FRASES_ESCALAMIENTO) {
    if (patron.test(limpio)) return motivo;
  }
  return null;
}
