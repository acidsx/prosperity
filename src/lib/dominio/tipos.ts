/**
 * Tipos del gestor. El inventario y el pipeline siguen la forma de
 * JetBrokers para que lo que se ve acá sea lo mismo que hay en el CRM.
 */

import type {
  AlcanceProyecto,
  EstadoCliente,
  EtapaProyecto,
  ModeloProyecto,
  ModoProyecto,
  Sexo,
  TipoRenta,
} from "@/lib/jetbrokers/tipos";

/** Proyecto normalizado: mezcla el resumen del buscador con el detalle. */
export interface Proyecto {
  id: string;
  nombre: string;
  slug: string;
  /** locality en JetBrokers; en Chile, la comuna. */
  comuna: string;
  region: string | null;
  direccion: string | null;
  desarrollador: string | null;
  etapa: EtapaProyecto | null;
  modo: ModoProyecto | null;
  alcance: AlcanceProyecto | null;
  /** Precios en UF. */
  precioDesdeUf: number | null;
  precioHastaUf: number | null;
  /** Reserva en pesos. */
  reservaClp: number | null;
  /** Comisión del broker, en porcentaje sobre el precio. */
  feePorcentaje: number | null;
  entrega: string | null;
  anoEntrega: number | null;
  tags: string[];
  modelos: ModeloProyecto[];
  beneficios: string[];
  descripcion: string | null;
  portadaId: string | null;
  brokerEmail: string | null;
  brokerNombre: string | null;
  /** true si vino del API y no del inventario de demostración. */
  desdeApi: boolean;
}

export type CanalLead =
  | "portal_inmobiliario"
  | "yapo"
  | "toctoc"
  | "sitio_web"
  | "whatsapp"
  | "referido"
  | "instagram"
  | "landing_campana";

/** Lo que se sabe del comprador. Calza uno a uno con el Customer API. */
export interface PerfilFinanciero {
  /** Renta líquida mensual en pesos. */
  rentaClp: number | null;
  rentaVariableClp: number | null;
  tipoRenta: TipoRenta | null;
  tienePareja: boolean | null;
  rentaParejaClp: number | null;
  rentaParejaVariableClp: number | null;
  tipoRentaPareja: TipoRenta | null;
  /** Capacidad de ahorro mensual, en pesos. */
  capacidadAhorroClp: number | null;
  /** Ahorro acumulado para el pie, en pesos. */
  ahorroClp: number | null;
  tieneCuentaBancaria: boolean | null;
  /** Morosidad registrada. Es determinante para la preaprobación. */
  tieneDicom: boolean | null;
  creditosHipotecarios: number | null;
  dividendosMensualesClp: number | null;
  creditosConsumo: number | null;
  cuotasConsumoMensualesClp: number | null;
  paraInvertir: boolean | null;
  paraVivir: boolean | null;
}

export const PERFIL_VACIO: PerfilFinanciero = {
  rentaClp: null,
  rentaVariableClp: null,
  tipoRenta: null,
  tienePareja: null,
  rentaParejaClp: null,
  rentaParejaVariableClp: null,
  tipoRentaPareja: null,
  capacidadAhorroClp: null,
  ahorroClp: null,
  tieneCuentaBancaria: null,
  tieneDicom: null,
  creditosHipotecarios: null,
  dividendosMensualesClp: null,
  creditosConsumo: null,
  cuotasConsumoMensualesClp: null,
  paraInvertir: null,
  paraVivir: null,
};

export interface Lead {
  id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  /** RUT; en el API viaja como taxId. */
  rut: string | null;
  canal: CanalLead;
  campana: string | null;
  proyectoIdInteres: string | null;
  mensajeInicial: string;
  comunasInteres: string[];
  presupuestoUfDeclarado: number | null;
  sexo: Sexo | null;
  perfil: PerfilFinanciero;
  creadoEn: string;
  /**
   * Último mensaje entrante del comprador. Define la ventana de 24 horas de
   * WhatsApp: fuera de ella solo se pueden enviar plantillas aprobadas.
   */
  ultimoEntranteEn: string | null;
  /** El comprador pidió no recibir más mensajes. Manda sobre todo lo demás. */
  optOut: boolean;
  optOutEn: string | null;
  /** Conversación tomada por una persona: el agente deja de responder. */
  enManosDeHumano: boolean;
  /** Ejecutivo dueño de la cartera. null = sin asignar. */
  ejecutivoId: string | null;
}

export interface ProyectoRecomendado {
  proyectoId: string;
  nombre: string;
  comuna: string;
  precioUf: number | null;
  /** Tipología sugerida, p. ej. "A8" o "2D2B". */
  modelo: string | null;
  motivo: string;
}

export interface Calificacion {
  /** 0-100: capacidad de pago, intención y calce con el inventario. */
  puntaje: number;
  temperatura: "caliente" | "tibio" | "frio";
  /** Techo de compra en UF según renta, ahorro y deudas. */
  presupuestoUfEstimado: number | null;
  /** Pie disponible en UF. */
  pieUfEstimado: number | null;
  /** Perfil extraído del mensaje, para enriquecer el CRM. */
  perfil: PerfilFinanciero;
  comunasInteres: string[];
  urgencia: "alta" | "media" | "baja";
  recomendaciones: ProyectoRecomendado[];
  objeciones: string[];
  riesgos: string[];
  razonamiento: string;
  /** Estado propuesto para el CRM. */
  estadoSugerido: EstadoCliente;
  siguienteAccion:
    | "responder_y_agendar"
    | "responder_y_pedir_datos"
    | "derivar_a_ejecutivo"
    | "nutrir"
    | "descartar";
  /** Mensaje listo para enviar por WhatsApp. */
  mensajeRespuesta: string;
  /** Bloques horarios propuestos, ISO 8601. */
  horariosPropuestos: string[];
  /** Etiquetas para el CRM: sin espacios ni comas. */
  tags: string[];
  motor: "claude" | "heuristica";
  calificadoEn: string;
}

export interface Oportunidad {
  id: string;
  leadId: string;
  proyectoId: string | null;
  modelo: string | null;
  /** Estado del pipeline, con los valores que acepta el CRM. */
  estado: EstadoCliente;
  calificacion: Calificacion | null;
  valorUf: number | null;
  comisionUf: number | null;
  motivoPerdida: string | null;
  /** Resultado del último push al CRM. */
  sincronizadoEn: string | null;
  /**
   * Huella del último payload efectivamente enviado. Evita gastar uno de los
   * diez envíos por hora reenviando algo idéntico.
   */
  huellaSincronizacion: string | null;
  sincronizacion: "pendiente" | "simulado" | "enviado" | "error";
  detalleSincronizacion: string | null;
  creadaEn: string;
  actualizadaEn: string;
}

export type CanalMensaje = "whatsapp" | "email" | "portal";

export type EstadoMensaje = "encolado" | "enviado" | "entregado" | "leido" | "fallido" | "simulado";

export interface Mensaje {
  id: string;
  leadId: string;
  direccion: "entrante" | "saliente";
  canal: CanalMensaje;
  cuerpo: string;
  automatico: boolean;
  enviadoEn: string;
  /** ID del mensaje en WhatsApp o Resend, para conciliar estados y evitar duplicados. */
  idProveedor: string | null;
  estado: EstadoMensaje;
  /** Nombre de la plantilla de Meta, cuando se envió fuera de la ventana de 24 h. */
  plantilla: string | null;
  /** Asunto, solo para correo. */
  asunto: string | null;
  detalleError: string | null;
  /** Objeción del comprador que este mensaje respondió, si hubo una. */
  objecion: string | null;
}

export type EstadoVisita = "propuesta" | "confirmada" | "realizada" | "no_asistio" | "cancelada";

export interface Visita {
  id: string;
  leadId: string;
  proyectoId: string;
  inicio: string;
  fin: string;
  estado: EstadoVisita;
  notas: string | null;
  creadaEn: string;
  confirmadaEn: string | null;
  /** Recordatorios ya enviados, para no repetirlos. */
  recordatorios: number;
}

export type TipoActividad =
  | "lead_ingresado"
  | "mensaje_recibido"
  | "visita_confirmada"
  | "visita_reagendada"
  | "documentos_solicitados"
  | "documentos_recibidos"
  | "opt_out"
  | "envio_bloqueado"
  | "lead_calificado"
  | "mensaje_enviado"
  | "visita_propuesta"
  | "estado_cambiado"
  | "crm_sincronizado"
  | "derivado_a_humano"
  | "descartado"
  | "error_agente";

export interface Actividad {
  id: string;
  leadId: string | null;
  tipo: TipoActividad;
  detalle: string;
  autor: "agente" | "humano";
  ocurridaEn: string;
}

/** Documento que la banca chilena pide para evaluar un crédito hipotecario. */
export type DocumentoId =
  | "cedula_identidad"
  | "liquidaciones_sueldo"
  | "certificado_afp"
  | "certificado_antiguedad"
  | "carpeta_tributaria"
  | "cartola_ahorro"
  | "certificado_matrimonio";

export interface DocumentoSolicitado {
  documento: DocumentoId;
  recibidoEn: string | null;
  /**
   * Solo metadatos. El archivo queda en el proveedor de correo y se descarga
   * bajo demanda: no se copia a la base ni al CRM.
   */
  archivo: {
    nombre: string;
    mime: string;
    idCorreo: string;
    idAdjunto: string;
  } | null;
}

export interface SolicitudDocumentos {
  id: string;
  leadId: string;
  /** Token del alias de respuesta, para calzar el correo entrante. */
  token: string;
  solicitadaEn: string;
  documentos: DocumentoSolicitado[];
  estado: "pendiente" | "parcial" | "completa";
  recordatorios: number;
  /** Fecha en que corresponde eliminar los archivos, según el plazo informado. */
  eliminarDespuesDe: string;
}
