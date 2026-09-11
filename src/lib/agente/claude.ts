/**
 * Las dos llamadas al modelo: extraer el perfil del mensaje y redactar la
 * respuesta. El cálculo financiero y el calce con el inventario quedan
 * fuera a propósito, en código determinista y auditable.
 */

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { EsquemaExtraccion, EsquemaRedaccion, type Extraccion, type Redaccion } from "@/lib/agente/esquemas";
import type { Candidato } from "@/lib/agente/matching";
import { formatearClp, formatearUf } from "@/lib/dominio/chile";
import type { CapacidadCompra } from "@/lib/dominio/financiamiento";
import type { Lead } from "@/lib/dominio/tipos";
import { superficieUtil } from "@/lib/jetbrokers/mapeo";
import { ETIQUETA_ETAPA_PROYECTO } from "@/lib/jetbrokers/tipos";

export const MODELO = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

let clienteCache: Anthropic | null = null;

/**
 * El SDK resuelve credenciales desde ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN
 * o un perfil de `ant auth login`. Si no hay ninguna, el gestor cae a la
 * heurística local en vez de fallar.
 */
export function clienteClaude(): Anthropic | null {
  if (clienteCache) return clienteCache;
  const hayCredencial =
    Boolean(process.env.ANTHROPIC_API_KEY) || Boolean(process.env.ANTHROPIC_AUTH_TOKEN);
  if (!hayCredencial) return null;
  clienteCache = new Anthropic();
  return clienteCache;
}

const SISTEMA_EXTRACCION = `Eres el asistente de un corredor de propiedades en Chile.
Tu tarea es leer la consulta de un comprador y extraer solo lo que el mensaje dice.

Reglas:
- Los montos en pesos chilenos vienen escritos como "$2.400.000" o "2,4 millones": devuélvelos como número entero de pesos (2400000).
- Los montos en UF vienen como "UF 3.500" o "3500 UF": devuélvelos como número de UF, no de pesos.
- No inventes datos. Si el mensaje no lo dice, devuelve null.
- "Contrato indefinido" o "planta" es tipoRenta fixed; "honorarios" o "boletas" es invoices; "comisiones" es variable.
- Dicom, morosidad o "estar en el boletín" implica tieneDicom true.
- Si menciona arrendar, plusvalía, Airbnb o renta, paraInvertir es true.
- "Primera vivienda", "para vivir con mi familia" implica paraVivir true.`;

const SISTEMA_REDACCION = `Eres el asistente de un corredor de propiedades en Chile. Redactas el
primer contacto por WhatsApp con un comprador que consultó por un proyecto.

Cómo escribes:
- Español de Chile, cercano pero profesional. Tuteas. Sin emojis excesivos (máximo uno).
- Breve: va por WhatsApp, no es un correo formal. Máximo 900 caracteres.
- Partes saludando por su nombre y respondiendo lo que preguntó.
- Precios siempre en UF, que es como se transan las propiedades en Chile. El monto de reserva va en pesos.
- Propones dos o tres horarios concretos de visita, no "cuando gustes".
- Cierras con una pregunta que facilite la respuesta.

Lo que nunca haces:
- No prometes que le van a aprobar el crédito. El dividendo y el monto financiable son estimaciones referenciales, sujetas a evaluación del banco.
- No inventas precios, tipologías, comunas ni beneficios: usa solo los proyectos que te paso.
- No pides RUT, clave única, liquidaciones ni documentos por WhatsApp en el primer contacto.
- No prometes descuentos ni rebajas que no estén en los datos del proyecto.`;

function describirCandidatos(candidatos: Candidato[], valorUfClp: number): string {
  if (candidatos.length === 0) return "No hay proyectos del inventario que calcen con su búsqueda.";

  return candidatos
    .map((candidato, indice) => {
      const proyecto = candidato.proyecto;
      const lineas = [
        `${indice + 1}. ${proyecto.nombre} (id: ${proyecto.id})`,
        `   Comuna: ${proyecto.comuna}`,
        candidato.precioUf ? `   Precio: ${formatearUf(candidato.precioUf)} (${formatearClp(candidato.precioUf * valorUfClp)})` : null,
        candidato.modelo
          ? `   Tipología sugerida: ${candidato.modelo.name}, ${candidato.modelo.rooms}D${candidato.modelo.bathrooms}B${
              superficieUtil(candidato.modelo) ? `, ${superficieUtil(candidato.modelo)} m² útiles` : ""
            }`
          : null,
        proyecto.etapa ? `   Etapa: ${ETIQUETA_ETAPA_PROYECTO[proyecto.etapa]}` : null,
        proyecto.entrega || proyecto.anoEntrega
          ? `   Entrega: ${[proyecto.entrega, proyecto.anoEntrega].filter(Boolean).join(" ")}`
          : null,
        proyecto.reservaClp ? `   Reserva: ${formatearClp(proyecto.reservaClp)}` : null,
        proyecto.tags.length ? `   Beneficios: ${proyecto.tags.join(", ")}` : null,
        `   Por qué calza: ${candidato.motivos.join("; ")}`,
      ];
      return lineas.filter(Boolean).join("\n");
    })
    .join("\n\n");
}

export async function extraerPerfil(lead: Lead): Promise<Extraccion> {
  const cliente = clienteClaude();
  if (!cliente) throw new Error("No hay credenciales de Anthropic configuradas");

  const respuesta = await cliente.messages.parse({
    model: MODELO,
    max_tokens: 4000,
    system: SISTEMA_EXTRACCION,
    output_config: {
      effort: "low",
      format: zodOutputFormat(EsquemaExtraccion),
    },
    messages: [
      {
        role: "user",
        content: [
          `Consulta recibida por ${lead.canal.replace(/_/g, " ")}:`,
          `De: ${lead.nombre}`,
          lead.presupuestoUfDeclarado ? `Presupuesto declarado en el formulario: UF ${lead.presupuestoUfDeclarado}` : null,
          lead.comunasInteres.length ? `Comunas del formulario: ${lead.comunasInteres.join(", ")}` : null,
          "",
          `Mensaje: "${lead.mensajeInicial}"`,
        ]
          .filter((linea) => linea !== null)
          .join("\n"),
      },
    ],
  });

  if (!respuesta.parsed_output) {
    throw new Error("El modelo no devolvió una extracción válida");
  }
  return respuesta.parsed_output;
}

export interface ContextoRedaccion {
  lead: Lead;
  extraccion: Extraccion;
  capacidad: CapacidadCompra;
  candidatos: Candidato[];
  horarios: Array<{ inicio: Date; fin: Date }>;
  valorUfClp: number;
  /** Nombre con el que firma el agente. */
  firma: string;
}

export async function redactarRespuesta(contexto: ContextoRedaccion): Promise<Redaccion> {
  const cliente = clienteClaude();
  if (!cliente) throw new Error("No hay credenciales de Anthropic configuradas");

  const formatoHorario = new Intl.DateTimeFormat("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Santiago",
  });

  const capacidad = contexto.capacidad;
  const bloqueCapacidad = [
    capacidad.precioMaximoUf
      ? `Techo de compra estimado: ${formatearUf(capacidad.precioMaximoUf)}.`
      : "No se pudo estimar su techo de compra con los datos del mensaje.",
    capacidad.dividendoMaximoClp
      ? `Dividendo máximo estimado: ${formatearClp(capacidad.dividendoMaximoClp)} al mes.`
      : null,
    capacidad.pieUf ? `Pie disponible: ${formatearUf(capacidad.pieUf)}.` : "No declara ahorro para el pie.",
    `Restricción principal: ${capacidad.restriccion}.`,
    ...capacidad.notas.map((nota) => `- ${nota}`),
  ]
    .filter(Boolean)
    .join("\n");

  const respuesta = await cliente.messages.parse({
    model: MODELO,
    max_tokens: 8000,
    system: SISTEMA_REDACCION,
    output_config: {
      effort: "medium",
      format: zodOutputFormat(EsquemaRedaccion),
    },
    messages: [
      {
        role: "user",
        content: `Comprador: ${contexto.lead.nombre}
Canal: ${contexto.lead.canal.replace(/_/g, " ")}
Mensaje original: "${contexto.lead.mensajeInicial}"

Lo que se entendió de su mensaje:
${contexto.extraccion.resumen}
Urgencia: ${contexto.extraccion.urgencia}. ¿Pide visita?: ${contexto.extraccion.pideVisita ? "sí" : "no"}.

Evaluación financiera (valor UF de hoy: ${formatearClp(contexto.valorUfClp)}):
${bloqueCapacidad}

Proyectos del inventario que calzan:
${describirCandidatos(contexto.candidatos, contexto.valorUfClp)}

Horarios de visita disponibles:
${contexto.horarios.map((bloque) => `- ${formatoHorario.format(bloque.inicio)}`).join("\n")}

Redacta el mensaje de respuesta firmando como ${contexto.firma}. Menciona a lo más dos proyectos
para no saturar, y ofrece dos de los horarios disponibles.`,
      },
    ],
  });

  if (!respuesta.parsed_output) {
    throw new Error("El modelo no devolvió una redacción válida");
  }
  return respuesta.parsed_output;
}
