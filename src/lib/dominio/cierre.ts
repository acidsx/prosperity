/**
 * El cierre de una venta inmobiliaria en Chile.
 *
 * Va desde la reserva hasta la inscripción en el Conservador de Bienes
 * Raíces y la entrega. Es el tramo que el API de JetBrokers no cubre: allá
 * vive el cliente y el catálogo, acá la operación.
 */

export type EtapaCierre =
  | "reserva"
  | "evaluacion_bancaria"
  | "promesa"
  | "escrituracion"
  | "firmas"
  | "inscripcion_cbr"
  | "pago_y_entrega"
  | "cerrado"
  | "caido";

export const ETAPAS_CIERRE: EtapaCierre[] = [
  "reserva",
  "evaluacion_bancaria",
  "promesa",
  "escrituracion",
  "firmas",
  "inscripcion_cbr",
  "pago_y_entrega",
  "cerrado",
];

export const ETIQUETA_CIERRE: Record<EtapaCierre, string> = {
  reserva: "Reserva",
  evaluacion_bancaria: "Evaluación bancaria",
  promesa: "Promesa",
  escrituracion: "Escrituración",
  firmas: "Firmas ante notario",
  inscripcion_cbr: "Inscripción en el CBR",
  pago_y_entrega: "Pago y entrega",
  cerrado: "Cerrado",
  caido: "Caído",
};

/** Quién tiene la pelota. Sirve para saber a quién apurar. */
export type Responsable =
  | "corredora"
  | "comprador"
  | "vendedor"
  | "banco"
  | "notaria"
  | "cbr"
  | "municipalidad";

export const ETIQUETA_RESPONSABLE: Record<Responsable, string> = {
  corredora: "Corredora",
  comprador: "Comprador",
  vendedor: "Vendedor",
  banco: "Banco",
  notaria: "Notaría",
  cbr: "Conservador",
  municipalidad: "Municipalidad",
};

export type TipoHito =
  | "reserva_firmada"
  | "reserva_vence"
  | "credito_ingresado"
  | "tasacion"
  | "estudio_titulos"
  | "credito_aprobado"
  | "promesa_firmada"
  | "plazo_escritura"
  | "borrador_escritura"
  | "firma_comprador"
  | "firma_vendedor"
  | "firma_banco"
  | "escritura_cerrada"
  | "ingreso_cbr"
  | "inscripcion_cbr"
  | "curse_credito"
  | "pago_vendedor"
  | "entrega_propiedad"
  | "factura_comision";

export interface DefinicionHito {
  tipo: TipoHito;
  nombre: string;
  etapa: EtapaCierre;
  responsable: Responsable;
  /** Días hábiles estimados desde que arranca la etapa. */
  diasEstimados: number;
  /** Por qué existe este hito, para el ejecutivo que recién entra. */
  detalle: string;
}

/**
 * Secuencia típica de una compraventa con crédito hipotecario. Los días son
 * estimaciones de mercado: sirven para proyectar la fecha comprometida y
 * detectar atrasos, no son promesas.
 */
export const PLAN_CIERRE: DefinicionHito[] = [
  {
    tipo: "reserva_firmada",
    nombre: "Reserva firmada y pagada",
    etapa: "reserva",
    responsable: "comprador",
    diasEstimados: 0,
    detalle: "El comprador paga la reserva y se firma el comprobante. Congela la unidad.",
  },
  {
    tipo: "reserva_vence",
    nombre: "Vencimiento de la reserva",
    etapa: "reserva",
    responsable: "corredora",
    diasEstimados: 30,
    detalle: "Si a esta fecha no hay promesa firmada, la unidad se libera o hay que prorrogar.",
  },
  {
    tipo: "credito_ingresado",
    nombre: "Solicitud ingresada al banco",
    etapa: "evaluacion_bancaria",
    responsable: "corredora",
    diasEstimados: 3,
    detalle: "Con la carpeta del comprador completa. Antes de esto el banco no evalúa.",
  },
  {
    tipo: "tasacion",
    nombre: "Tasación de la propiedad",
    etapa: "evaluacion_bancaria",
    responsable: "banco",
    diasEstimados: 10,
    detalle: "Perito del banco. Si tasa bajo el precio, el crédito se reduce y falta pie.",
  },
  {
    tipo: "estudio_titulos",
    nombre: "Estudio de títulos",
    etapa: "evaluacion_bancaria",
    responsable: "banco",
    diasEstimados: 15,
    detalle: "El abogado del banco revisa dominio, gravámenes y prohibiciones. Acá aparecen los problemas.",
  },
  {
    tipo: "credito_aprobado",
    nombre: "Crédito aprobado",
    etapa: "evaluacion_bancaria",
    responsable: "banco",
    diasEstimados: 20,
    detalle: "Aprobación final con monto, tasa y plazo. Habilita la promesa sin condición suspensiva.",
  },
  {
    tipo: "promesa_firmada",
    nombre: "Promesa de compraventa firmada",
    etapa: "promesa",
    responsable: "corredora",
    diasEstimados: 25,
    detalle: "Fija precio, plazos y multas. Suele llevar condición suspensiva de aprobación del crédito.",
  },
  {
    tipo: "plazo_escritura",
    nombre: "Plazo de la promesa para escriturar",
    etapa: "promesa",
    responsable: "corredora",
    diasEstimados: 75,
    detalle: "Fecha tope que fija la promesa. Pasarse activa las multas pactadas.",
  },
  {
    tipo: "borrador_escritura",
    nombre: "Borrador de escritura",
    etapa: "escrituracion",
    responsable: "banco",
    diasEstimados: 45,
    detalle: "Compraventa y mutuo hipotecario. Lo redacta el abogado del banco o de la notaría.",
  },
  {
    tipo: "firma_comprador",
    nombre: "Firma del comprador",
    etapa: "firmas",
    responsable: "comprador",
    diasEstimados: 55,
    detalle: "Ante notario, con cédula vigente. Si compra en matrimonio, firman los dos.",
  },
  {
    tipo: "firma_vendedor",
    nombre: "Firma del vendedor",
    etapa: "firmas",
    responsable: "vendedor",
    diasEstimados: 57,
    detalle: "Puede ser en día distinto al del comprador.",
  },
  {
    tipo: "firma_banco",
    nombre: "Firma del banco",
    etapa: "firmas",
    responsable: "banco",
    diasEstimados: 60,
    detalle: "El banco firma al final. Hasta que no firma, la escritura no queda cerrada.",
  },
  {
    tipo: "escritura_cerrada",
    nombre: "Escritura cerrada en notaría",
    etapa: "firmas",
    responsable: "notaria",
    diasEstimados: 62,
    detalle: "Con todas las firmas, la notaría cierra y entrega copias autorizadas.",
  },
  {
    tipo: "ingreso_cbr",
    nombre: "Ingreso al Conservador",
    etapa: "inscripcion_cbr",
    responsable: "notaria",
    diasEstimados: 65,
    detalle: "Se ingresa la escritura para inscribir el dominio y la hipoteca.",
  },
  {
    tipo: "inscripcion_cbr",
    nombre: "Inscripción de dominio e hipoteca",
    etapa: "inscripcion_cbr",
    responsable: "cbr",
    diasEstimados: 85,
    detalle: "Queda con fojas, número y año. Recién acá el comprador es dueño.",
  },
  {
    tipo: "curse_credito",
    nombre: "Curse del crédito",
    etapa: "pago_y_entrega",
    responsable: "banco",
    diasEstimados: 90,
    detalle: "Con la hipoteca inscrita, el banco libera el vale vista.",
  },
  {
    tipo: "pago_vendedor",
    nombre: "Pago al vendedor",
    etapa: "pago_y_entrega",
    responsable: "banco",
    diasEstimados: 92,
    detalle: "Se entrega el vale vista y se paga el saldo de precio.",
  },
  {
    tipo: "entrega_propiedad",
    nombre: "Entrega de la propiedad",
    etapa: "pago_y_entrega",
    responsable: "vendedor",
    diasEstimados: 95,
    detalle: "Acta de entrega, llaves y lecturas de medidores.",
  },
  {
    tipo: "factura_comision",
    nombre: "Comisión facturada",
    etapa: "pago_y_entrega",
    responsable: "corredora",
    diasEstimados: 97,
    detalle: "Se emite la factura de corretaje y se cobra.",
  },
];

export function definicionHito(tipo: TipoHito): DefinicionHito {
  const encontrada = PLAN_CIERRE.find((item) => item.tipo === tipo);
  if (!encontrada) throw new Error(`Hito desconocido: ${tipo}`);
  return encontrada;
}

export interface Hito {
  tipo: TipoHito;
  /** Fecha en que debería estar listo. */
  comprometidoPara: string | null;
  cumplidoEn: string | null;
  nota: string | null;
}

/** Bancos que operan crédito hipotecario en Chile. */
export const BANCOS = [
  "Banco de Chile",
  "Banco Santander",
  "BCI",
  "BancoEstado",
  "Scotiabank",
  "Itaú",
  "Banco Security",
  "Banco Falabella",
  "Banco BICE",
  "Banco Consorcio",
  "Banco Internacional",
  "Coopeuch",
] as const;

export type Banco = (typeof BANCOS)[number];

export type EstadoCredito =
  | "por_ingresar"
  | "ingresada"
  | "en_tasacion"
  | "en_estudio_titulos"
  | "aprobada"
  | "aprobada_con_reparos"
  | "rechazada"
  | "desistida";

export const ETIQUETA_CREDITO: Record<EstadoCredito, string> = {
  por_ingresar: "Por ingresar",
  ingresada: "Ingresada",
  en_tasacion: "En tasación",
  en_estudio_titulos: "En estudio de títulos",
  aprobada: "Aprobada",
  aprobada_con_reparos: "Aprobada con reparos",
  rechazada: "Rechazada",
  desistida: "Desistida",
};

export interface SolicitudCredito {
  banco: Banco | string;
  ejecutivoBanco: string | null;
  contactoBanco: string | null;
  estado: EstadoCredito;
  /** Monto solicitado, en UF. */
  montoUf: number | null;
  /** Tasa anual pactada, en porcentaje. */
  tasaAnual: number | null;
  plazoAnos: number | null;
  /** Valor de la tasación, en UF. Si viene bajo el precio, falta pie. */
  tasacionUf: number | null;
  /** Observaciones del estudio de títulos, que es donde aparecen los problemas. */
  reparos: string[];
  actualizadaEn: string;
}

export interface Firma {
  id: string;
  /** Quién firma: comprador, vendedor o el banco. */
  parte: "comprador" | "vendedor" | "banco";
  notaria: string | null;
  direccionNotaria: string | null;
  /** ISO 8601 en horario de Chile. */
  agendadaPara: string | null;
  firmadaEn: string | null;
  /** Quiénes deben asistir; en matrimonio firman los dos. */
  asistentes: string[];
  nota: string | null;
}

export interface InscripcionCbr {
  conservador: string | null;
  ingresadaEn: string | null;
  numeroIngreso: string | null;
  inscritaEn: string | null;
  /** Datos de la inscripción de dominio. */
  fojas: string | null;
  numero: string | null;
  ano: number | null;
  /** El Conservador puede rechazar y obligar a corregir la escritura. */
  reparos: string[];
}

/** Parte de la operación: comprador, vendedor o representante. */
export interface Parte {
  nombre: string;
  rut: string | null;
  email: string | null;
  telefono: string | null;
  /** Régimen patrimonial: importa para quién firma. */
  estadoCivil: string | null;
}

export interface Negocio {
  id: string;
  leadId: string;
  proyectoId: string | null;
  /** Unidad concreta: "Depto 802", "Casa 14". */
  unidad: string | null;
  /** Tipología del proyecto. */
  modelo: string | null;
  precioUf: number;
  descuentoUf: number;
  reservaClp: number;
  /** Ejecutivo dueño del negocio. */
  ejecutivoId: string | null;
  etapa: EtapaCierre;
  compradores: Parte[];
  vendedor: Parte | null;
  credito: SolicitudCredito | null;
  firmas: Firma[];
  cbr: InscripcionCbr | null;
  hitos: Hito[];
  /** Control documental de la propiedad y del vendedor. */
  documentos: import("@/lib/documentos/propiedad").DocumentoNegocio[];
  /** Departamento o condominio: cambia qué certificados se piden. */
  esCopropiedad: boolean;
  /** Comisión de la corredora, en UF. */
  comisionUf: number | null;
  comisionFacturada: boolean;
  motivoCaida: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

export function precioFinalUf(negocio: Negocio): number {
  return Math.max(negocio.precioUf - negocio.descuentoUf, 0);
}
