/** Contratos de la capa de mensajería, común a WhatsApp y correo. */

export type CanalEnvio = "whatsapp" | "email";

export interface Destinatario {
  leadId: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
}

/** Texto libre. En WhatsApp solo se permite dentro de la ventana de 24 h. */
export interface SalidaTexto {
  tipo: "texto";
  cuerpo: string;
}

/** Plantilla aprobada por Meta. Es la única vía fuera de la ventana de 24 h. */
export interface SalidaPlantilla {
  tipo: "plantilla";
  plantilla: string;
  /** Valores de {{1}}, {{2}}, … en orden. */
  variables: string[];
  /** Texto equivalente, para dejarlo legible en la conversación del CRM. */
  vistaPrevia: string;
}

export interface AdjuntoSalida {
  nombre: string;
  contenido: string | Buffer;
  mime?: string;
}

export interface SalidaCorreo {
  tipo: "correo";
  asunto: string;
  html: string;
  texto: string;
  adjuntos?: AdjuntoSalida[];
  /** Dirección de respuesta; se usa el alias con token para calzar la vuelta. */
  responderA?: string;
}

export type Salida = SalidaTexto | SalidaPlantilla | SalidaCorreo;

export interface ResultadoEnvio {
  enviado: boolean;
  /** ID del mensaje en el proveedor, cuando se envió de verdad. */
  idProveedor: string | null;
  /** true cuando corrió contra el simulador o sin credenciales. */
  simulado: boolean;
  motivo?: string;
}

export interface AdjuntoEntrante {
  idAdjunto: string;
  nombre: string | null;
  mime: string;
  /** Tamaño en bytes, si el proveedor lo informa. */
  tamano: number | null;
}

/** Mensaje entrante ya normalizado, sin importar el proveedor. */
export interface Entrante {
  canal: CanalEnvio;
  /** ID del proveedor: sirve para descartar reintentos del webhook. */
  idProveedor: string;
  /** Teléfono en E.164 sin +, o dirección de correo. */
  de: string;
  nombreRemitente: string | null;
  recibidoEn: string;
  texto: string;
  asunto: string | null;
  /** Token del alias de respuesta, si venía en el destinatario. */
  token: string | null;
  adjuntos: AdjuntoEntrante[];
}

export interface ProveedorMensajeria {
  readonly canal: CanalEnvio;
  readonly simulado: boolean;
  enviar(destinatario: Destinatario, salida: Salida): Promise<ResultadoEnvio>;
}
