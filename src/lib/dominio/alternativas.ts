/**
 * Cuando no le alcanza, qué se hace.
 *
 * Decirle a alguien "con tu renta no llegas" y quedarse ahí no es honestidad,
 * es pereza. En Chile hay vías concretas y legales para cerrar esa brecha, y
 * un corredor que se gana su comisión las conoce todas:
 *
 *   - **Multicrédito** (dos titulares): la vía más usada. Las rentas se suman
 *     y la capacidad sube casi al doble. El costo es real: ambos quedan
 *     obligados por el total y el segundo titular queda con ese cupo tomado.
 *   - **Plazo a 30 años**: baja el dividendo y sube el techo. Se paga con
 *     muchos más intereses a lo largo del crédito, y eso hay que mostrarlo.
 *   - **Bono pie**: la inmobiliaria aporta una parte del pie. Es un descuento
 *     con otro nombre y lo aprueba ella, no el corredor.
 *   - **Pie en cuotas**: en proyectos en verde el pie se paga en mensualidades
 *     hasta la entrega. No baja el monto, reparte el esfuerzo.
 *   - **Pie cero**: la inmobiliaria difiere el pie completo. Sube el crédito y
 *     por lo tanto el dividendo.
 *   - **Subsidio habitacional**: se suma al pie y no se devuelve.
 *   - **Leasing habitacional**: sin pie, pero la propiedad no queda a su
 *     nombre hasta el final del contrato.
 *
 * Cada alternativa viene con su contra escrita. Una alternativa presentada
 * sin su costo es una trampa, y en esto las trampas se pagan veinte años.
 */

import { PIE_MINIMO, TOPE_SUBSIDIO_UF } from "@/lib/dominio/chile";
import {
  capacidadCompra,
  PLAZO_ANOS,
  TASA_ANUAL_REFERENCIA,
  type CapacidadCompra,
} from "@/lib/dominio/financiamiento";
import type { PerfilFinanciero, Proyecto } from "@/lib/dominio/tipos";

export type TipoAlternativa =
  | "segundo_titular"
  | "plazo_30"
  | "bono_pie"
  | "pie_en_cuotas"
  | "pie_cero"
  | "subsidio"
  | "leasing";

export const ETIQUETA_ALTERNATIVA: Record<TipoAlternativa, string> = {
  segundo_titular: "Multicrédito con segundo titular",
  plazo_30: "Crédito a 30 años",
  bono_pie: "Bono pie de la inmobiliaria",
  pie_en_cuotas: "Pie en cuotas hasta la entrega",
  pie_cero: "Pie cero",
  subsidio: "Subsidio habitacional",
  leasing: "Leasing habitacional",
};

/** Subsidio típico de clase media (DS19). El monto exacto lo fija el llamado. */
export const SUBSIDIO_REFERENCIA_UF = 300;
const PLAZO_LARGO_ANOS = 30;

export interface Alternativa {
  tipo: TipoAlternativa;
  titulo: string;
  /** Cómo funciona, en una frase que se pueda decir por WhatsApp. */
  comoFunciona: string;
  /** Lo que el comprador tiene que tener o hacer para acceder. */
  requisito: string;
  /** Lo que le cuesta. Nunca es null: si no tuviera costo, sería el caso base. */
  advertencia: string;
  /** Techo de compra con esta alternativa, en UF. */
  precioMaximoUf: number | null;
  /** Cuánto sube el techo respecto del caso base. */
  gananciaUf: number;
  /** Efectivo que necesita tener hoy, si la alternativa lo cambia. */
  efectivoHoyClp: number | null;
  /** Proyectos del inventario donde esta vía está disponible. */
  proyectos: string[];
}

function cuota(capitalUf: number, tasaAnual: number, anos: number): number {
  if (capitalUf <= 0) return 0;
  const tasaMensual = tasaAnual / 12;
  const cuotas = anos * 12;
  const factor = Math.pow(1 + tasaMensual, cuotas);
  return (capitalUf * tasaMensual * factor) / (factor - 1);
}

function capitalDesdeDividendo(dividendoUf: number, anos: number): number {
  const tasaMensual = TASA_ANUAL_REFERENCIA / 12;
  const cuotas = anos * 12;
  const factor = Math.pow(1 + tasaMensual, cuotas);
  return (dividendoUf * (factor - 1)) / (tasaMensual * factor);
}

/** Meses hasta la entrega, para repartir el pie. Null si ya está entregado. */
export function mesesHastaEntrega(proyecto: Proyecto, ahora: Date): number | null {
  if (!proyecto.anoEntrega) return null;
  const meses: Record<string, number> = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  };
  const mes = meses[(proyecto.entrega ?? "").toLowerCase().trim()] ?? 11;
  const entrega = new Date(proyecto.anoEntrega, mes, 1);
  const diferencia =
    (entrega.getFullYear() - ahora.getFullYear()) * 12 + (entrega.getMonth() - ahora.getMonth());
  return diferencia > 0 ? diferencia : null;
}

/** Proyectos del inventario que traen un atributo de financiamiento. */
function conAtributo(proyectos: Proyecto[], patron: RegExp): Proyecto[] {
  return proyectos.filter((proyecto) =>
    [...proyecto.tags, ...proyecto.beneficios].some((etiqueta) => patron.test(etiqueta)),
  );
}

export interface ContextoAlternativas {
  perfil: PerfilFinanciero;
  capacidadBase: CapacidadCompra;
  valorUfClp: number;
  /** Lo que necesita alcanzar. Sin esto no se sabe cuánta brecha hay que cerrar. */
  precioObjetivoUf: number | null;
  proyectos: Proyecto[];
  ahora: Date;
  /** Renta líquida del segundo titular, si ya se sabe. */
  rentaSegundoTitularClp?: number | null;
}

/**
 * Las vías para cerrar la brecha, de la que más suma a la que menos.
 *
 * Solo devuelve las que de verdad aplican: si no hay proyectos con bono pie
 * en el inventario, no se ofrece bono pie. Prometer una vía que no existe es
 * la forma más rápida de quemar un lead.
 */
export function alternativasDeFinanciamiento(contexto: ContextoAlternativas): Alternativa[] {
  const { perfil, capacidadBase, valorUfClp, proyectos } = contexto;
  const base = capacidadBase.precioMaximoUf ?? 0;
  const alternativas: Alternativa[] = [];

  const pieUf = capacidadBase.pieUf;
  const dividendoMaximoUf = capacidadBase.dividendoMaximoClp / valorUfClp;

  // ------------------------------------------------- multicrédito (2 titulares)
  const rentaSegundo =
    contexto.rentaSegundoTitularClp ?? (perfil.tienePareja ? perfil.rentaParejaClp : null);
  if (perfil.rentaClp && perfil.tieneDicom !== true) {
    // Si todavía no hay un segundo titular concreto, se ilustra con una renta
    // igual a la suya: es el escenario que la gente entiende sin explicación.
    const renta = rentaSegundo ?? perfil.rentaClp;
    const conDos = capacidadCompra(
      { ...perfil, tienePareja: true, rentaParejaClp: renta },
      valorUfClp,
    );
    if ((conDos.precioMaximoUf ?? 0) > base) {
      alternativas.push({
        tipo: "segundo_titular",
        titulo: ETIQUETA_ALTERNATIVA.segundo_titular,
        comoFunciona:
          "El crédito se pide entre dos personas y el banco suma ambas rentas líquidas para calcular la carga.",
        requisito: rentaSegundo
          ? "Que el segundo titular tenga renta acreditable y sin Dicom."
          : "Una segunda persona con renta acreditable y sin Dicom: pareja, hermano, padre o madre.",
        advertencia:
          "Los dos quedan obligados por el total de la deuda, no por mitades, y al segundo titular le ocupa su cupo de crédito para lo que quiera hacer después.",
        precioMaximoUf: conDos.precioMaximoUf,
        gananciaUf: Math.round((conDos.precioMaximoUf ?? 0) - base),
        efectivoHoyClp: null,
        proyectos: [],
      });
    }
  }

  // ------------------------------------------------------------- plazo 30 años
  if (dividendoMaximoUf > 0 && capacidadBase.restriccion === "renta") {
    const creditoLargo = capitalDesdeDividendo(dividendoMaximoUf, PLAZO_LARGO_ANOS);
    const techoLargo = Math.round(creditoLargo + pieUf);
    if (techoLargo > base) {
      const creditoBase = capitalDesdeDividendo(dividendoMaximoUf, PLAZO_ANOS);
      const interesExtra = Math.round(
        cuota(creditoLargo, TASA_ANUAL_REFERENCIA, PLAZO_LARGO_ANOS) * PLAZO_LARGO_ANOS * 12 -
          creditoLargo -
          (cuota(creditoBase, TASA_ANUAL_REFERENCIA, PLAZO_ANOS) * PLAZO_ANOS * 12 - creditoBase),
      );
      alternativas.push({
        tipo: "plazo_30",
        titulo: ETIQUETA_ALTERNATIVA.plazo_30,
        comoFunciona: `Con el mismo dividendo máximo, estirar el crédito de ${PLAZO_ANOS} a ${PLAZO_LARGO_ANOS} años financia más capital.`,
        requisito: "Edad compatible: el crédito tiene que terminar antes de los 75 años.",
        advertencia: `Termina pagando del orden de UF ${interesExtra.toLocaleString("es-CL")} más en intereses a lo largo del crédito. Se puede prepagar para acortarlo.`,
        precioMaximoUf: techoLargo,
        gananciaUf: techoLargo - base,
        efectivoHoyClp: null,
        proyectos: [],
      });
    }
  }

  // ----------------------------------------------------------------- bono pie
  const conBonoPie = conAtributo(proyectos, /bono pie/i);
  if (conBonoPie.length > 0 && contexto.precioObjetivoUf) {
    // El bono se expresa como porcentaje cuando la etiqueta lo dice
    // ("Bono pie 10"); si no, se trata como por confirmar.
    const etiqueta = conBonoPie
      .flatMap((proyecto) => [...proyecto.tags, ...proyecto.beneficios])
      .find((item) => /bono pie\s*\d+/i.test(item));
    const porcentaje = etiqueta ? Number(etiqueta.match(/\d+/)![0]) / 100 : null;
    const aporteUf = porcentaje ? contexto.precioObjetivoUf * porcentaje : null;

    alternativas.push({
      tipo: "bono_pie",
      titulo: ETIQUETA_ALTERNATIVA.bono_pie,
      comoFunciona: aporteUf
        ? `La inmobiliaria aporta ${Math.round(porcentaje! * 100)}% del precio al pie, del orden de UF ${Math.round(aporteUf).toLocaleString("es-CL")} en una unidad de este valor.`
        : "La inmobiliaria aporta una parte del pie; el monto lo fija ella por proyecto.",
      requisito: "Solo en los proyectos que lo ofrecen y mientras dure el beneficio.",
      advertencia:
        "Lo aprueba la inmobiliaria, no el corredor, y suele venir con condiciones (plazo de reserva, forma de pago). No lo des por hecho hasta tenerlo por escrito.",
      precioMaximoUf: aporteUf ? Math.round(base + aporteUf / PIE_MINIMO) : null,
      gananciaUf: aporteUf ? Math.round(aporteUf / PIE_MINIMO) : 0,
      efectivoHoyClp: null,
      proyectos: conBonoPie.map((proyecto) => `${proyecto.nombre}, ${proyecto.comuna}`),
    });
  }

  // ------------------------------------------------------------ pie en cuotas
  const enVerde = proyectos
    .map((proyecto) => ({ proyecto, meses: mesesHastaEntrega(proyecto, contexto.ahora) }))
    .filter((item): item is { proyecto: Proyecto; meses: number } => item.meses !== null && item.meses >= 6);

  if (enVerde.length > 0 && contexto.precioObjetivoUf) {
    const mejor = enVerde.reduce((mayor, actual) => (actual.meses > mayor.meses ? actual : mayor));
    const pieTotalClp = contexto.precioObjetivoUf * PIE_MINIMO * valorUfClp;
    const cuotaMensual = Math.round(pieTotalClp / mejor.meses);
    alternativas.push({
      tipo: "pie_en_cuotas",
      titulo: ETIQUETA_ALTERNATIVA.pie_en_cuotas,
      comoFunciona: `En proyectos en verde el pie se paga en mensualidades hasta la entrega. En ${mejor.proyecto.nombre} quedan ${mejor.meses} meses, o sea del orden de $${cuotaMensual.toLocaleString("es-CL")} al mes.`,
      requisito: "Capacidad de ahorro mensual sostenida hasta la entrega, además del arriendo que esté pagando hoy.",
      advertencia:
        "No reduce el pie, lo reparte. Y si deja de pagar las cuotas, pierde la unidad y parte de lo abonado según lo que diga la promesa.",
      precioMaximoUf: null,
      gananciaUf: 0,
      efectivoHoyClp: Math.round(pieTotalClp / mejor.meses),
      proyectos: enVerde.map((item) => `${item.proyecto.nombre} (${item.meses} meses)`),
    });
  }

  // ---------------------------------------------------------------- pie cero
  const conPieCero = conAtributo(proyectos, /pie cero|pie 0/i);
  if (conPieCero.length > 0) {
    // Sin pie, el techo lo pone solo la renta: el banco financia y el resto
    // lo difiere la inmobiliaria.
    const soloRenta = Math.round(capitalDesdeDividendo(dividendoMaximoUf, PLAZO_ANOS));
    alternativas.push({
      tipo: "pie_cero",
      titulo: ETIQUETA_ALTERNATIVA.pie_cero,
      comoFunciona:
        "La inmobiliaria difiere el pie completo hasta la escritura, así que se entra sin desembolso inicial.",
      requisito: "Renta que soporte el dividendo sobre el 100% del precio y aprobación del proyecto.",
      advertencia:
        "El dividendo sube porque se financia más capital, y el pie diferido igual hay que pagarlo. Conviene compararlo con juntar pie un año más.",
      precioMaximoUf: soloRenta > 0 ? soloRenta : null,
      gananciaUf: Math.max(soloRenta - base, 0),
      efectivoHoyClp: 0,
      proyectos: conPieCero.map((proyecto) => `${proyecto.nombre}, ${proyecto.comuna}`),
    });
  }

  // ---------------------------------------------------------------- subsidio
  const conSubsidio = conAtributo(proyectos, /subsidio|ds ?19|ds ?1\b/i);
  // El subsidio suma al pie, pero la propiedad no puede pasar del tope legal:
  // sumar UF 300 al pie no sirve de nada si eso lo saca del programa. Si con
  // el tope no gana nada, no se ofrece.
  const techoConSubsidio = Math.min(base + SUBSIDIO_REFERENCIA_UF / PIE_MINIMO, TOPE_SUBSIDIO_UF);
  if (conSubsidio.length > 0 && base > 0 && techoConSubsidio > base) {
    alternativas.push({
      tipo: "subsidio",
      titulo: ETIQUETA_ALTERNATIVA.subsidio,
      comoFunciona: `El subsidio se suma al pie y no se devuelve. Un DS19 de clase media anda por UF ${SUBSIDIO_REFERENCIA_UF}; el monto exacto lo fija el llamado.`,
      requisito: `Ahorro mínimo en la libreta, no ser propietario, y que la propiedad esté bajo el tope de UF ${TOPE_SUBSIDIO_UF.toLocaleString("es-CL")}.`,
      advertencia:
        "Hay que postular en el llamado correspondiente y los resultados salen en fecha fija: no sirve para comprar este mes.",
      precioMaximoUf: Math.round(techoConSubsidio),
      gananciaUf: Math.round(techoConSubsidio - base),
      efectivoHoyClp: null,
      proyectos: conSubsidio.map((proyecto) => `${proyecto.nombre}, ${proyecto.comuna}`),
    });
  }

  // ----------------------------------------------------------------- leasing
  if (pieUf < (contexto.precioObjetivoUf ?? 0) * PIE_MINIMO * 0.5) {
    alternativas.push({
      tipo: "leasing",
      titulo: ETIQUETA_ALTERNATIVA.leasing,
      comoFunciona:
        "Una sociedad inmobiliaria compra la propiedad y el comprador paga un arriendo con promesa de compraventa; parte de cada cuota se abona al precio.",
      requisito: "Ingresos acreditables. No exige pie ni evaluación hipotecaria tradicional.",
      advertencia:
        "La propiedad no queda a su nombre hasta terminar el contrato, y el costo financiero total es mayor que un crédito hipotecario. Es la última opción, no la primera.",
      precioMaximoUf: null,
      gananciaUf: 0,
      efectivoHoyClp: 0,
      proyectos: [],
    });
  }

  return alternativas.sort((uno, otro) => otro.gananciaUf - uno.gananciaUf);
}

/** La alternativa que más cierra la brecha hasta el precio objetivo. */
export function mejorAlternativa(
  alternativas: Alternativa[],
  precioObjetivoUf: number,
): Alternativa | null {
  const alcanzan = alternativas.filter(
    (alternativa) => (alternativa.precioMaximoUf ?? 0) >= precioObjetivoUf,
  );
  return alcanzan[alcanzan.length - 1] ?? alternativas[0] ?? null;
}
