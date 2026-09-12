/**
 * Manejo de objeciones y dudas del comprador.
 *
 * Un comprador de primera vivienda en Chile está tomando la decisión
 * financiera más grande de su vida y casi siempre llega con miedo. Acompañarlo
 * es parte del trabajo del corredor; empujarlo no.
 *
 * La línea que separa una cosa de la otra está escrita en el código:
 *
 *  - Se responde con hechos verificables: el dividendo que sale de su renta,
 *    el arriendo de mercado, lo que dice la promesa. Nunca con escasez o
 *    urgencia inventada ("queda solo uno", "hay otro interesado").
 *  - Cada objeción se aborda dos veces como máximo. A la tercera el agente
 *    ofrece dejar de insistir.
 *  - Si la capacidad de pago no alcanza, se dice. Meter a alguien temeroso en
 *    un dividendo que no puede pagar es un negocio que se cae en la firma, y
 *    una familia con un problema.
 *  - Nunca se promete la aprobación del crédito: la decide el banco.
 */

import {
  dividendoUf,
  formatearClp,
  formatearPorcentaje,
  formatearUf,
  PIE_MINIMO,
} from "@/lib/dominio/chile";
import type { CapacidadCompra } from "@/lib/dominio/financiamiento";
import {
  arriendoDeMercadoClp,
  CONTRIBUCIONES_ANUAL,
  economiaUnidad,
  FINANCIAMIENTO_INVERSION,
  VACANCIA_ANUAL,
} from "@/lib/dominio/inversion";

export type TipoObjecion =
  | "precio_alto"
  | "miedo_deuda"
  | "miedo_cesantia"
  | "esperar_mejor_momento"
  | "comparando"
  | "no_sabe_que_quiere"
  | "desconfianza"
  | "gastos_comunes"
  | "prefiere_pensarlo"
  | "pie_insuficiente"
  // Las que trae un inversionista: no tiene miedo, tiene calculadora.
  | "rentabilidad"
  | "se_paga_solo"
  | "vacancia"
  | "contribuciones";

export const ETIQUETA_OBJECION: Record<TipoObjecion, string> = {
  precio_alto: "Le parece caro",
  miedo_deuda: "Miedo a endeudarse",
  miedo_cesantia: "¿Y si pierdo el trabajo?",
  esperar_mejor_momento: "Prefiere esperar",
  comparando: "Está comparando",
  no_sabe_que_quiere: "No tiene claro qué busca",
  desconfianza: "Desconfía",
  gastos_comunes: "Gastos comunes altos",
  prefiere_pensarlo: "Quiere pensarlo",
  pie_insuficiente: "No le alcanza el pie",
  rentabilidad: "Pregunta por la rentabilidad",
  se_paga_solo: "Cree que se paga solo",
  vacancia: "¿Y si no lo arriendo?",
  contribuciones: "Pregunta por las contribuciones",
};

/** Señales con que aparece cada objeción en un mensaje real. */
const SENALES: Array<{ tipo: TipoObjecion; patron: RegExp }> = [
  // Las del inversionista van primero: su lenguaje es específico y no se
  // confunde con el del comprador que va a vivir ahí.
  { tipo: "se_paga_solo", patron: /\b(se pagan? sol[oa]s?|el arriendo (cubre|paga|me paga)|con el arriendo (lo |la )?(pago|cubro)|se financia sol)\b/i },
  { tipo: "vacancia", patron: /\b(si no lo arriendo|si no la arriendo|no encuentro arrendatario|queda vac[íi]o|quedan vac[íi]os|vacancia|sin arrendatario|meses vac[íi]o)\b/i },
  { tipo: "contribuciones", patron: /\b(contribuciones|impuesto territorial|aval[úu]o fiscal|sobretasa)\b/i },
  { tipo: "rentabilidad", patron: /\b(rentabilidad|cu[áa]nto renta|cu[áa]nto (me )?deja|retorno|cap rate|plusval[íi]a|rinde)\b/i },
  { tipo: "precio_alto", patron: /\b(muy caro|caro|carisimo|se me va|no me alcanza|fuera de mi presupuesto|alto el precio)\b/i },
  { tipo: "miedo_deuda", patron: /\b(miedo|me asusta|endeudar|endeudarme|amarrar|atar|25 a[ñn]os|30 a[ñn]os|toda la vida|mucho tiempo)\b/i },
  { tipo: "miedo_cesantia", patron: /\b(pierdo (la |el )?(pega|trabajo|empleo)|me despiden|quedo cesante|sin trabajo|estabilidad laboral)\b/i },
  { tipo: "esperar_mejor_momento", patron: /\b(esperar|mas adelante|el pr[óo]ximo a[ñn]o|bajen las tasas|baje el precio|no es el momento)\b/i },
  { tipo: "comparando", patron: /\b(estoy viendo otr|comparando|otra inmobiliaria|otro proyecto|otras opciones|cotizando en)\b/i },
  { tipo: "no_sabe_que_quiere", patron: /\b(no s[ée] (bien )?(qu[ée]|cu[áa]l)|no tengo claro|estoy viendo no m[áa]s|reci[ée]n empezando|explorando|orientar|ayudar a decidir)\b/i },
  { tipo: "desconfianza", patron: /\b(estafa|confiar|es serio|son serios|c[óo]mo s[ée] que|me da desconfianza|garant[íi]a de que)\b/i },
  { tipo: "gastos_comunes", patron: /\b(gastos comunes|gg\.?cc|mantenci[óo]n del edificio)\b/i },
  { tipo: "prefiere_pensarlo", patron: /\b(lo voy a pensar|dejame pensarlo|necesito pensar|converso con|consultarlo con|lo hablo con)\b/i },
  { tipo: "pie_insuficiente", patron: /\b(no tengo (el )?pie|me falta (el )?pie|ahorro poco|no alcanzo a juntar|pie muy alto|el pie es tan alto|por qu[ée] tanto pie|pie (del? )?30|sube el pie)\b/i },
];

export function detectarObjecion(texto: string): TipoObjecion | null {
  const limpio = texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const { tipo, patron } of SENALES) {
    if (patron.test(limpio)) return tipo;
  }
  return null;
}

export interface ContextoObjecion {
  primerNombre: string;
  capacidad: CapacidadCompra;
  valorUfClp: number;
  /** Precio de lo que está mirando, en UF. */
  precioUf: number | null;
  proyecto: string | null;
  comuna: string | null;
  gastosComunesClp: number | null;
  /** Cuántas veces ya se abordó esta misma objeción. */
  vecesTratada: number;
  nombreCorredora: string;
  /** Compra para arrendar: cambia el financiamiento y lo que hay que decirle. */
  paraInvertir?: boolean;
  /** Cuántas unidades trae en mente, si lo dijo. */
  unidadesDeseadas?: number;
}

export interface RespuestaObjecion {
  texto: string;
  /** Siguiente paso concreto y de bajo compromiso. */
  siguientePaso: string | null;
  /** true cuando el agente decide dejar de insistir. */
  seDetiene: boolean;
  /** true cuando corresponde que lo tome una persona. */
  escala: boolean;
}

/**
 * Arriendo de mercado estimado para una propiedad de ese precio.
 *
 * En Chile el retorno por arriendo ronda el 4,5% anual sobre el precio. Es
 * una referencia, no una tasación: se presenta como tal.
 */
export function arriendoEstimadoClp(precioUf: number, valorUfClp: number): number {
  return arriendoDeMercadoClp(precioUf, valorUfClp);
}

export function responderObjecion(
  tipo: TipoObjecion,
  contexto: ContextoObjecion,
): RespuestaObjecion {
  const { primerNombre } = contexto;

  // Al tercer intento se deja de insistir. Que alguien diga tres veces que no
  // está listo es información, no una barrera que haya que vencer.
  if (contexto.vecesTratada >= 2) {
    return {
      texto: `${primerNombre}, ya te di mi opinión y no quiero seguir insistiendo. Te dejo la ficha para cuando quieras retomarlo, y si prefieres que no te escriba más, me dices y listo.`,
      siguientePaso: null,
      seDetiene: true,
      escala: false,
    };
  }

  const respuesta = respuestaInicial(tipo, contexto);

  // La segunda vez no se repite el mismo párrafo: la duda sigue ahí, así que
  // se reconoce y se ofrece verlo con una persona en vez de insistir solo.
  if (contexto.vecesTratada === 1) {
    return {
      ...respuesta,
      texto: `Veo que esto te sigue dando vueltas, ${primerNombre}, y es razonable. Te repito lo concreto y después me dices si prefieres verlo con alguien del equipo.\n\n${respuesta.texto}`,
    };
  }

  return respuesta;
}

function respuestaInicial(
  tipo: TipoObjecion,
  contexto: ContextoObjecion,
): RespuestaObjecion {
  const { primerNombre, capacidad, precioUf, valorUfClp } = contexto;

  const dividendoMensual =
    precioUf !== null && capacidad.pieUf > 0
      ? dividendoUf(precioUf, capacidad.pieUf) * valorUfClp
      : null;
  const arriendo = precioUf !== null ? arriendoEstimadoClp(precioUf, valorUfClp) : null;

  switch (tipo) {
    case "precio_alto": {
      // Si de verdad está sobre lo que puede pagar, se le dice.
      if (capacidad.precioMaximoUf !== null && precioUf !== null && precioUf > capacidad.precioMaximoUf) {
        return {
          texto: `Tienes razón, ${primerNombre}: con tu renta y tu ahorro el banco te financiaría hasta ${formatearUf(
            capacidad.precioMaximoUf,
          )} aproximadamente, y esta unidad está en ${formatearUf(precioUf)}. No te voy a insistir con algo que te va a quedar apretado. Prefiero mostrarte opciones dentro de tu rango.`,
          siguientePaso: "¿Te busco alternativas en tu rango, en las mismas comunas?",
          seDetiene: false,
          escala: false,
        };
      }
      return {
        texto: [
          `Te entiendo, ${primerNombre}. Para ponerlo en perspectiva:`,
          dividendoMensual && arriendo
            ? `el dividendo estimado sería de ${formatearClp(dividendoMensual)} al mes, y arrendar algo parecido en el sector anda en ${formatearClp(arriendo)}. La diferencia es que el dividendo lo pagas para quedarte con la propiedad.`
            : `el precio está dentro de lo que financia tu aprobación.`,
          `Son estimaciones referenciales; el número final lo fija el banco.`,
        ].join(" "),
        siguientePaso: "¿Quieres que te haga el cálculo exacto con tu renta y tu pie?",
        seDetiene: false,
        escala: false,
      };
    }

    case "miedo_deuda":
      return {
        texto: [
          `Es una decisión grande, ${primerNombre}, y que lo pienses bien me parece lo correcto.`,
          dividendoMensual
            ? `Lo que sí te puedo aclarar: el dividendo estimado es ${formatearClp(dividendoMensual)} al mes y el crédito se puede prepagar cuando quieras, total o parcialmente, sin que te castiguen por eso.`
            : `Lo que sí te puedo aclarar: el crédito se puede prepagar cuando quieras, total o parcialmente.`,
          `El crédito va en UF, así que sube con la inflación, pero el arriendo también sube y ese no te deja nada.`,
        ].join(" "),
        siguientePaso: "¿Te sirve que te muestre cómo queda el dividendo a 20, 25 y 30 años?",
        seDetiene: false,
        escala: false,
      };

    case "miedo_cesantia":
      return {
        texto: [
          `Buena pregunta, y te la respondo derecho: sí es un riesgo real.`,
          `Lo que existe para cubrirlo es el seguro de cesantía asociado al crédito, que cubre unas cuotas mientras buscas trabajo, y la posibilidad de repactar con el banco.`,
          `Y si en el peor caso hubiera que vender, el pie que pusiste no se pierde: es capital tuyo en la propiedad.`,
          `Lo que no te voy a decir es que no hay riesgo.`,
        ].join(" "),
        siguientePaso: "¿Quieres que te averigüe el costo del seguro de cesantía con tu banco?",
        seDetiene: false,
        escala: false,
      };

    case "esperar_mejor_momento":
      return {
        texto: [
          `Puede ser, ${primerNombre}, y nadie sabe para dónde van las tasas: quien te diga lo contrario te está vendiendo humo.`,
          `Lo que sí sé es que la preaprobación no te cuesta nada ni te obliga a nada, y te deja saber exactamente cuánto te prestarían hoy.`,
          `Si decides esperar, esperas sabiendo con qué cuentas.`,
        ].join(" "),
        siguientePaso: "¿Te ayudo con la preaprobación? Son un par de documentos y es gratis.",
        seDetiene: false,
        escala: false,
      };

    case "comparando":
      return {
        texto: [
          `Me parece bien que compares, ${primerNombre}, es plata tuya.`,
          `Si quieres te armo la comparación con los números que importan: precio por m² útil, gastos comunes, año de entrega y qué incluye cada uno.`,
          `No te voy a hablar mal del otro proyecto; si te conviene más, te conviene más.`,
        ].join(" "),
        siguientePaso: "¿Me pasas cuál es el otro proyecto y te armo la comparación?",
        seDetiene: false,
        escala: false,
      };

    case "no_sabe_que_quiere":
      return {
        texto: [
          `No hay problema, ${primerNombre}, para eso estoy. Con tres cosas ya podemos acotar bastante:`,
          `¿es para vivir tú o como inversión?, ¿en qué comunas te sirve por trabajo o colegio?, y ¿cuántos dormitorios necesitas?`,
          `Con eso te mando tres opciones concretas en vez de un catálogo entero.`,
        ].join(" "),
        siguientePaso: null,
        seDetiene: false,
        escala: false,
      };

    case "desconfianza":
      return {
        texto: [
          `Tienes todo el derecho a preguntarlo, ${primerNombre}.`,
          `Somos ${contexto.nombreCorredora}. La reserva se paga directamente a la inmobiliaria, no a nosotros, y queda con comprobante a su nombre.`,
          `La compraventa se firma ante notario y se inscribe en el Conservador de Bienes Raíces: hasta que eso no ocurre, no eres dueño y el banco tampoco cursa la plata.`,
          `Si quieres, te paso los datos de la corredora para que los verifiques antes de seguir.`,
        ].join(" "),
        siguientePaso: "¿Prefieres que te llame un ejecutivo del equipo para conversarlo?",
        seDetiene: false,
        escala: true,
      };

    case "gastos_comunes":
      return {
        texto: contexto.gastosComunesClp
          ? `Los gastos comunes de este proyecto son ${formatearClp(contexto.gastosComunesClp)} al mes, ${primerNombre}. Van a conserjería, aseo, mantención de ascensores y áreas comunes. Conviene sumarlos al dividendo cuando sacas la cuenta del mes.`
          : `Te averiguo el monto exacto de los gastos comunes de este proyecto, ${primerNombre}. Conviene sumarlos al dividendo cuando sacas la cuenta del mes, no mirarlos por separado.`,
        siguientePaso: "¿Te mando el detalle de qué incluyen?",
        seDetiene: false,
        escala: false,
      };

    case "prefiere_pensarlo":
      return {
        texto: [
          `Claro que sí, ${primerNombre}. Es una decisión para pensarla con calma y no te voy a apurar.`,
          `Te dejo la ficha con todos los números para que la revises con quien necesites.`,
        ].join(" "),
        siguientePaso: "¿Te escribo en una semana para saber cómo vas, o prefieres escribirme tú?",
        seDetiene: false,
        escala: false,
      };

    case "pie_insuficiente": {
      // Para inversión el banco financia menos: el pie por unidad sube de
      // 20% a 30%, y eso es lo que suele frenar una cartera.
      const fraccionPie = contexto.paraInvertir ? 1 - FINANCIAMIENTO_INVERSION : PIE_MINIMO;
      const pieNecesario =
        precioUf !== null
          ? formatearClp(precioUf * fraccionPie * valorUfClp)
          : `el ${Math.round(fraccionPie * 100)}% del precio`;

      if (contexto.paraInvertir) {
        return {
          texto: [
            `Acá está la diferencia que más sorprende, ${primerNombre}: en primera vivienda el banco financia el 80%, pero tratándose de inversión baja al ${Math.round(FINANCIAMIENTO_INVERSION * 100)}%.`,
            `Por unidad eso significa ${Math.round(fraccionPie * 100)}% de pie en vez de 20%: ${pieNecesario} por departamento. Multiplicado por las unidades que quieres, es lo que define cuántas salen.`,
            capacidad.pieUf > 0
              ? `Con ${formatearUf(capacidad.pieUf)} de ahorro conviene decidir entre menos unidades ahora o juntar el pie de las que faltan.`
              : `Conviene fijar el pie disponible antes de elegir unidades.`,
          ].join(" "),
          siguientePaso: "¿Prefieres partir con menos unidades o esperar a juntar el pie completo?",
          seDetiene: false,
          escala: false,
        };
      }

      return {
        texto: [
          `Te cuento cómo funciona, ${primerNombre}: los bancos financian hasta el 80%, así que para esta unidad necesitarías cerca de ${pieNecesario} de pie.`,
          capacidad.pieUf > 0
            ? `Con lo que tienes hoy (${formatearUf(capacidad.pieUf)}) podrías apuntar a algo más acotado, o juntar la diferencia primero.`
            : `Hay proyectos con bono pie o pie en cuotas hasta la entrega, que es la vía más usada cuando falta esa parte.`,
          `Si postulas a subsidio, ese monto se suma al pie.`,
        ].join(" "),
        siguientePaso: "¿Te busco proyectos con facilidades de pie o con subsidio?",
        seDetiene: false,
        escala: false,
      };
    }

    // ------------------------------------------------- el inversionista

    case "rentabilidad": {
      if (precioUf === null) {
        return {
          texto: `Para darte la rentabilidad necesito el precio de la unidad concreta, ${primerNombre}. Dime cuál miras y te mando el cálculo completo: bruta, neta y flujo mensual.`,
          siguientePaso: "¿Qué tipología estás mirando?",
          seDetiene: false,
          escala: false,
        };
      }
      const unidad = economiaUnidad(precioUf, valorUfClp, contexto.paraInvertir ? 2 : 1, {
        gastosComunesClp: contexto.gastosComunesClp ?? undefined,
      });
      return {
        texto: [
          `Te doy los dos números, ${primerNombre}, porque el que se publica es solo el primero.`,
          `Bruta: ${formatearPorcentaje(unidad.rentabilidadBrutaAnual)} anual — el arriendo de mercado, ${formatearClp(unidad.arriendoBrutoClp)} al mes, sobre el precio.`,
          `Neta: ${formatearPorcentaje(unidad.rentabilidadNetaAnual)} anual — la misma cuenta descontando un mes de vacancia al año, la administración del arriendo, las contribuciones y la mantención. Quedan ${formatearClp(unidad.arriendoNetoClp)} al mes.`,
          `Esa diferencia entre ${formatearPorcentaje(unidad.rentabilidadBrutaAnual)} y ${formatearPorcentaje(unidad.rentabilidadNetaAnual)} es la que casi nunca aparece en el aviso. Son estimaciones de mercado, no una tasación.`,
        ].join("\n\n"),
        siguientePaso: "¿Te armo el flujo a 10 años con amortización y plusvalía?",
        seDetiene: false,
        escala: false,
      };
    }

    case "se_paga_solo": {
      if (precioUf === null) {
        return {
          texto: `Depende del precio y de cuánto pie pongas, ${primerNombre}, así que no te voy a decir que sí de entrada. Dime qué unidad miras y te muestro el flujo real.`,
          siguientePaso: "¿Cuál estás mirando?",
          seDetiene: false,
          escala: false,
        };
      }
      const unidad = economiaUnidad(precioUf, valorUfClp, contexto.paraInvertir ? 2 : 1, {
        gastosComunesClp: contexto.gastosComunesClp ?? undefined,
      });
      const cubre = unidad.flujoMensualClp >= 0;
      return {
        texto: [
          cubre
            ? `En este caso sí alcanza, ${primerNombre}, pero te muestro la cuenta igual para que la veas completa:`
            : `No, ${primerNombre}. Te lo digo derecho porque es lo que más se promete en este rubro y casi nunca es verdad:`,
          `Dividendo ${formatearClp(unidad.dividendoClp)} al mes contra un arriendo neto de ${formatearClp(unidad.arriendoNetoClp)}. ${
            cubre
              ? `Te quedan ${formatearClp(unidad.flujoMensualClp)} a favor.`
              : `Te cuesta ${formatearClp(Math.abs(unidad.flujoMensualClp))} de tu bolsillo cada mes.`
          }`,
          `Ahora, lo que también hay que decir: de ese dividendo, ${formatearClp(unidad.amortizacionClp)} no son gasto, son capital que pasa a ser tuyo; el resto, ${formatearClp(unidad.interesClp)}, es el interés que se lleva el banco. Mirado así, el costo real del mes es ${formatearClp(Math.abs(unidad.costoRealMensualClp))} y el resto es ahorro forzado.`,
          `El negocio está en la amortización y en la plusvalía, no en el flujo. Si necesitas que el flujo sea positivo desde el mes uno, hay que poner más pie o buscar otro precio.`,
        ].join("\n\n"),
        siguientePaso: "¿Te calculo cuánto pie haría falta para que el flujo quede en cero?",
        seDetiene: false,
        escala: false,
      };
    }

    case "vacancia": {
      const arriendo = precioUf !== null ? arriendoDeMercadoClp(precioUf, valorUfClp) : null;
      const mesesBase = Math.round(VACANCIA_ANUAL * 12);
      // La caída se calcula y se dice de cuánto a cuánto: "baja 0,7%" se
      // presta para leerlo como una baja relativa, que no es lo que pasa.
      const neta = precioUf !== null ? economiaUnidad(precioUf, valorUfClp, 2).rentabilidadNetaAnual : null;
      const netaConVacancia =
        precioUf !== null
          ? economiaUnidad(precioUf, valorUfClp, 2, { vacanciaAnual: 3 / 12 }).rentabilidadNetaAnual
          : null;
      return {
        texto: [
          `Es el riesgo principal del negocio, ${primerNombre}, y ya está metido en los números que te di: el cálculo asume ${mesesBase} mes vacío al año.`,
          arriendo
            ? `Cada mes sin arrendar te cuesta ${formatearClp(arriendo)} de arriendo que no entra, más los gastos comunes que en ese mes los paga el dueño.`
            : `Cada mes sin arrendar es arriendo que no entra y gastos comunes que paga el dueño.`,
          `Lo que reduce la vacancia es concreto: ubicación cerca de metro, tipologías chicas que es lo que más se mueve, y precio de arriendo a mercado en vez de un 10% arriba esperando suerte.`,
          neta !== null && netaConVacancia !== null
            ? `Si te quedara vacío tres meses en vez de uno, la rentabilidad neta pasa de ${formatearPorcentaje(neta)} a ${formatearPorcentaje(netaConVacancia)}. No es una catástrofe, pero hay que poder aguantar el dividendo esos meses.`
            : `Lo que hay que poder aguantar es el dividendo en los meses sin arrendatario.`,,
        ].join(" "),
        siguientePaso: "¿Te muestro la vacancia real del sector en los últimos arriendos que gestionamos?",
        seDetiene: false,
        escala: false,
      };
    }

    case "contribuciones": {
      const anual = precioUf !== null ? precioUf * valorUfClp * CONTRIBUCIONES_ANUAL : null;
      return {
        texto: [
          `Las paga el dueño, ${primerNombre}, no el arrendatario: es un costo tuyo todo el año, se arriende o no.`,
          anual
            ? `Para una unidad de este precio andan por ${formatearClp(anual / 12)} al mes aproximado, en cuatro cuotas al año. Ya están descontadas en la rentabilidad neta que te pasé.`
            : `Se pagan en cuatro cuotas al año y están descontadas en la rentabilidad neta que te pasé.`,
          `Se calculan sobre el avalúo fiscal, que va bastante por debajo del precio comercial, así que el monto exacto sale del rol una vez asignado: bajo el avalúo exento no se paga nada, y si la unidad califica como DFL2 paga menos.`,
        ].join(" "),
        siguientePaso: "¿Te averiguo el avalúo y la contribución exacta de la unidad?",
        seDetiene: false,
        escala: false,
      };
    }
  }
}

/** Preguntas de descubrimiento, para cuando no sabe qué busca. */
export const PREGUNTAS_DESCUBRIMIENTO = [
  "¿Es para vivir tú o como inversión?",
  "¿En qué comunas te sirve, por trabajo o colegio?",
  "¿Cuántos dormitorios necesitas?",
  "¿Para cuándo te gustaría estar instalado?",
] as const;

/**
 * Lo que el agente tiene prohibido hacer al manejar una objeción. Está acá
 * escrito para que se pueda revisar, y va también en el prompt del modelo.
 */
export const LIMITES_DE_PERSUASION = [
  "No inventar escasez ni urgencia: nada de 'queda solo uno' o 'hay otro interesado' si no es verdad y verificable.",
  "No prometer la aprobación del crédito: la decide el banco.",
  "No insistir más de dos veces con la misma objeción.",
  "Si la capacidad de pago no alcanza, decirlo y ofrecer opciones en su rango.",
  "No minimizar los riesgos: si preguntan qué pasa si pierden el trabajo, la respuesta parte por reconocer que el riesgo existe.",
  "No hablar mal de la competencia.",
  "Si pide espacio o dice que lo va a pensar, dárselo.",
  "Nunca decir que una propiedad 'se paga sola' sin mostrar el flujo: dividendo contra arriendo neto, con la vacancia y los costos del dueño descontados.",
  "Publicar la rentabilidad neta junto a la bruta, no la bruta sola.",
  "Un descuento por volumen lo aprueba la inmobiliaria, no el agente: se deriva, no se promete.",
] as const;
