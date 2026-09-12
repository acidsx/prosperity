/**
 * El agente dimensionando una cartera de inversión.
 *
 * Un inversionista no pregunta "¿me alcanza?", llega diciendo cuántos
 * departamentos quiere. El trabajo del agente es decirle cuántos le dan de
 * verdad y qué le van a costar al mes, antes de mostrarle una sola unidad.
 *
 * Las dos cosas que acá no se pueden hacer:
 *  - prometer que el arriendo cubre el dividendo cuando no lo cubre;
 *  - dar por hecho que el banco reconocerá el arriendo como renta, porque
 *    eso lo decide cada banco con la carpeta en la mano.
 */

import "server-only";

import { formatearClp, formatearPorcentaje, formatearUf } from "@/lib/dominio/chile";
import {
  pieFaltanteUf,
  planificarCartera,
  type OpcionesCartera,
  type PlanCartera,
} from "@/lib/dominio/inversion";
import type { PerfilFinanciero } from "@/lib/dominio/tipos";

/** Cuántas unidades pide, leído del texto. "un par" y "varios" incluidos. */
export function unidadesPedidas(texto: string): number | null {
  const limpio = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  const palabras: Record<string, number> = {
    un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
    siete: 7, ocho: 8, nueve: 9, diez: 10, "un par": 2,
  };

  // El "de" de "un par de departamentos" va opcional: en la práctica la
  // gente escribe las dos formas.
  const conNumero = limpio.match(
    /\b(\d{1,2})\s+(?:de\s+)?(departamento|depto|unidad|propiedad|deptos|departamentos|unidades|propiedades)/,
  );
  if (conNumero) return Number(conNumero[1]);

  const conPalabra = limpio.match(
    /\b(un par|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:de\s+)?(departamento|depto|unidad|propiedad|deptos|departamentos|unidades|propiedades)/,
  );
  if (conPalabra) return palabras[conPalabra[1]] ?? null;

  // "varios" no dice cuántos: hay que preguntarlo, no inventarlo.
  return null;
}

export interface ContextoPlan {
  primerNombre: string;
  perfil: PerfilFinanciero;
  precioUnitarioUf: number;
  unidadesDeseadas: number;
  valorUfClp: number;
  proyecto: string | null;
  comuna: string | null;
  opciones?: OpcionesCartera;
  /**
   * Techo que la calificación estándar le dio para UNA propiedad.
   *
   * Cuando existe hay que desarmarlo explícitamente: el inversionista acaba
   * de leer que puede comprar hasta UF X y va a suponer que son X repartidas
   * en cuatro unidades. No lo son — el pie sube y cada dividendo pesa sobre
   * el siguiente crédito.
   */
  topeUnaPropiedadUf?: number | null;
}

export interface MensajePlan {
  plan: PlanCartera;
  texto: string;
  /** true cuando le alcanza para menos de lo que pidió. */
  ajustaExpectativa: boolean;
}

/**
 * Arma el plan y lo escribe.
 *
 * El orden del mensaje es deliberado: primero cuántas unidades salen y qué
 * las frena, después lo que cuesta el mes, y recién al final la parte buena.
 * Al revés se lee como un folleto.
 */
export function planDeCartera(contexto: ContextoPlan): MensajePlan {
  const { primerNombre, precioUnitarioUf, unidadesDeseadas, valorUfClp } = contexto;
  const plan = planificarCartera(
    contexto.perfil,
    precioUnitarioUf,
    unidadesDeseadas,
    valorUfClp,
    contexto.opciones ?? {},
  );

  if (plan.unidadesFinanciables === 0) {
    return {
      plan,
      ajustaExpectativa: true,
      texto: [
        `${primerNombre}, con los datos que me diste todavía no puedo dimensionarte la cartera.`,
        plan.notas.join(" "),
        `Con tu renta líquida, tus deudas vigentes y el ahorro disponible te dejo el número exacto de unidades en el mismo día.`,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  const unidad = plan.unidades[0];
  const ajustaExpectativa = plan.unidadesFinanciables < unidadesDeseadas;
  const faltante = pieFaltanteUf(plan, precioUnitarioUf);
  const plural = plan.unidadesFinanciables === 1 ? "unidad" : "unidades";

  const lineas: string[] = [];

  if (contexto.topeUnaPropiedadUf) {
    lineas.push(
      `Antes que nada, ${primerNombre}: el tope de ${formatearUf(contexto.topeUnaPropiedadUf)} que te acabo de mandar es para UNA propiedad. Para varias la cuenta cambia, y no a favor: el pie por unidad sube y el dividendo de cada una cuenta como deuda para la siguiente.`,
    );
  }

  lineas.push(
    ajustaExpectativa
      ? `${primerNombre}, te lo digo de frente antes de mostrarte nada: pediste ${unidadesDeseadas} departamentos y los números dan para ${plan.unidadesFinanciables}.`
      : `${primerNombre}, las ${unidadesDeseadas} unidades salen. Te dejo los números antes de mostrarte nada.`,
  );

  if (ajustaExpectativa) {
    lineas.push(
      plan.restriccion === "pie"
        ? `Lo que frena no es la renta, es el pie. Tratándose de inversión el banco financia el ${Math.round(unidad.financiamiento * 100)}%, no el 80%, así que cada unidad pide ${formatearUf(unidad.pieUf)} de pie. Para las ${unidadesDeseadas} necesitarías ${formatearUf(faltante)} más de las que tienes.`
        : plan.restriccion === "renta"
          ? `Lo que frena es la carga financiera. El dividendo de cada unidad cuenta como deuda para la siguiente, y con tu renta la cuarta ya no pasa: el tope de dividendo es ${formatearClp(plan.dividendoMaximoClp)} al mes.`
          : `Frenan las dos cosas: el pie por unidad y la carga financiera, que sube con cada dividendo que ya tomaste.`,
    );
  }

  lineas.push(
    [
      `Por ${plan.unidadesFinanciables} ${plural} de ${formatearUf(precioUnitarioUf)}:`,
      `pie total ${formatearUf(plan.pieRequeridoUf)} de los ${formatearUf(plan.pieDisponibleUf)} que tienes,`,
      `dividendo ${formatearClp(plan.dividendoTotalClp)} al mes contra un tope de ${formatearClp(plan.dividendoMaximoClp)}.`,
    ].join(" "),
  );

  lineas.push(
    plan.flujoMensualTotalClp < 0
      ? `Y el número que casi nunca se dice: el arriendo no las paga solas. Neto entran ${formatearClp(plan.arriendoNetoTotalClp)} y el dividendo son ${formatearClp(plan.dividendoTotalClp)}, así que salen ${formatearClp(Math.abs(plan.flujoMensualTotalClp))} de tu bolsillo cada mes.`
      : `Con el arriendo neto de ${formatearClp(plan.arriendoNetoTotalClp)} las unidades cubren el dividendo y te quedan ${formatearClp(plan.flujoMensualTotalClp)} a favor.`,
  );

  lineas.push(
    `Lo que sí hay que sumar del otro lado: de ese dividendo, ${formatearClp(plan.amortizacionTotalClp)} al mes no son gasto sino capital que pasa a ser tuyo. Descontando eso, el costo real del mes es ${formatearClp(Math.abs(plan.costoRealTotalClp))}. El retorno está en la amortización y la plusvalía, no en el flujo.`,
  );

  lineas.push(
    `Rentabilidad estimada por unidad: ${formatearPorcentaje(unidad.rentabilidadBrutaAnual)} bruta, ${formatearPorcentaje(unidad.rentabilidadNetaAnual)} neta ya descontados vacancia, administración, contribuciones y mantención. Son referencias de mercado; la evaluación final la hace el banco.`,
  );

  if (plan.notas.length > 0) lineas.push(plan.notas.join(" "));

  return { plan, texto: lineas.join("\n\n"), ajustaExpectativa };
}
