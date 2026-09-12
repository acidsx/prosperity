/**
 * Compra de departamentos para arriendo: los números que deciden si el
 * negocio es negocio.
 *
 * Al inversionista no hay que convencerlo con emoción, hay que mostrarle
 * flujo. Y el flujo de un departamento comprado con crédito en Chile hoy
 * **es negativo los primeros años**: el arriendo no alcanza a cubrir el
 * dividendo. Que "se paga solo" es la frase más repetida y más falsa del
 * rubro, y este módulo existe para no poder decirla.
 *
 * Lo que sí es cierto, y hay que decir completo, es que una parte del
 * dividendo no es gasto sino amortización: capital que pasa de su bolsillo a
 * su patrimonio. El costo real del mes es el interés, no la cuota entera.
 *
 * Todos los porcentajes de acá son referencias de mercado, no tasaciones, y
 * se presentan como tales. Los que dependen del banco (financiamiento,
 * reconocimiento del arriendo como renta) se marcan aparte.
 */

import { PIE_MINIMO } from "@/lib/dominio/chile";
import { TASA_ANUAL_REFERENCIA, PLAZO_ANOS } from "@/lib/dominio/financiamiento";
import type { PerfilFinanciero } from "@/lib/dominio/tipos";

/** Retorno bruto por arriendo sobre el precio, anual. Referencia de mercado. */
export const RETORNO_ARRIENDO_ANUAL = 0.045;

/**
 * Financiamiento máximo del banco.
 *
 * La primera vivienda llega al 80%. De ahí en adelante, tratándose de
 * inversión, la banca chilena baja al 70% y a veces menos: el pie por unidad
 * sube de 20% a 30%, que es lo que más limita una cartera.
 */
export const FINANCIAMIENTO_PRIMERA = 1 - PIE_MINIMO;
export const FINANCIAMIENTO_INVERSION = 0.7;

/** Un mes de vacancia al año es lo normal entre arrendatarios. */
export const VACANCIA_ANUAL = 1 / 12;
/** Comisión de administración de arriendo, sobre lo efectivamente recaudado. */
export const ADMINISTRACION_ARRIENDO = 0.08;
/**
 * Contribuciones anuales, como fracción del precio comercial.
 *
 * La tasa legal corre sobre el avalúo fiscal, que suele ir bastante por
 * debajo del comercial; 0,8% del precio es la aproximación que deja el
 * mismo orden de magnitud. Un DFL2 puede pagar menos.
 */
export const CONTRIBUCIONES_ANUAL = 0.008;
/** Mantención y reparaciones del propietario, anual sobre el precio. */
export const MANTENCION_ANUAL = 0.005;
/** Carga financiera máxima que acepta la banca sobre la renta líquida. */
const CARGA_MAXIMA = 0.25;
const PONDERACION_VARIABLE = 0.5;

export interface SupuestosArriendo {
  /** Arriendo mensual de mercado. Si no se entrega, se estima. */
  arriendoMensualClp?: number;
  /** Gastos comunes del departamento: los paga el dueño solo si está vacío. */
  gastosComunesClp?: number;
  tasaAnual?: number;
  plazoAnos?: number;
  /** Vacancia anual como fracción. Por defecto, un mes al año. */
  vacanciaAnual?: number;
}

export interface EconomiaUnidad {
  /** Lugar en la cartera: la primera se financia distinto que las siguientes. */
  orden: number;
  precioUf: number;
  financiamiento: number;
  pieUf: number;
  creditoUf: number;
  dividendoClp: number;
  /** Del dividendo, la parte que es interés (gasto real) el primer mes. */
  interesClp: number;
  /** Del dividendo, la parte que se convierte en patrimonio. */
  amortizacionClp: number;
  arriendoBrutoClp: number;
  /** Arriendo ya descontadas vacancia, administración, contribuciones y mantención. */
  arriendoNetoClp: number;
  /** Arriendo neto menos dividendo. Negativo significa que le cuesta plata. */
  flujoMensualClp: number;
  /** Flujo contando solo el interés: lo que de verdad "pierde" el mes. */
  costoRealMensualClp: number;
  rentabilidadBrutaAnual: number;
  rentabilidadNetaAnual: number;
}

/** Arriendo de mercado estimado para una propiedad de ese precio. */
export function arriendoDeMercadoClp(precioUf: number, valorUfClp: number): number {
  return Math.round((precioUf * valorUfClp * RETORNO_ARRIENDO_ANUAL) / 12 / 10_000) * 10_000;
}

/** Cuota mensual de un crédito hipotecario, en la moneda del capital. */
function cuota(capital: number, tasaAnual: number, anos: number): number {
  if (capital <= 0) return 0;
  const tasaMensual = tasaAnual / 12;
  const cuotas = anos * 12;
  const factor = Math.pow(1 + tasaMensual, cuotas);
  return (capital * tasaMensual * factor) / (factor - 1);
}

/**
 * La economía de una unidad arrendada, mes a mes.
 *
 * `orden` decide el financiamiento: la primera propiedad de una persona se
 * financia al 80%, las siguientes al 70%.
 */
export function economiaUnidad(
  precioUf: number,
  valorUfClp: number,
  orden = 1,
  supuestos: SupuestosArriendo = {},
): EconomiaUnidad {
  const tasaAnual = supuestos.tasaAnual ?? TASA_ANUAL_REFERENCIA;
  const plazoAnos = supuestos.plazoAnos ?? PLAZO_ANOS;
  const financiamiento = orden <= 1 ? FINANCIAMIENTO_PRIMERA : FINANCIAMIENTO_INVERSION;

  const creditoUf = Math.round(precioUf * financiamiento * 10) / 10;
  const pieUf = Math.round((precioUf - creditoUf) * 10) / 10;
  const precioClp = precioUf * valorUfClp;

  const dividendoClp = cuota(creditoUf * valorUfClp, tasaAnual, plazoAnos);
  // Primera cuota: el interés corre sobre el capital completo.
  const interesClp = creditoUf * valorUfClp * (tasaAnual / 12);
  const amortizacionClp = dividendoClp - interesClp;

  const arriendoBrutoClp =
    supuestos.arriendoMensualClp ?? arriendoDeMercadoClp(precioUf, valorUfClp);
  const gastosComunesClp = supuestos.gastosComunesClp ?? 0;
  const vacancia = supuestos.vacanciaAnual ?? VACANCIA_ANUAL;

  // Todo anualizado y después repartido en doce: la vacancia y las
  // contribuciones no ocurren todos los meses.
  const recaudadoAnual = arriendoBrutoClp * 12 * (1 - vacancia);
  const administracionAnual = recaudadoAnual * ADMINISTRACION_ARRIENDO;
  const contribucionesAnual = precioClp * CONTRIBUCIONES_ANUAL;
  const mantencionAnual = precioClp * MANTENCION_ANUAL;
  // Los gastos comunes los paga el arrendatario; el dueño solo el mes vacío.
  const gastosComunesAnual = gastosComunesClp * 12 * vacancia;

  const netoAnual =
    recaudadoAnual -
    administracionAnual -
    contribucionesAnual -
    mantencionAnual -
    gastosComunesAnual;
  const arriendoNetoClp = netoAnual / 12;

  return {
    orden,
    precioUf,
    financiamiento,
    pieUf,
    creditoUf,
    dividendoClp: Math.round(dividendoClp),
    interesClp: Math.round(interesClp),
    amortizacionClp: Math.round(amortizacionClp),
    arriendoBrutoClp,
    arriendoNetoClp: Math.round(arriendoNetoClp),
    flujoMensualClp: Math.round(arriendoNetoClp - dividendoClp),
    costoRealMensualClp: Math.round(arriendoNetoClp - interesClp),
    rentabilidadBrutaAnual:
      Math.round(((arriendoBrutoClp * 12) / precioClp) * 10000) / 100,
    rentabilidadNetaAnual: Math.round((netoAnual / precioClp) * 10000) / 100,
  };
}

export interface PlanCartera {
  unidadesDeseadas: number;
  /** Cuántas puede comprar de verdad, con su renta y su ahorro. */
  unidadesFinanciables: number;
  /** Qué lo limita: el pie, la carga financiera, o las dos. */
  restriccion: "pie" | "renta" | "ambas" | "ninguna" | "sin_datos";
  unidades: EconomiaUnidad[];
  pieRequeridoUf: number;
  pieDisponibleUf: number;
  dividendoTotalClp: number;
  dividendoMaximoClp: number;
  arriendoNetoTotalClp: number;
  /** Lo que sale de su bolsillo cada mes con la cartera armada. */
  flujoMensualTotalClp: number;
  /** De ese flujo, lo que se convierte en patrimonio y no se pierde. */
  amortizacionTotalClp: number;
  costoRealTotalClp: number;
  notas: string[];
}

export interface OpcionesCartera extends SupuestosArriendo {
  /**
   * Fracción del arriendo proyectado que el banco reconoce como renta.
   *
   * Depende del banco y de la carpeta: algunos toman hasta la mitad, otros
   * nada hasta que existan contratos firmados. Por defecto cero, que es el
   * escenario conservador; subirlo cambia cuántas unidades salen.
   */
  reconocimientoArriendo?: number;
  /** Ya tiene una vivienda propia: la siguiente parte con financiamiento de inversión. */
  yaTienePropiedad?: boolean;
}

/**
 * Cuántos departamentos aguanta de verdad, y qué le cuesta tenerlos.
 *
 * Las unidades se van sumando de a una. Cada una consume pie y agrega
 * dividendo, y el dividendo de la anterior es deuda vigente para la
 * siguiente: por eso la cuarta casi nunca sale aunque el pie alcance.
 */
export function planificarCartera(
  perfil: PerfilFinanciero,
  precioUnitarioUf: number,
  unidadesDeseadas: number,
  valorUfClp: number,
  opciones: OpcionesCartera = {},
): PlanCartera {
  const notas: string[] = [];

  const rentaVariable = (perfil.rentaVariableClp ?? 0) * PONDERACION_VARIABLE;
  const rentaPareja = perfil.tienePareja ? (perfil.rentaParejaClp ?? 0) : 0;
  const rentaPonderadaClp = (perfil.rentaClp ?? 0) + rentaVariable + rentaPareja;
  if (rentaVariable > 0) {
    notas.push("La renta variable se pondera al 50%, como hace la banca.");
  }

  const deudasClp = (perfil.dividendosMensualesClp ?? 0) + (perfil.cuotasConsumoMensualesClp ?? 0);
  const dividendoMaximoClp = Math.max(rentaPonderadaClp * CARGA_MAXIMA - deudasClp, 0);
  if (deudasClp > 0) {
    notas.push(
      `Sus dividendos y cuotas vigentes ($${deudasClp.toLocaleString("es-CL")}) ya consumen parte de la carga financiera.`,
    );
  }

  const pieDisponibleUf =
    valorUfClp > 0 ? Math.round(((perfil.ahorroClp ?? 0) / valorUfClp) * 10) / 10 : 0;

  const vacio: PlanCartera = {
    unidadesDeseadas,
    unidadesFinanciables: 0,
    restriccion: "sin_datos",
    unidades: [],
    pieRequeridoUf: 0,
    pieDisponibleUf,
    dividendoTotalClp: 0,
    dividendoMaximoClp: Math.round(dividendoMaximoClp),
    arriendoNetoTotalClp: 0,
    flujoMensualTotalClp: 0,
    amortizacionTotalClp: 0,
    costoRealTotalClp: 0,
    notas,
  };

  if (rentaPonderadaClp === 0 || perfil.ahorroClp === null) {
    notas.push("Faltan la renta o el ahorro para dimensionar la cartera.");
    return vacio;
  }
  if (perfil.tieneDicom === true) {
    notas.push("Registra Dicom: sin regularizar eso, no hay crédito que evaluar.");
    return { ...vacio, restriccion: "sin_datos" };
  }

  const reconocimiento = opciones.reconocimientoArriendo ?? 0;
  if (reconocimiento > 0) {
    notas.push(
      `Se considera que el banco reconoce el ${Math.round(reconocimiento * 100)}% del arriendo proyectado como renta. Depende del banco: conviene confirmarlo antes de contar con ello.`,
    );
  }

  const unidades: EconomiaUnidad[] = [];
  let pieAcumuladoUf = 0;
  let dividendoAcumuladoClp = 0;
  let arriendoReconocidoClp = 0;
  let frenoPie = false;
  let frenoRenta = false;

  for (let i = 1; i <= Math.max(unidadesDeseadas, 1); i++) {
    const orden = opciones.yaTienePropiedad ? i + 1 : i;
    const unidad = economiaUnidad(precioUnitarioUf, valorUfClp, orden, opciones);

    const cabeElPie = pieAcumuladoUf + unidad.pieUf <= pieDisponibleUf;
    const cabeLaRenta =
      dividendoAcumuladoClp + unidad.dividendoClp <=
      dividendoMaximoClp + arriendoReconocidoClp + unidad.arriendoBrutoClp * reconocimiento;

    if (!cabeElPie) frenoPie = true;
    if (!cabeLaRenta) frenoRenta = true;
    if (!cabeElPie || !cabeLaRenta) break;

    unidades.push(unidad);
    pieAcumuladoUf += unidad.pieUf;
    dividendoAcumuladoClp += unidad.dividendoClp;
    arriendoReconocidoClp += unidad.arriendoBrutoClp * reconocimiento;
  }

  const restriccion: PlanCartera["restriccion"] =
    frenoPie && frenoRenta ? "ambas" : frenoPie ? "pie" : frenoRenta ? "renta" : "ninguna";

  if (unidades.length > 0 && unidades[0].financiamiento < FINANCIAMIENTO_PRIMERA) {
    notas.push(
      `Al no ser primera vivienda, el banco financia el ${Math.round(unidades[0].financiamiento * 100)}%: el pie sube de 20% a ${Math.round((1 - unidades[0].financiamiento) * 100)}% por unidad.`,
    );
  }

  const suma = (extraer: (unidad: EconomiaUnidad) => number) =>
    Math.round(unidades.reduce((total, unidad) => total + extraer(unidad), 0));

  return {
    unidadesDeseadas,
    unidadesFinanciables: unidades.length,
    restriccion,
    unidades,
    pieRequeridoUf: Math.round(pieAcumuladoUf * 10) / 10,
    pieDisponibleUf,
    dividendoTotalClp: suma((unidad) => unidad.dividendoClp),
    dividendoMaximoClp: Math.round(dividendoMaximoClp),
    arriendoNetoTotalClp: suma((unidad) => unidad.arriendoNetoClp),
    flujoMensualTotalClp: suma((unidad) => unidad.flujoMensualClp),
    amortizacionTotalClp: suma((unidad) => unidad.amortizacionClp),
    costoRealTotalClp: suma((unidad) => unidad.costoRealMensualClp),
    notas,
  };
}

/** Pie que necesitaría para llegar a las unidades que quiere. */
export function pieFaltanteUf(plan: PlanCartera, precioUnitarioUf: number): number {
  const faltantes = plan.unidadesDeseadas - plan.unidadesFinanciables;
  if (faltantes <= 0) return 0;
  const porUnidad = precioUnitarioUf * (1 - FINANCIAMIENTO_INVERSION);
  return Math.round(faltantes * porUnidad * 10) / 10;
}
