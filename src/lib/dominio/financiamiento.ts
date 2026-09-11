/**
 * Cálculo de capacidad de compra con los criterios que usa la banca chilena.
 *
 * Reglas aplicadas:
 *  - El dividendo no puede superar el 25% de la renta líquida.
 *  - Las deudas vigentes (dividendos y cuotas de consumo) se descuentan de
 *    esa capacidad.
 *  - La renta variable se pondera al 50%: los bancos no la toman completa.
 *  - El pie mínimo es 20% del precio, salvo subsidio.
 *  - Con Dicom vigente la preaprobación es poco probable.
 */

import { PIE_MINIMO } from "@/lib/dominio/chile";
import type { PerfilFinanciero } from "@/lib/dominio/tipos";

export const TASA_ANUAL_REFERENCIA = 0.045;
export const PLAZO_ANOS = 25;
const CARGA_MAXIMA = 0.25;
const PONDERACION_VARIABLE = 0.5;

export interface CapacidadCompra {
  /** Renta líquida ponderada del grupo familiar, en pesos. */
  rentaPonderadaClp: number;
  /** Dividendo máximo que soporta, ya descontadas las deudas. */
  dividendoMaximoClp: number;
  /** Pie disponible, en UF. */
  pieUf: number;
  /** Techo de compra en UF. null si no hay datos suficientes. */
  precioMaximoUf: number | null;
  /** Qué limita la compra: la renta, el pie, el efectivo disponible, o nada aún. */
  restriccion: "renta" | "pie" | "dicom" | "contado" | "sin_datos";
  notas: string[];
}

function capitalDesdeDividendo(dividendoUf: number): number {
  const tasaMensual = TASA_ANUAL_REFERENCIA / 12;
  const cuotas = PLAZO_ANOS * 12;
  const factor = Math.pow(1 + tasaMensual, cuotas);
  return (dividendoUf * (factor - 1)) / (tasaMensual * factor);
}

export interface ContextoCompra {
  /** Compra sin crédito: el techo es el efectivo que tiene. */
  pagaContado?: boolean;
  /** Postula a subsidio habitacional: el monto aprobado se suma al pie. */
  postulaSubsidio?: boolean;
}

export function capacidadCompra(
  perfil: PerfilFinanciero,
  valorUfClp: number,
  contexto: ContextoCompra = {},
): CapacidadCompra {
  const notas: string[] = [];

  const rentaBase = perfil.rentaClp ?? 0;
  const rentaVariable = (perfil.rentaVariableClp ?? 0) * PONDERACION_VARIABLE;
  const rentaPareja = perfil.tienePareja ? (perfil.rentaParejaClp ?? 0) : 0;
  const rentaParejaVariable = perfil.tienePareja
    ? (perfil.rentaParejaVariableClp ?? 0) * PONDERACION_VARIABLE
    : 0;
  const rentaPonderadaClp = rentaBase + rentaVariable + rentaPareja + rentaParejaVariable;

  if (rentaVariable > 0 || rentaParejaVariable > 0) {
    notas.push("La renta variable se pondera al 50%, como hace la banca.");
  }

  // "No lo mencionó" no es lo mismo que "no tiene": si el mensaje no habla
  // del ahorro, el pie queda por confirmar, no en cero.
  const declaraAhorro = perfil.ahorroClp !== null;
  const ahorroClp = perfil.ahorroClp ?? 0;
  const pieUf = valorUfClp > 0 ? Math.round((ahorroClp / valorUfClp) * 10) / 10 : 0;

  if (contexto.pagaContado && ahorroClp > 0) {
    // Sin crédito no hay evaluación bancaria: el techo es lo que tiene.
    notas.push("Compra al contado: el techo es el efectivo disponible, sin evaluación bancaria.");
    return {
      rentaPonderadaClp,
      dividendoMaximoClp: 0,
      pieUf,
      precioMaximoUf: Math.round(pieUf),
      restriccion: "contado",
      notas,
    };
  }

  if (contexto.postulaSubsidio) {
    notas.push(
      "Postula a subsidio habitacional: el monto que le aprueben se suma al pie y no está considerado en este techo.",
    );
  }

  if (perfil.tieneDicom === true) {
    notas.push("Registra Dicom: la preaprobación hipotecaria es poco probable hasta regularizar.");
    return {
      rentaPonderadaClp,
      dividendoMaximoClp: 0,
      pieUf,
      precioMaximoUf: null,
      restriccion: "dicom",
      notas,
    };
  }

  if (rentaPonderadaClp === 0) {
    notas.push("Falta la renta líquida para estimar el crédito.");
    return {
      rentaPonderadaClp,
      dividendoMaximoClp: 0,
      pieUf,
      precioMaximoUf: null,
      restriccion: "sin_datos",
      notas,
    };
  }

  const deudasClp = (perfil.dividendosMensualesClp ?? 0) + (perfil.cuotasConsumoMensualesClp ?? 0);
  const dividendoMaximoClp = Math.max(rentaPonderadaClp * CARGA_MAXIMA - deudasClp, 0);

  if (deudasClp > 0) {
    notas.push(
      `Se descuentan $${deudasClp.toLocaleString("es-CL")} de deudas vigentes de la capacidad mensual.`,
    );
  }

  if (dividendoMaximoClp === 0) {
    notas.push("Las deudas vigentes consumen toda la capacidad de pago.");
    return { rentaPonderadaClp, dividendoMaximoClp, pieUf, precioMaximoUf: null, restriccion: "renta", notas };
  }

  const creditoMaximoUf = capitalDesdeDividendo(dividendoMaximoClp / valorUfClp);
  const porRenta = creditoMaximoUf + pieUf;
  const porPie = pieUf > 0 ? pieUf / PIE_MINIMO : 0;

  let precioMaximoUf: number;
  let restriccion: CapacidadCompra["restriccion"];

  if (!declaraAhorro) {
    // Techo conservador: solo el crédito que soporta su renta. Al no saber
    // el pie, no se le suma nada encima.
    precioMaximoUf = creditoMaximoUf;
    restriccion = "renta";
    notas.push("No declara ahorro para el pie: el techo considera solo el crédito. Confirmar el pie antes de cotizar.");
  } else if (pieUf === 0) {
    precioMaximoUf = 0;
    restriccion = "pie";
    notas.push("Sin ahorro para el pie: la banca exige al menos 20% del precio.");
  } else if (porPie < porRenta) {
    precioMaximoUf = porPie;
    restriccion = "pie";
    notas.push("El pie es el techo: alcanza para más crédito del que cubre el ahorro.");
  } else {
    precioMaximoUf = porRenta;
    restriccion = "renta";
  }

  return {
    rentaPonderadaClp,
    dividendoMaximoClp: Math.round(dividendoMaximoClp),
    pieUf,
    precioMaximoUf: Math.round(precioMaximoUf),
    restriccion,
    notas,
  };
}
