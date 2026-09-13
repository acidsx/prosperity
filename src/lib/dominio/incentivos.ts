/**
 * Beneficios estatales y tributarios vigentes: garantías, subsidios e IVA.
 *
 * Esto es lo que más rápido se echa a perder de todo el sistema. FOGAES
 * tiene fecha de término y cupos, los subsidios abren y cierran por llamado,
 * y el crédito especial de IVA a la construcción viene en extinción por ley
 * con una tasa distinta cada año. Un agente que cite un beneficio que venció
 * el mes pasado no está siendo útil: está comprometiendo a la corredora.
 *
 * Por eso el registro no vive en el código sino en `datos/incentivos.json`,
 * y cada entrada obliga a declarar tres cosas:
 *
 *   fuente        de dónde salió el dato, para poder ir a verificarlo
 *   verificadoEn  cuándo lo miró una persona por última vez
 *   vigenciaHasta hasta cuándo sirve
 *
 * El agente solo recibe los que están vigentes Y verificados hace poco. Lo
 * vencido, lo que está por vencer y lo que lleva demasiado sin revisar salen
 * como alertas para el equipo, no como argumentos de venta.
 */

import { PIE_MINIMO } from "@/lib/dominio/chile";
import { capitalDesdeDividendo } from "@/lib/dominio/financiamiento";

export type TipoIncentivo =
  /** Garantía estatal que permite financiar un porcentaje mayor. */
  | "garantia_estatal"
  /** Subsidio habitacional: plata que se suma al pie. */
  | "subsidio"
  /** Beneficio tributario. Ojo con quién es el beneficiario. */
  | "tributario";

/** Quién recibe el beneficio. No es lo mismo y no se puede prometer al revés. */
export type Beneficiario = "comprador" | "constructora";

export type EstadoTramitacion = "vigente" | "en_tramite" | "derogado";

export interface Incentivo {
  id: string;
  nombre: string;
  tipo: TipoIncentivo;
  organismo: string;
  beneficiario: Beneficiario;
  estado: EstadoTramitacion;
  /** Qué hace, en una frase que el agente pueda decir. */
  resumen: string;
  /** Condiciones que hay que cumplir. Van todas, no las convenientes. */
  requisitos: string[];
  /** Lo que hay que advertir siempre que se mencione. */
  advertencias: string[];
  /** Precio máximo de la vivienda para calificar, en UF. */
  topeViviendaUf: number | null;
  /** Financiamiento máximo que habilita (0.9 = 90%). Solo garantías. */
  financiamientoMaximo: number | null;
  /** Monto que aporta al pie, en UF. Solo subsidios. */
  aporteUf: number | null;
  /** Ahorro mínimo exigido en la libreta, en UF. */
  ahorroMinimoUf: number | null;
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
  fuente: string;
  verificadoEn: string;
  /** verificado: se leyó la fuente. por_confirmar: hay que ir a mirarla. */
  confianza: "verificado" | "por_confirmar";
  notas: string | null;
}

export type EstadoVigencia =
  | "vigente"
  | "por_vencer"
  | "vencido"
  | "sin_verificar"
  | "no_aplica";

/** Cuánto puede pasar sin que una persona revise la fuente. */
export const DIAS_PARA_REVERIFICAR = 90;
/** Con cuánta anticipación se avisa que algo va a vencer. */
export const DIAS_AVISO_VENCIMIENTO = 60;

function dias(desde: Date, hasta: Date): number {
  return Math.round((hasta.getTime() - desde.getTime()) / 86_400_000);
}

/**
 * En qué estado está un incentivo hoy.
 *
 * El orden de los chequeos importa: primero si dejó de existir, después si
 * está por vencer, y al final si lleva mucho sin que nadie lo mire. Un dato
 * viejo que además venció no es "viejo", está vencido.
 */
export function estadoDeVigencia(incentivo: Incentivo, hoy = new Date()): EstadoVigencia {
  if (incentivo.estado !== "vigente") return "no_aplica";

  if (incentivo.vigenciaDesde && new Date(incentivo.vigenciaDesde) > hoy) return "no_aplica";
  if (incentivo.vigenciaHasta && new Date(incentivo.vigenciaHasta) < hoy) return "vencido";

  if (incentivo.confianza === "por_confirmar") return "sin_verificar";
  if (dias(new Date(incentivo.verificadoEn), hoy) > DIAS_PARA_REVERIFICAR) return "sin_verificar";

  if (
    incentivo.vigenciaHasta &&
    dias(hoy, new Date(incentivo.vigenciaHasta)) <= DIAS_AVISO_VENCIMIENTO
  ) {
    return "por_vencer";
  }

  return "vigente";
}

/**
 * Los que el agente puede usar en una conversación.
 *
 * "Por vencer" sí entra: todavía sirve y justamente hay que apurar. Lo que
 * no entra es lo vencido y lo que nadie ha verificado, porque el costo de
 * equivocarse lo paga el comprador.
 */
export function incentivosUtilizables(incentivos: Incentivo[], hoy = new Date()): Incentivo[] {
  return incentivos.filter((incentivo) => {
    const estado = estadoDeVigencia(incentivo, hoy);
    return estado === "vigente" || estado === "por_vencer";
  });
}

export interface AlertaIncentivo {
  incentivo: Incentivo;
  estado: EstadoVigencia;
  mensaje: string;
}

/** Lo que el equipo tiene que ir a revisar. */
export function alertasDeIncentivos(incentivos: Incentivo[], hoy = new Date()): AlertaIncentivo[] {
  const alertas: AlertaIncentivo[] = [];

  for (const incentivo of incentivos) {
    const estado = estadoDeVigencia(incentivo, hoy);

    if (estado === "vencido") {
      alertas.push({
        incentivo,
        estado,
        mensaje: `Venció el ${incentivo.vigenciaHasta}. El agente ya no lo menciona; hay que confirmar si se prorrogó.`,
      });
    } else if (estado === "por_vencer") {
      const restantes = incentivo.vigenciaHasta ? dias(hoy, new Date(incentivo.vigenciaHasta)) : 0;
      alertas.push({
        incentivo,
        estado,
        mensaje: `Vence en ${restantes} días (${incentivo.vigenciaHasta}). Confirmar prórroga antes de seguir ofreciéndolo.`,
      });
    } else if (estado === "sin_verificar") {
      const antiguedad = dias(new Date(incentivo.verificadoEn), hoy);
      alertas.push({
        incentivo,
        estado,
        mensaje:
          incentivo.confianza === "por_confirmar"
            ? `Marcado por confirmar: nadie ha leído la fuente. Mientras tanto el agente no lo usa.`
            : `Sin verificar hace ${antiguedad} días. Revisar ${incentivo.fuente}.`,
      });
    } else if (incentivo.estado === "en_tramite") {
      alertas.push({
        incentivo,
        estado: "no_aplica",
        mensaje: `En tramitación: todavía no es ley. Seguirlo, pero no ofrecerlo.`,
      });
    }
  }

  return alertas;
}

// ------------------------------------------------------ efecto en la compra

export interface EfectoEnCapacidad {
  incentivo: Incentivo;
  /** Fracción del precio que financia el banco con este incentivo. */
  financiamiento: number;
  /** Pie que pide, como fracción del precio. */
  fraccionPie: number;
  /** Precio máximo que habilita, considerando el pie disponible y su tope. */
  precioMaximoUf: number | null;
}

/**
 * Qué precio habilita una garantía estatal con el pie que ya tiene.
 *
 * Es el cálculo que cambia una conversación: con 20% de pie, UF 450 de
 * ahorro alcanzan para UF 2.250. Con una garantía que permite 10%, las
 * mismas UF 450 alcanzan para UF 4.500 — con el tope del programa como
 * límite y un dividendo más alto, que también hay que decir.
 */
export function efectoEnCapacidad(
  incentivo: Incentivo,
  pieDisponibleUf: number,
  /**
   * Dividendo máximo que soporta su renta, en UF.
   *
   * Sin esto el cálculo miente por omisión: bajar el pie a 10% deja de ser
   * el ahorro el límite, pero entonces el límite pasa a ser la renta — y con
   * 90% financiado el dividendo es mayor, no menor. Un techo que la renta no
   * soporta es un rechazo del banco tres semanas después.
   */
  dividendoMaximoUf?: number,
): EfectoEnCapacidad | null {
  if (incentivo.tipo !== "garantia_estatal" || !incentivo.financiamientoMaximo) return null;

  // Redondeado: 1 - 0,9 da 0,09999999999999998 y ese número termina impreso
  // en una ficha que alguien va a leer.
  const fraccionPie = Math.round((1 - incentivo.financiamientoMaximo) * 1000) / 1000;
  if (fraccionPie <= 0 || fraccionPie >= PIE_MINIMO) return null;

  const topes = [pieDisponibleUf / fraccionPie];
  if (incentivo.topeViviendaUf) topes.push(incentivo.topeViviendaUf);
  if (dividendoMaximoUf !== undefined && dividendoMaximoUf > 0) {
    topes.push(capitalDesdeDividendo(dividendoMaximoUf) / incentivo.financiamientoMaximo);
  }

  return {
    incentivo,
    financiamiento: incentivo.financiamientoMaximo,
    fraccionPie,
    precioMaximoUf: Math.round(Math.min(...topes)),
  };
}

/** Texto de una línea para la ficha de hechos. */
export function resumenParaFicha(incentivo: Incentivo): string {
  const partes = [
    `${incentivo.nombre} (${incentivo.organismo})`,
    incentivo.beneficiario === "constructora"
      ? "BENEFICIARIO: la constructora, NO el comprador"
      : null,
    incentivo.resumen,
    incentivo.topeViviendaUf ? `Tope de vivienda: UF ${incentivo.topeViviendaUf.toLocaleString("es-CL")}` : null,
    incentivo.ahorroMinimoUf ? `Ahorro mínimo: UF ${incentivo.ahorroMinimoUf}` : null,
    incentivo.vigenciaHasta ? `Vigente hasta: ${incentivo.vigenciaHasta}` : null,
    `Requisitos: ${incentivo.requisitos.join(" · ")}`,
    `Advertencias: ${incentivo.advertencias.join(" · ")}`,
    `Fuente: ${incentivo.fuente} (verificado ${incentivo.verificadoEn})`,
  ].filter(Boolean);
  return partes.join("\n   ");
}
