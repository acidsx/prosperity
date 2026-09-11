/** Esquemas de salida estructurada del agente. */

import { z } from "zod";

/** Lo que el agente extrae del mensaje del comprador. */
export const EsquemaExtraccion = z.object({
  rentaClp: z.number().nullable().describe("Renta líquida mensual en pesos chilenos"),
  rentaVariableClp: z.number().nullable().describe("Parte variable de la renta, en pesos"),
  tipoRenta: z
    .enum(["fixed", "variable", "invoices"])
    .nullable()
    .describe("fixed: contrato; variable: comisiones; invoices: honorarios/boletas"),
  tienePareja: z.boolean().nullable(),
  rentaParejaClp: z.number().nullable(),
  rentaParejaVariableClp: z.number().nullable(),
  tipoRentaPareja: z.enum(["fixed", "variable", "invoices"]).nullable(),
  capacidadAhorroClp: z.number().nullable().describe("Cuánto puede ahorrar al mes"),
  ahorroClp: z.number().nullable().describe("Ahorro acumulado disponible para el pie"),
  tieneCuentaBancaria: z.boolean().nullable(),
  tieneDicom: z.boolean().nullable().describe("Si menciona morosidad o Dicom"),
  creditosHipotecarios: z.number().nullable(),
  dividendosMensualesClp: z.number().nullable(),
  creditosConsumo: z.number().nullable(),
  cuotasConsumoMensualesClp: z.number().nullable(),
  paraInvertir: z.boolean().nullable(),
  paraVivir: z.boolean().nullable(),
  comunasInteres: z.array(z.string()).describe("Comunas mencionadas, tal como las escribió"),
  dormitorios: z.number().nullable(),
  banos: z.number().nullable(),
  presupuestoUfDeclarado: z.number().nullable().describe("Presupuesto en UF si lo declara"),
  creditoPreaprobado: z.boolean().nullable(),
  postulaSubsidio: z.boolean().nullable().describe("Si menciona subsidio DS19, DS01 o similar"),
  pideVisita: z.boolean().describe("Si pide visitar, agendar o ver la propiedad"),
  urgencia: z.enum(["alta", "media", "baja"]),
  resumen: z.string().describe("Una frase con lo que busca esta persona"),
});

export type Extraccion = z.infer<typeof EsquemaExtraccion>;

/** Lo que el agente redacta una vez que ya tiene los proyectos que calzan. */
export const EsquemaRedaccion = z.object({
  mensajeRespuesta: z
    .string()
    .describe("Mensaje de WhatsApp listo para enviar, en español de Chile, máximo 900 caracteres"),
  objeciones: z.array(z.string()).describe("Objeciones o dudas que probablemente aparezcan"),
  riesgos: z.array(z.string()).describe("Riesgos comerciales de este lead para el corredor"),
  razonamiento: z.string().describe("Por qué se recomienda esto, para el ejecutivo"),
  motivos: z
    .array(z.object({ proyectoId: z.string(), motivo: z.string() }))
    .describe("Motivo breve por cada proyecto recomendado"),
  tags: z
    .array(z.string())
    .describe(
      "Etiquetas para el CRM. Una palabra cada una, sin espacios ni comas. Ej: preaprobado, inversion, subsidio",
    ),
});

export type Redaccion = z.infer<typeof EsquemaRedaccion>;
