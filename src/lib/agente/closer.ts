/**
 * El turno conversacional del closer: ficha de hechos, llamada al modelo y
 * verificación de lo que escribió.
 *
 * El orden importa y es el que evita el problema clásico de un agente
 * comercial con modelo: que suene excelente y diga cosas falsas.
 *
 *   1. el código arma la FICHA DE HECHOS con cifras calculadas
 *   2. el modelo redacta usando solo esa ficha
 *   3. el código revisa la salida cifra por cifra
 *
 * El paso 3 no es decorativo. Sin él, un prompt que pide "vende con ROI y
 * cap rate" produce un 5,5% de rentabilidad y una "vacancia casi cero" que
 * nadie calculó, y eso en Chile es publicidad engañosa, no una venta.
 */

import "server-only";

import {
  EXIGENCIAS_DE_RESPUESTA,
  SISTEMA_CLOSER,
  type PerfilProspecto,
} from "@/lib/agente/persona";
import {
  CONTRATO_DE_HECHOS,
  SISTEMA_CLOSER_V2,
  SISTEMA_CLOSER_V25,
} from "@/lib/agente/persona-v2";
import { afirmacionesProhibidasEn } from "@/lib/dominio/afirmaciones";
import type { PeticionModelo, ProveedorModelo, RespuestaModelo } from "@/lib/agente/modelo";
import {
  formatearClp,
  formatearFecha,
  formatearPorcentaje,
  formatearUf,
  PIE_MINIMO,
} from "@/lib/dominio/chile";
import type { CapacidadCompra } from "@/lib/dominio/financiamiento";
import {
  economiaUnidad,
  planificarCartera,
  FINANCIAMIENTO_INVERSION,
  type EconomiaUnidad,
  type PlanCartera,
} from "@/lib/dominio/inversion";
import { PLAZO_ANOS, TASA_ANUAL_REFERENCIA } from "@/lib/dominio/financiamiento";
import type { Alternativa, TipoAlternativa } from "@/lib/dominio/alternativas";
import { efectoEnCapacidad, resumenParaFicha, type Incentivo } from "@/lib/dominio/incentivos";
import type { Lead, PerfilFinanciero, Proyecto } from "@/lib/dominio/tipos";
import { superficieUtil } from "@/lib/jetbrokers/mapeo";

export interface UnidadOfrecible {
  proyecto: Proyecto;
  modelo: Proyecto["modelos"][number] | null;
  precioUf: number;
  /**
   * Vía que hay que usar para que esta unidad entre.
   *
   * null significa que entra con la capacidad que ya tiene. Cualquier otra
   * cosa hay que decirla junto a la unidad: ofrecer algo que solo alcanza
   * con multicrédito sin mencionarlo es venderle una expectativa.
   */
  requiereAlternativa?: TipoAlternativa | null;
}

export interface DatosFicha {
  lead: Lead;
  perfil: PerfilProspecto;
  perfilFinanciero: PerfilFinanciero;
  capacidad: CapacidadCompra;
  valorUfClp: number;
  unidades: UnidadOfrecible[];
  bloques: Array<{ inicio: Date; fin: Date }>;
  /** Cuántas unidades pidió, si lo dijo. Activa el plan de cartera. */
  unidadesDeseadas?: number | null;
  gastosComunesClp?: number | null;
  /** Vías para cerrar la brecha cuando la capacidad base no alcanza. */
  alternativas?: Alternativa[];
  /** Beneficios vigentes del registro. Ya filtrados: acá no llega lo vencido. */
  incentivos?: Incentivo[];
  /**
   * Con "ninguna", la ficha lleva solo datos.
   *
   * El recordatorio de lo que se va a revisar es una instrucción del sistema,
   * y correr un prompt "tal cual" significa no colarle instrucciones por la
   * puerta de los datos.
   */
  intervencion?: "correccion" | "ninguna";
  ahora: Date;
}

export interface FichaDeHechos {
  texto: string;
  /** Toda cifra que el modelo tiene permitido usar. */
  cifras: Set<number>;
  economia: EconomiaUnidad | null;
  plan: PlanCartera | null;
  alternativas: Alternativa[];
}

// --------------------------------------------------------------- las cifras

/**
 * Pasa "UF 2.687", "$469.319" o "4,47%" a número.
 *
 * En Chile el punto separa miles y la coma decimales, al revés que en el
 * formato que entiende `Number`.
 */
export function aNumero(texto: string): number | null {
  const limpio = texto.replace(/[^\d.,]/g, "");
  if (!limpio) return null;
  const normalizado = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(limpio)
    ? limpio.replace(/\./g, "").replace(",", ".")
    : limpio.replace(",", ".");
  const valor = Number(normalizado);
  return Number.isFinite(valor) ? valor : null;
}

/** Todas las cifras que aparecen en un texto. */
export function cifrasDe(texto: string): number[] {
  const encontradas: number[] = [];
  for (const bruto of texto.match(/\d[\d.,]*/g) ?? []) {
    const valor = aNumero(bruto);
    if (valor !== null) encontradas.push(valor);
  }
  return encontradas;
}

/**
 * Las cifras de una respuesta que hay que verificar.
 *
 * Se revisan los montos (100 o más) y todos los porcentajes. Los números
 * chicos sueltos quedan fuera: son cantidades de unidades, días y horas, y
 * exigirlos llenaría el informe de falsos positivos.
 */
export function cifrasAVerificar(texto: string): number[] {
  const porcentajes = (texto.match(/\d[\d.,]*\s?%/g) ?? [])
    .map((bruto) => aNumero(bruto))
    .filter((valor): valor is number => valor !== null);

  // Las fechas con hora ("14:30", "10:00 a. m.") no son montos.
  const sinHoras = texto.replace(/\b\d{1,2}:\d{2}\b/g, " ");
  const montos = cifrasDe(sinHoras).filter((valor) => valor >= 100);

  return [...new Set([...porcentajes, ...montos])];
}

/**
 * Si una cifra del mensaje corresponde a una de la ficha.
 *
 * La tolerancia existe para un caso concreto: el modelo escribe "UF 2.687"
 * donde la ficha dice 2686,56. Pero aplicada a números chicos se come el
 * problema que debía atrapar — con redondeo a la unidad, un "5,5%" inventado
 * calzaba con el 6 de las "6:00 p. m." de la agenda. Por eso el redondeo
 * solo vale para montos, y lo chico tiene que calzar casi exacto.
 */
function coincide(valor: number, permitidas: Set<number>): boolean {
  if (permitidas.has(valor)) return true;
  for (const permitida of permitidas) {
    if (Math.abs(permitida - valor) <= 0.01) return true;
    if (valor >= 100 && permitida >= 100 && Math.round(permitida) === Math.round(valor)) {
      return true;
    }
  }
  return false;
}

// ----------------------------------------------------------------- la ficha

export function fichaDeHechos(datos: DatosFicha): FichaDeHechos {
  const { lead, capacidad, valorUfClp, unidades } = datos;
  const bloques: string[] = [];

  const paraInvertir = datos.perfil === "B" || datos.perfilFinanciero.paraInvertir === true;
  const principal = unidades[0] ?? null;

  bloques.push(
    [
      `FECHA: ${formatearFecha(datos.ahora.toISOString())}`,
      `VALOR UF HOY: ${formatearClp(valorUfClp)}`,
      `TASA HIPOTECARIA DE REFERENCIA: ${formatearPorcentaje(TASA_ANUAL_REFERENCIA * 100, 1)} anual a ${PLAZO_ANOS} años`,
    ].join("\n"),
  );

  bloques.push(
    [
      `PROSPECTO`,
      `Nombre: ${lead.nombre}`,
      `Canal: ${lead.canal}`,
      `Perfil detectado: ${datos.perfil === "indeterminado" ? "todavía sin perfilar — corresponde lanzar la pregunta de radar" : datos.perfil}`,
      lead.comunasInteres.length > 0 ? `Comunas que mencionó: ${lead.comunasInteres.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const perfil = datos.perfilFinanciero;
  bloques.push(
    [
      `LO QUE DECLARÓ`,
      perfil.rentaClp ? `Renta líquida: ${formatearClp(perfil.rentaClp)}` : "Renta líquida: no la ha dicho",
      perfil.rentaVariableClp ? `Renta variable: ${formatearClp(perfil.rentaVariableClp)} (la banca la pondera al 50%)` : null,
      perfil.ahorroClp !== null ? `Ahorro para el pie: ${formatearClp(perfil.ahorroClp)}` : "Ahorro para el pie: no lo ha dicho",
      perfil.dividendosMensualesClp ? `Dividendos vigentes: ${formatearClp(perfil.dividendosMensualesClp)}` : null,
      perfil.cuotasConsumoMensualesClp ? `Cuotas de consumo: ${formatearClp(perfil.cuotasConsumoMensualesClp)}` : null,
      perfil.tieneDicom === true ? `Dicom: sí, vigente` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  bloques.push(
    [
      `CAPACIDAD DE COMPRA (calculada con criterios de la banca chilena)`,
      capacidad.precioMaximoUf !== null
        ? `Precio máximo para UNA propiedad: ${formatearUf(capacidad.precioMaximoUf)}`
        : `Precio máximo: no estimable todavía`,
      `Dividendo máximo mensual: ${formatearClp(capacidad.dividendoMaximoClp)}`,
      `Pie disponible: ${formatearUf(capacidad.pieUf)}`,
      `Qué lo limita: ${capacidad.restriccion}`,
      `Pie mínimo primera vivienda: ${formatearPorcentaje(PIE_MINIMO * 100, 0)} · para inversión: ${formatearPorcentaje((1 - FINANCIAMIENTO_INVERSION) * 100, 0)}`,
      ...capacidad.notas.map((nota) => `- ${nota}`),
    ].join("\n"),
  );

  bloques.push(
    [
      `UNIDADES DISPONIBLES (las únicas que existen; no hay otras)`,
      ...(unidades.length === 0
        ? ["Ninguna calza con lo que pidió."]
        : unidades.map((item, indice) => {
            const metros = item.modelo ? superficieUtil(item.modelo) : null;
            return [
              `${indice + 1}. ${item.proyecto.nombre}, ${item.proyecto.comuna}`,
              item.modelo ? `tipología ${item.modelo.name} ${item.modelo.rooms}D${item.modelo.bathrooms}B` : null,
              metros ? `${metros} m² útiles` : null,
              `${formatearUf(item.precioUf)}`,
              item.proyecto.reservaClp ? `reserva ${formatearClp(item.proyecto.reservaClp)}` : null,
              item.proyecto.entrega ? `entrega ${item.proyecto.entrega}${item.proyecto.anoEntrega ? ` ${item.proyecto.anoEntrega}` : ""}` : null,
              item.proyecto.direccion ? `dirección ${item.proyecto.direccion}` : null,
              item.proyecto.tags.length > 0 ? `atributos: ${item.proyecto.tags.join(", ")}` : null,
              item.requiereAlternativa
                ? `OJO: esta unidad está sobre su capacidad actual, solo entra con ${item.requiereAlternativa}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ");
          })),
    ].join("\n"),
  );

  let economia: EconomiaUnidad | null = null;
  let plan: PlanCartera | null = null;

  // Quien no tiene ninguna propiedad todavía recibe el 80% en la primera
  // aunque la compre para arrendar: el banco mira si es su primera vivienda,
  // no la intención. La economía de la unidad y el plan de cartera tienen que
  // partir del mismo supuesto o la ficha se contradice sola.
  const yaTienePropiedad = (perfil.creditosHipotecarios ?? 0) > 0;
  const ordenPrimera = yaTienePropiedad ? 2 : 1;

  if (paraInvertir && principal) {
    economia = economiaUnidad(principal.precioUf, valorUfClp, ordenPrimera, {
      gastosComunesClp: datos.gastosComunesClp ?? undefined,
    });
    bloques.push(
      [
        `ECONOMÍA DEL ARRIENDO, POR UNIDAD (${formatearUf(principal.precioUf)})`,
        `Arriendo de mercado estimado: ${formatearClp(economia.arriendoBrutoClp)} al mes`,
        `Arriendo neto (descontadas vacancia, administración, contribuciones y mantención): ${formatearClp(economia.arriendoNetoClp)}`,
        `Dividendo: ${formatearClp(economia.dividendoClp)} — de eso, interés ${formatearClp(economia.interesClp)} y amortización ${formatearClp(economia.amortizacionClp)}`,
        `FLUJO MENSUAL: ${economia.flujoMensualClp < 0 ? `NEGATIVO, le cuesta ${formatearClp(Math.abs(economia.flujoMensualClp))} al mes` : `positivo, le quedan ${formatearClp(economia.flujoMensualClp)}`}`,
        `Costo real descontando la amortización: ${formatearClp(Math.abs(economia.costoRealMensualClp))} al mes`,
        `Rentabilidad bruta: ${formatearPorcentaje(economia.rentabilidadBrutaAnual)} anual`,
        `Rentabilidad NETA: ${formatearPorcentaje(economia.rentabilidadNetaAnual)} anual`,
        `Pie de ESTA unidad: ${formatearUf(economia.pieUf)} (financiamiento ${formatearPorcentaje(economia.financiamiento * 100, 0)}${yaTienePropiedad ? ", ya tiene propiedad" : ", es su primera propiedad"}); las siguientes van al ${formatearPorcentaje(FINANCIAMIENTO_INVERSION * 100, 0)}`,
      ].join("\n"),
    );
  }

  if (paraInvertir && principal && datos.unidadesDeseadas && datos.unidadesDeseadas > 1) {
    plan = planificarCartera(perfil, principal.precioUf, datos.unidadesDeseadas, valorUfClp, {
      gastosComunesClp: datos.gastosComunesClp ?? undefined,
      yaTienePropiedad,
    });
    bloques.push(
      [
        `CARTERA QUE PIDIÓ: ${datos.unidadesDeseadas} unidades`,
        `UNIDADES QUE LE FINANCIAN DE VERDAD: ${plan.unidadesFinanciables}`,
        `Qué lo frena: ${plan.restriccion}`,
        `Pie requerido: ${formatearUf(plan.pieRequeridoUf)} de ${formatearUf(plan.pieDisponibleUf)} disponibles`,
        `Dividendo total: ${formatearClp(plan.dividendoTotalClp)} contra un tope de ${formatearClp(plan.dividendoMaximoClp)}`,
        `Arriendo neto total: ${formatearClp(plan.arriendoNetoTotalClp)}`,
        `Flujo total: ${plan.flujoMensualTotalClp < 0 ? `NEGATIVO, ${formatearClp(Math.abs(plan.flujoMensualTotalClp))} al mes de su bolsillo` : `positivo, ${formatearClp(plan.flujoMensualTotalClp)}`}`,
        `Amortización total: ${formatearClp(plan.amortizacionTotalClp)} al mes pasan a patrimonio`,
        ...plan.notas.map((nota) => `- ${nota}`),
      ].join("\n"),
    );
  }

  const beneficios = datos.incentivos ?? [];
  if (beneficios.length > 0) {
    bloques.push(
      [
        `BENEFICIOS ESTATALES Y TRIBUTARIOS VIGENTES HOY`,
        `Estos son los únicos que existen y están vigentes. No menciones ningún otro, aunque lo recuerdes.`,
        `Cada uno va con sus requisitos completos y sus advertencias: no se ofrece la mitad buena.`,
        ...beneficios.map((incentivo, indice) => {
          // Qué significa el beneficio para ESTE prospecto. Sin esto el modelo
          // tiene que deducirlo, y un beneficio que suena bien pero no mueve
          // su número termina ofrecido igual.
          const efecto = efectoEnCapacidad(
            incentivo,
            capacidad.pieUf,
            capacidad.dividendoMaximoClp / valorUfClp,
          );
          const sinDatos = capacidad.precioMaximoUf === null || capacidad.dividendoMaximoClp <= 0;
          const linea = sinDatos
            ? `   EN ESTE CASO: todavía no se puede evaluar; falta saber su renta y su ahorro.`
            : efecto && (efecto.precioMaximoUf ?? 0) > (capacidad.precioMaximoUf ?? 0)
              ? `   EN ESTE CASO: le sube el techo de ${formatearUf(capacidad.precioMaximoUf ?? 0)} a ${formatearUf(efecto.precioMaximoUf ?? 0)}. Ofrecerlo.`
              : efecto
                ? `   EN ESTE CASO: NO le sube el techo. Con ${formatearUf(capacidad.pieUf)} de pie el límite deja de ser el ahorro y pasa a ser la renta, que solo soporta ${formatearClp(capacidad.dividendoMaximoClp)} de dividendo. Se puede mencionar que existe, pero NO como la solución a su caso.`
                : `   EN ESTE CASO: no cambia su capacidad de compra; es un beneficio de otro tipo.`;
          return `${indice + 1}. ${resumenParaFicha(incentivo)}\n${linea}`;
        }),
      ].join("\n"),
    );
  }

  const alternativas = datos.alternativas ?? [];
  if (alternativas.length > 0) {
    bloques.push(
      [
        `ALTERNATIVAS DE FINANCIAMIENTO (existen y aplican a este caso)`,
        `Si no le alcanza con su capacidad actual, NO cierres la conversación: ofrécele estas vías.`,
        `Cada una lleva su contra, y la contra se dice junto con la vía.`,
        ...alternativas.map((alternativa, indice) =>
          [
            `${indice + 1}. ${alternativa.titulo}`,
            `   Cómo funciona: ${alternativa.comoFunciona}`,
            `   Requisito: ${alternativa.requisito}`,
            `   Contra: ${alternativa.advertencia}`,
            alternativa.precioMaximoUf
              ? `   Techo con esta vía: ${formatearUf(alternativa.precioMaximoUf)} (sube ${formatearUf(alternativa.gananciaUf)})`
              : `   No cambia el techo, cambia la forma de pagar.`,
            alternativa.efectivoHoyClp !== null
              ? `   Efectivo necesario hoy: ${formatearClp(alternativa.efectivoHoyClp)}`
              : null,
            alternativa.proyectos.length > 0
              ? `   Disponible en: ${alternativa.proyectos.join(" · ")}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      ].join("\n"),
    );
  }

  bloques.push(
    [
      `AGENDA DISPONIBLE (los únicos bloques que puedes ofrecer)`,
      ...datos.bloques.map((bloque) => `- ${formatearFecha(bloque.inicio.toISOString())}`),
    ].join("\n"),
  );

  if (datos.intervencion !== "ninguna") {
    bloques.push(
      [
        `LO QUE EL SISTEMA VA A REVISAR DE TU RESPUESTA`,
        ...EXIGENCIAS_DE_RESPUESTA.map((exigencia) => `- ${exigencia}`),
      ].join("\n"),
    );
  }

  const texto = bloques.join("\n\n");
  // Las horas de la agenda no son montos: sin quitarlas, el "6" de las
  // 6:00 p. m. queda autorizando cualquier cifra que redondee a 6.
  const sinHoras = texto.replace(/\b\d{1,2}:\d{2}\b/g, " ");
  return { texto, cifras: new Set(cifrasDe(sinHoras)), economia, plan, alternativas };
}

// ----------------------------------------------------------------- el turno

export interface SalidaCloser {
  /** Lo que se le manda al prospecto. */
  mensaje: string;
  perfil: PerfilProspecto;
  /** Los tres datos que el cierre necesita extraer. */
  presupuestoUf: number | null;
  plazoCompra: string | null;
  metodoFinanciamiento: string | null;
  /** La acción concreta que pidió al cerrar. */
  cierrePropuesto: string | null;
  listoParaAgendar: boolean;
  origen: RespuestaModelo["origen"];
}

export type VersionPrompt = "v1" | "v2" | "v25";

/**
 * Los prompts disponibles.
 *
 * Se versionan para poder medirlos: correr la misma simulación con cada uno
 * y comparar qué produce. Los dos reciben el mismo apéndice del sistema, que
 * es lo que un prompt comercial no puede desactivar.
 */
export const PROMPTS: Record<VersionPrompt, { nombre: string; sistema: string }> = {
  v1: { nombre: "Closer v1", sistema: SISTEMA_CLOSER },
  v2: { nombre: "Closer v2.0", sistema: `${SISTEMA_CLOSER_V2}${CONTRATO_DE_HECHOS}` },
  v25: { nombre: "Closer v2.5", sistema: `${SISTEMA_CLOSER_V25}${CONTRATO_DE_HECHOS}` },
};

/**
 * Cuánto interviene el sistema sobre lo que escribe el modelo.
 *
 *   correccion  el prompt lleva el apéndice de hechos y, si la respuesta
 *               incumple, se le devuelve al modelo para que la rehaga
 *   ninguna     el prompt va literal y la respuesta sale tal cual
 *
 * "ninguna" existe para poder ver qué produce un prompt por sí solo. La
 * verificación igual corre, pero solo anota: no cambia una coma.
 */
export type Intervencion = "correccion" | "ninguna";

/** El prompt como se envía, según cuánto intervenga el sistema. */
export function sistemaDe(version: VersionPrompt, intervencion: Intervencion): string {
  if (intervencion === "ninguna") {
    if (version === "v25") return SISTEMA_CLOSER_V25;
    return version === "v2" ? SISTEMA_CLOSER_V2 : SISTEMA_CLOSER;
  }
  return PROMPTS[version].sistema;
}

export interface Incumplimiento {
  regla: string;
  detalle: string;
  /** La norma que lo impide, cuando el incumplimiento es normativo. */
  norma?: string;
  fuente?: string;
  gravedad?: "critica" | "alta" | "media";
  /** Qué se podría haber dicho en su lugar. */
  enSuLugar?: string;
}

const CONTRATO_SALIDA = `Responde SOLO con un objeto JSON, sin texto antes ni después, con esta forma:
{
  "mensaje": "el texto que se le envía al prospecto",
  "perfil": "A" | "B" | "indeterminado",
  "presupuestoUf": número o null,
  "plazoCompra": "lo que dijo sobre cuándo compra" o null,
  "metodoFinanciamiento": "crédito hipotecario | contado | mixto | no lo ha dicho",
  "cierrePropuesto": "la acción concreta que pediste" o null,
  "listoParaAgendar": true | false
}`;

function parsear(texto: string): Record<string, unknown> {
  const limpio = texto
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const inicio = limpio.indexOf("{");
  const fin = limpio.lastIndexOf("}");
  if (inicio === -1 || fin === -1) throw new Error("El modelo no devolvió JSON");
  return JSON.parse(limpio.slice(inicio, fin + 1)) as Record<string, unknown>;
}

export interface ContextoTurno {
  ficha: FichaDeHechos;
  historial: Array<{ direccion: "entrante" | "saliente"; cuerpo: string }>;
  mensajeDelProspecto: string;
  canal: "whatsapp" | "email";
  etiqueta: string;
  /** Prompt con el que se corre este turno. Por defecto, v1. */
  version?: VersionPrompt;
  /** Por defecto el sistema corrige; "ninguna" deja pasar lo que salga. */
  intervencion?: Intervencion;
}

export function peticionDelTurno(contexto: ContextoTurno): PeticionModelo {
  const conversacion =
    contexto.historial.length > 0
      ? contexto.historial
          .map((item) => `${item.direccion === "entrante" ? "PROSPECTO" : "TÚ"}: ${item.cuerpo}`)
          .join("\n")
      : "(todavía no hay conversación previa)";

  return {
    etiqueta: contexto.etiqueta,
    sistema: sistemaDe(contexto.version ?? "v1", contexto.intervencion ?? "correccion"),
    esfuerzo: "medium",
    maxTokens: 3000,
    mensajes: [
      {
        rol: "user",
        contenido: `## FICHA DE HECHOS
${contexto.ficha.texto}

## CONVERSACIÓN HASTA AHORA
${conversacion}

## ÚLTIMO MENSAJE DEL PROSPECTO
${contexto.mensajeDelProspecto}

## CANAL
${contexto.canal === "whatsapp" ? "WhatsApp: máximo 700 caracteres, sin firma." : "Correo: puedes estructurar y extenderte."}

${CONTRATO_SALIDA}`,
      },
    ],
  };
}

/**
 * Revisa la respuesta contra la ficha.
 *
 * Lo caro de equivocarse acá no es un mensaje feo: es una cifra inventada en
 * un mensaje que el comprador va a guardar.
 */
export function verificarRespuesta(
  salida: { mensaje: string },
  ficha: FichaDeHechos,
  historial: string[] = [],
): Incumplimiento[] {
  const problemas: Incumplimiento[] = [];

  // Lo que dijo el propio prospecto también es un dato válido de citar.
  const permitidas = new Set(ficha.cifras);
  for (const texto of historial) {
    for (const cifra of cifrasDe(texto)) permitidas.add(cifra);
  }

  const inventadas = cifrasAVerificar(salida.mensaje).filter(
    (cifra) => !coincide(cifra, permitidas),
  );
  for (const cifra of inventadas) {
    problemas.push({
      regla: "Toda cifra del mensaje aparece en la ficha de hechos",
      detalle: `La cifra ${cifra.toLocaleString("es-CL")} no está en la ficha`,
    });
  }

  const mencionaRentabilidad = /rentabilidad|cap rate|roi|retorno/i.test(salida.mensaje);
  if (mencionaRentabilidad && ficha.economia) {
    const dice = cifrasAVerificar(salida.mensaje);
    if (!dice.some((cifra) => coincide(cifra, new Set([ficha.economia!.rentabilidadNetaAnual])))) {
      problemas.push({
        regla: "Si hay rentabilidad, aparece la neta y no solo la bruta",
        detalle: `Habló de rentabilidad sin dar la neta (${ficha.economia.rentabilidadNetaAnual}%)`,
      });
    }
  }

  const flujoNegativo =
    (ficha.plan?.flujoMensualTotalClp ?? ficha.economia?.flujoMensualClp ?? 0) < 0;
  if (flujoNegativo && /se paga sol|se pagan sol|el arriendo (cubre|paga)/i.test(salida.mensaje)) {
    problemas.push({
      regla: "Si el flujo de arriendo es negativo, el mensaje lo dice",
      detalle: "Afirmó que el arriendo cubre el dividendo y la ficha dice que no",
    });
  }

  // El crédito especial de IVA es de la constructora. Prometerle al comprador
  // que "le devuelven el IVA" es la confusión más común del rubro.
  if (
    /te devuelven el iva|devoluci[óo]n de iva para ti|recuperas el iva|te descuentan el iva/i.test(
      salida.mensaje,
    )
  ) {
    problemas.push({
      regla: "No atribuir al comprador un beneficio que es de la constructora",
      detalle: "Ofreció devolución de IVA al comprador; el crédito especial es de la empresa constructora",
    });
  }

  if (/te (lo )?van a aprobar|cr[ée]dito (asegurado|garantizado)|aprobaci[óo]n garantizada/i.test(salida.mensaje)) {
    problemas.push({
      regla: "No promete la aprobación del crédito",
      detalle: "Dio por hecha la aprobación del banco",
    });
  }

  if (/te hago un descuento|te lo dejo en|te rebajo|puedo bajarte/i.test(salida.mensaje)) {
    problemas.push({
      regla: "No ofrece descuentos ni negocia precio",
      detalle: "Ofreció una rebaja que no le corresponde aprobar",
    });
  }

  // No cerrar la puerta cuando hay vía: el error que esto cubre es un agente
  // que dice "no tengo nada en tu rango" teniendo bono pie y pie cero en el
  // inventario.
  const hayAlternativas = (ficha.alternativas ?? []).length > 0;
  const cierraLaPuerta =
    /no tengo (nada|ninguna|unidades?) (en tu rango|que calce)|no hay nada (en tu rango|para ti)|no te alcanza/i.test(
      salida.mensaje,
    );
  const ofreceVia =
    /multicr[ée]dito|segundo titular|bono pie|pie en cuotas|pie cero|subsidio|leasing|30 a[ñn]os/i.test(
      salida.mensaje,
    );
  if (hayAlternativas && cierraLaPuerta && !ofreceVia) {
    problemas.push({
      regla: "Si no le alcanza, ofrece una alternativa de financiamiento",
      detalle: "Dijo que no hay nada para él teniendo vías disponibles en la ficha",
    });
  }

  // Afirmaciones que ninguna versión del prompt puede habilitar, porque no
  // las decide el criterio comercial sino la normativa.
  for (const detectada of afirmacionesProhibidasEn(salida.mensaje)) {
    problemas.push({
      regla: "Afirmación prohibida por normativa",
      detalle: `"${detectada.fragmento}" — ${detectada.afirmacion.afirmacion}`,
      norma: detectada.afirmacion.norma,
      fuente: detectada.afirmacion.fuente,
      gravedad: detectada.afirmacion.gravedad,
      enSuLugar: detectada.afirmacion.enSuLugar,
    });
  }

  if (!/\?/.test(salida.mensaje)) {
    problemas.push({
      regla: "Termina con una pregunta de cierre",
      detalle: "El mensaje no cierra con una pregunta",
    });
  }

  return problemas;
}

/**
 * Un turno completo: pide, verifica y, si algo falla, le devuelve al modelo
 * lo que incumplió para que lo corrija una vez.
 */
export async function turnoDelCloser(
  proveedor: ProveedorModelo,
  contexto: ContextoTurno,
): Promise<{ salida: SalidaCloser; problemas: Incumplimiento[]; reintentos: number }> {
  const historial = contexto.historial.map((item) => item.cuerpo);
  let peticion = peticionDelTurno(contexto);
  let reintentos = 0;

  for (;;) {
    const respuesta = await proveedor.generar(peticion);
    const crudo = parsear(respuesta.texto);
    const salida: SalidaCloser = {
      mensaje: String(crudo.mensaje ?? "").trim(),
      perfil: (["A", "B", "indeterminado"] as const).includes(crudo.perfil as PerfilProspecto)
        ? (crudo.perfil as PerfilProspecto)
        : "indeterminado",
      presupuestoUf: typeof crudo.presupuestoUf === "number" ? crudo.presupuestoUf : null,
      plazoCompra: crudo.plazoCompra ? String(crudo.plazoCompra) : null,
      metodoFinanciamiento: crudo.metodoFinanciamiento ? String(crudo.metodoFinanciamiento) : null,
      cierrePropuesto: crudo.cierrePropuesto ? String(crudo.cierrePropuesto) : null,
      listoParaAgendar: crudo.listoParaAgendar === true,
      origen: respuesta.origen,
    };

    const problemas = verificarRespuesta(salida, contexto.ficha, [
      ...historial,
      contexto.mensajeDelProspecto,
    ]);

    // Sin intervención, lo que salió es lo que se envía: los problemas se
    // devuelven como observación, no como corrección.
    if (contexto.intervencion === "ninguna") return { salida, problemas, reintentos };

    // Una sola corrección. Si vuelve a incumplir, la conversación la toma una
    // persona: insistir con el modelo sale más caro que un ejecutivo.
    if (problemas.length === 0 || reintentos >= 1) {
      return { salida, problemas, reintentos };
    }

    reintentos += 1;
    peticion = {
      ...peticion,
      etiqueta: `${contexto.etiqueta}:correccion`,
      mensajes: [
        ...peticion.mensajes,
        { rol: "assistant", contenido: respuesta.texto },
        {
          rol: "user",
          contenido: `Tu respuesta incumple el contrato:\n${problemas
            .map((problema) =>
              [
                `- ${problema.regla}: ${problema.detalle}`,
                problema.norma ? `  Norma: ${problema.norma}` : null,
                problema.enSuLugar ? `  En su lugar: ${problema.enSuLugar}` : null,
              ]
                .filter(Boolean)
                .join("\n"),
            )
            .join("\n")}\n\nCorrígela usando solo cifras de la ficha y sin las afirmaciones señaladas. Devuelve el mismo JSON.`,
        },
      ],
    };
  }
}
