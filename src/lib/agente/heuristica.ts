/**
 * Motor de respaldo, sin modelo.
 *
 * Se usa cuando no hay credenciales de Anthropic o cuando la llamada falla:
 * el gestor sigue operando, con menos finura pero sin dejar leads sin
 * responder. Extrae montos con expresiones regulares y arma el mensaje con
 * plantillas.
 */

import type { Extraccion, Redaccion } from "@/lib/agente/esquemas";
import type { ContextoRedaccion } from "@/lib/agente/claude";
import { COMUNAS, formatearClp, formatearUf } from "@/lib/dominio/chile";
import type { Lead } from "@/lib/dominio/tipos";
import { superficieUtil } from "@/lib/jetbrokers/mapeo";

/** "$2.400.000", "2.400.000", "2,4 millones", "1800000" -> número de pesos. */
function montosClp(texto: string): number[] {
  const montos: number[] = [];

  const millones = texto.matchAll(/([\d]+(?:[.,]\d+)?)\s*millones?/gi);
  for (const coincidencia of millones) {
    const valor = Number(coincidencia[1].replace(",", "."));
    if (Number.isFinite(valor)) montos.push(Math.round(valor * 1_000_000));
  }

  const conSeparador = texto.matchAll(/\$?\s?(\d{1,3}(?:\.\d{3}){1,3})\b/g);
  for (const coincidencia of conSeparador) {
    const valor = Number(coincidencia[1].replace(/\./g, ""));
    if (Number.isFinite(valor) && valor >= 100_000) montos.push(valor);
  }

  return montos;
}

function montoUf(texto: string): number | null {
  // La forma con separador de miles va primero y exige al menos un grupo:
  // si no, "UF 4700" calzaría como 470 y dejaría el 0 afuera.
  const coincidencia = texto.match(/UF\s?\.?\s?(\d{1,3}(?:[.,]\d{3})+|\d+)\b/i);
  if (!coincidencia) return null;
  const valor = Number(coincidencia[1].replace(/[.,]/g, ""));
  return Number.isFinite(valor) ? valor : null;
}

function comunasMencionadas(texto: string): string[] {
  const normalizar = (valor: string) =>
    valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const plano = normalizar(texto);
  return COMUNAS.filter((comuna) => plano.includes(normalizar(comuna.nombre))).map((comuna) => comuna.nombre);
}

export function extraerPerfilHeuristico(lead: Lead): Extraccion {
  const texto = lead.mensajeInicial;
  const plano = texto.toLowerCase();
  const montos = montosClp(texto).sort((a, b) => b - a);

  // El monto más grande suele ser el ahorro y el más chico la renta; solo
  // separamos cuando la diferencia es clara.
  const grandes = montos.filter((monto) => monto >= 5_000_000);
  const chicos = montos.filter((monto) => monto < 5_000_000);

  const mencionaCuota = /cuota|dividendo/i.test(texto);
  const rentaClp = chicos.find((monto) => monto >= 300_000) ?? null;
  const cuotaConsumo = mencionaCuota ? (chicos.find((monto) => monto < 500_000 && monto !== rentaClp) ?? null) : null;

  const comunas = comunasMencionadas(texto);
  const dormitorios = texto.match(/(\d)\s?[dD](?:orm)?\b/);
  const banos = texto.match(/(\d)\s?[bB](?:a[ñn]o)?\b/);

  // "arriendo" no lo cubría "arrend": en Chile el sustantivo lleva i
  // ("compro para arriendo") y es la forma más común de decirlo.
  // "renta" a secas tampoco sirve: casi siempre es su renta líquida, no la
  // del negocio, así que solo cuentan "rentabilidad" y "rentar".
  const paraInvertir = /invers|arrend|arriend|airbnb|plusval|rentabilidad|rentar\b/i.test(plano);
  const pagaContado = /al contado|pago contado|sin cr[ée]dito|efectivo/i.test(plano);
  const paraVivir = /vivir|primera vivienda|mi familia|mi señora|mi esposa|mi pareja/i.test(plano);

  return {
    rentaClp,
    rentaVariableClp: null,
    tipoRenta: /honorario|boleta/i.test(plano)
      ? "invoices"
      : /indefinido|planta|contrato/i.test(plano)
        ? "fixed"
        : null,
    tienePareja: /pareja|señora|esposa|esposo|mi marido|somos pareja|entre los dos/i.test(plano) || null,
    rentaParejaClp: null,
    rentaParejaVariableClp: null,
    tipoRentaPareja: null,
    capacidadAhorroClp: null,
    ahorroClp: grandes.find((monto) => monto < 500_000_000) ?? null,
    tieneCuentaBancaria: null,
    tieneDicom: /dicom|moros|bolet[íi]n/i.test(plano) ? true : null,
    creditosHipotecarios: null,
    dividendosMensualesClp: null,
    creditosConsumo: /cr[ée]dito de consumo/i.test(plano) ? 1 : null,
    cuotasConsumoMensualesClp: cuotaConsumo,
    paraInvertir: paraInvertir || null,
    paraVivir: paraVivir || null,
    comunasInteres: comunas.length > 0 ? comunas : lead.comunasInteres,
    dormitorios: dormitorios ? Number(dormitorios[1]) : null,
    banos: banos ? Number(banos[1]) : null,
    presupuestoUfDeclarado: montoUf(texto) ?? lead.presupuestoUfDeclarado,
    creditoPreaprobado: /preaprobad|aprobado|pre-aprobad/i.test(plano) || null,
    postulaSubsidio: /subsidio|ds\s?19|ds\s?01/i.test(plano) || null,
    pagaContado: pagaContado || null,
    pideVisita: /visit|ver el|conocer|agendar|mostrar/i.test(plano),
    urgencia: /esta semana|urgente|mañana|viajo|sábado|hoy/i.test(plano)
      ? "alta"
      : /compar|cotiz|averigu/i.test(plano)
        ? "baja"
        : "media",
    resumen: `Consulta por ${comunas[0] ?? lead.comunasInteres[0] ?? "el proyecto publicado"}${
      paraInvertir ? " con fines de inversión" : paraVivir ? " para vivir" : ""
    }.`,
  };
}

export function redactarRespuestaHeuristica(contexto: ContextoRedaccion): Redaccion {
  const { lead, candidatos, capacidad, horarios, firma } = contexto;
  const formatoHorario = new Intl.DateTimeFormat("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Santiago",
  });

  const primerNombre = lead.nombre.split(" ")[0];
  const sugeridos = candidatos.slice(0, 2);

  const techo = capacidad.precioMaximoUf;
  const lineasProyectos = sugeridos.map((candidato) => {
    const precio = candidato.precioUf ? ` desde ${formatearUf(candidato.precioUf)}` : "";
    const superficie = candidato.modelo ? superficieUtil(candidato.modelo) : null;
    const tipologia = candidato.modelo
      ? ` (${candidato.modelo.rooms}D${candidato.modelo.bathrooms}B${superficie ? `, ${superficie} m²` : ""})`
      : "";
    // Si queda sobre lo que puede financiar, hay que decirlo en el mismo
    // mensaje: descubrirlo en la firma es mucho peor.
    const sobreElTecho =
      techo !== null && candidato.precioUf !== null && candidato.precioUf > techo
        ? " — queda algo sobre tu tope, habría que negociar el precio"
        : "";
    return `• ${candidato.proyecto.nombre}, ${candidato.proyecto.comuna}${precio}${tipologia}${sobreElTecho}`;
  });

  const horariosTexto = horarios.slice(0, 2).map((bloque) => formatoHorario.format(bloque.inicio));

  const mensaje = [
    `Hola ${primerNombre}, gracias por escribir.`,
    sugeridos.length > 0
      ? `Según lo que me cuentas, te calzan:\n${lineasProyectos.join("\n")}`
      : "Estoy revisando qué opciones del inventario te calzan mejor y te confirmo a la brevedad.",
    capacidad.precioMaximoUf
      ? `Con los datos que me diste, podrías apuntar hasta ${formatearUf(
          capacidad.precioMaximoUf,
        )} aprox. Es una estimación referencial, la evaluación final la hace el banco.`
      : null,
    horariosTexto.length > 0
      ? `¿Te acomoda visitar el ${horariosTexto[0]}${horariosTexto[1] ? ` o el ${horariosTexto[1]}` : ""}?`
      : "¿Qué día de esta semana te acomoda para visitar?",
    `Saludos,\n${firma}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const objeciones: string[] = [];
  if (capacidad.restriccion === "pie") objeciones.push("Pie insuficiente para el 20% que exige la banca");
  if (capacidad.restriccion === "dicom") objeciones.push("Dicom vigente bloquea la preaprobación");
  if (sugeridos.length === 0) objeciones.push("No hay inventario que calce con su presupuesto o comuna");

  const tags = [
    contexto.extraccion.creditoPreaprobado ? "preaprobado" : null,
    contexto.extraccion.postulaSubsidio ? "subsidio" : null,
    contexto.extraccion.paraInvertir ? "inversion" : null,
    contexto.extraccion.paraVivir ? "primera-vivienda" : null,
    contexto.extraccion.urgencia === "alta" ? "urgente" : null,
  ].filter((tag): tag is string => tag !== null);

  return {
    mensajeRespuesta: mensaje,
    objeciones,
    riesgos: capacidad.restriccion === "sin_datos" ? ["Faltan datos financieros para calificar"] : [],
    razonamiento: `Calce por presupuesto y comuna. ${capacidad.notas.join(" ")}`.trim(),
    motivos: sugeridos.map((candidato) => ({
      proyectoId: candidato.proyecto.id,
      motivo: candidato.motivos[0] ?? "Calza con lo que busca",
    })),
    tags,
  };
}

/** Texto de apoyo para mostrar el dividendo estimado en la ficha del lead. */
export function resumenFinanciero(contexto: ContextoRedaccion): string {
  const { capacidad } = contexto;
  if (!capacidad.precioMaximoUf) return "Sin datos suficientes para estimar capacidad de compra.";
  return `Hasta ${formatearUf(capacidad.precioMaximoUf)} con dividendo de ${formatearClp(
    capacidad.dividendoMaximoClp,
  )}.`;
}
