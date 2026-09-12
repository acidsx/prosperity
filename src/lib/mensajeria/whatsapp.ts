/**
 * WhatsApp a través de la Cloud API de Meta.
 *
 * Dos reglas de la plataforma mandan sobre el diseño:
 *  - Fuera de las 24 horas desde el último mensaje del comprador, solo se
 *    pueden enviar plantillas aprobadas.
 *  - El webhook se verifica con HMAC-SHA256 sobre el cuerpo crudo; si se
 *    parsea el JSON antes de verificar, la firma ya no calza.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { normalizarTelefono } from "@/lib/dominio/chile";
import { plantilla, renderizar } from "@/lib/mensajeria/plantillas";
import type {
  Destinatario,
  Entrante,
  ProveedorMensajeria,
  ResultadoEnvio,
  Salida,
} from "@/lib/mensajeria/tipos";

export const VERSION_POR_DEFECTO = "v23.0";
export const BASE_POR_DEFECTO = "https://graph.facebook.com";

export interface ConfigWhatsApp {
  /** Token de acceso permanente del System User. */
  token: string;
  /** ID del número (no el número). Lo entrega el WhatsApp Manager. */
  phoneNumberId: string;
  /** App secret, para verificar la firma del webhook. */
  appSecret?: string;
  /** Token que se compara en el desafío GET del webhook. */
  verifyToken?: string;
  baseUrl?: string;
  version?: string;
  /** Sin esto, los envíos se simulan y no salen a la red. */
  permitirEnvio?: boolean;
  fetchImpl?: typeof fetch;
}

export class ErrorWhatsApp extends Error {
  constructor(
    mensaje: string,
    readonly estado: number | null,
    readonly codigo?: number,
  ) {
    super(mensaje);
    this.name = "ErrorWhatsApp";
  }
}

interface RespuestaEnvio {
  messages?: Array<{ id: string }>;
  error?: { message: string; code: number; error_subcode?: number };
}

export class WhatsApp implements ProveedorMensajeria {
  readonly canal = "whatsapp" as const;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ConfigWhatsApp) {
    if (!config.token || !config.phoneNumberId) {
      throw new Error("WhatsApp necesita token y phoneNumberId");
    }
    this.base = `${(config.baseUrl ?? BASE_POR_DEFECTO).replace(/\/$/, "")}/${
      config.version ?? VERSION_POR_DEFECTO
    }`;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  get simulado(): boolean {
    return this.config.permitirEnvio !== true;
  }

  async enviar(destinatario: Destinatario, salida: Salida): Promise<ResultadoEnvio> {
    if (salida.tipo === "correo") {
      throw new Error("WhatsApp no envía correos");
    }

    const telefono = normalizarTelefono(destinatario.telefono);
    if (!telefono) {
      return {
        enviado: false,
        idProveedor: null,
        simulado: this.simulado,
        motivo: "El lead no tiene un teléfono utilizable",
      };
    }

    const cuerpo =
      salida.tipo === "texto"
        ? {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: telefono,
            type: "text",
            text: { preview_url: false, body: salida.cuerpo },
          }
        : this.cuerpoPlantilla(telefono, salida.plantilla, salida.variables);

    if (this.simulado) {
      return {
        enviado: false,
        idProveedor: null,
        simulado: true,
        motivo: "Simulación: WHATSAPP_ENVIO no está habilitado",
      };
    }

    const respuesta = await this.pedir(`/${this.config.phoneNumberId}/messages`, cuerpo);
    const id = respuesta.messages?.[0]?.id ?? null;
    return { enviado: true, idProveedor: id, simulado: false };
  }

  private cuerpoPlantilla(telefono: string, nombre: string, variables: string[]) {
    const definicion = plantilla(nombre);
    if (!definicion) {
      throw new Error(`La plantilla "${nombre}" no está en el catálogo`);
    }
    if (variables.length !== definicion.variables.length) {
      throw new Error(
        `La plantilla "${nombre}" espera ${definicion.variables.length} variables y recibió ${variables.length}`,
      );
    }
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: telefono,
      type: "template",
      template: {
        name: nombre,
        language: { code: definicion.idioma },
        // Los botones de respuesta rápida se definen al crear la plantilla:
        // acá solo van los parámetros del cuerpo.
        components:
          variables.length > 0
            ? [
                {
                  type: "body",
                  parameters: variables.map((valor) => ({ type: "text", text: valor })),
                },
              ]
            : [],
      },
    };
  }

  /** Marca el mensaje como leído: el doble check azul del comprador. */
  async marcarLeido(idMensaje: string): Promise<void> {
    if (this.simulado) return;
    await this.pedir(`/${this.config.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: idMensaje,
    });
  }

  private async pedir(ruta: string, cuerpo: unknown): Promise<RespuestaEnvio> {
    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(`${this.base}${ruta}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      throw new ErrorWhatsApp(
        `No se pudo conectar con la Cloud API: ${error instanceof Error ? error.message : String(error)}`,
        null,
      );
    }

    const datos = (await respuesta.json().catch(() => ({}))) as RespuestaEnvio;
    if (!respuesta.ok || datos.error) {
      throw new ErrorWhatsApp(
        datos.error?.message ?? `La Cloud API respondió ${respuesta.status}`,
        respuesta.status,
        datos.error?.code,
      );
    }
    return datos;
  }

  /**
   * Desafío de verificación del webhook. Meta hace un GET con estos
   * parámetros al guardar la URL y espera el challenge de vuelta en texto.
   */
  verificarSuscripcion(parametros: URLSearchParams): string | null {
    const modo = parametros.get("hub.mode");
    const token = parametros.get("hub.verify_token");
    const challenge = parametros.get("hub.challenge");
    if (modo === "subscribe" && token && token === this.config.verifyToken) {
      return challenge;
    }
    return null;
  }

  /**
   * Verifica X-Hub-Signature-256 sobre el cuerpo crudo.
   * Sin app secret configurado devuelve false: preferimos rechazar antes que
   * aceptar webhooks sin verificar.
   */
  firmaValida(cuerpoCrudo: string, cabecera: string | null): boolean {
    if (!this.config.appSecret || !cabecera) return false;
    const esperado = createHmac("sha256", this.config.appSecret)
      .update(cuerpoCrudo, "utf8")
      .digest("hex");
    const recibido = cabecera.replace(/^sha256=/, "");
    const a = Buffer.from(esperado, "hex");
    const b = Buffer.from(recibido, "hex");
    if (a.length !== b.length || a.length === 0) return false;
    return timingSafeEqual(a, b);
  }
}

/** Forma del webhook de WhatsApp, reducida a lo que se usa. */
interface WebhookWhatsApp {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<{
          id?: string;
          from?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          button?: { text?: string; payload?: string };
          interactive?: {
            type?: string;
            button_reply?: { id?: string; title?: string };
            list_reply?: { id?: string; title?: string };
          };
          image?: { id?: string; mime_type?: string; caption?: string };
          document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
          audio?: { id?: string; mime_type?: string };
        }>;
        statuses?: Array<{
          id?: string;
          status?: string;
          timestamp?: string;
          recipient_id?: string;
          errors?: Array<{ code?: number; title?: string }>;
        }>;
      };
    }>;
  }>;
}

export interface EstadoEntrega {
  idProveedor: string;
  estado: "enviado" | "entregado" | "leido" | "fallido";
  ocurridoEn: string;
  detalle: string | null;
}

export interface LecturaWebhook {
  mensajes: Entrante[];
  estados: EstadoEntrega[];
}

const MAPA_ESTADOS: Record<string, EstadoEntrega["estado"]> = {
  sent: "enviado",
  delivered: "entregado",
  read: "leido",
  failed: "fallido",
};

/**
 * Normaliza el webhook. Un solo POST puede traer varios mensajes y varios
 * cambios de estado, de leads distintos.
 */
export function leerWebhookWhatsApp(cuerpo: unknown): LecturaWebhook {
  const datos = cuerpo as WebhookWhatsApp;
  const mensajes: Entrante[] = [];
  const estados: EstadoEntrega[] = [];

  for (const entrada of datos.entry ?? []) {
    for (const cambio of entrada.changes ?? []) {
      const valor = cambio.value;
      if (!valor) continue;

      const nombrePorTelefono = new Map<string, string>();
      for (const contacto of valor.contacts ?? []) {
        if (contacto.wa_id && contacto.profile?.name) {
          nombrePorTelefono.set(contacto.wa_id, contacto.profile.name);
        }
      }

      for (const mensaje of valor.messages ?? []) {
        if (!mensaje.id || !mensaje.from) continue;

        // El texto puede venir como mensaje suelto, como respuesta a un botón
        // de plantilla, o como pie de foto de un adjunto.
        const texto =
          mensaje.text?.body ??
          mensaje.button?.text ??
          mensaje.interactive?.button_reply?.title ??
          mensaje.interactive?.list_reply?.title ??
          mensaje.image?.caption ??
          mensaje.document?.caption ??
          "";

        const adjuntos = [];
        if (mensaje.image?.id) {
          adjuntos.push({
            idAdjunto: mensaje.image.id,
            nombre: null,
            mime: mensaje.image.mime_type ?? "image/jpeg",
            tamano: null,
          });
        }
        if (mensaje.document?.id) {
          adjuntos.push({
            idAdjunto: mensaje.document.id,
            nombre: mensaje.document.filename ?? null,
            mime: mensaje.document.mime_type ?? "application/octet-stream",
            tamano: null,
          });
        }

        mensajes.push({
          canal: "whatsapp",
          idProveedor: mensaje.id,
          de: mensaje.from,
          nombreRemitente: nombrePorTelefono.get(mensaje.from) ?? null,
          recibidoEn: mensaje.timestamp
            ? new Date(Number(mensaje.timestamp) * 1000).toISOString()
            : new Date().toISOString(),
          texto,
          asunto: null,
          // El identificador del botón es más confiable que su texto para
          // decidir la acción.
          token: mensaje.button?.payload ?? mensaje.interactive?.button_reply?.id ?? null,
          adjuntos,
        });
      }

      for (const estado of valor.statuses ?? []) {
        if (!estado.id || !estado.status) continue;
        const normalizado = MAPA_ESTADOS[estado.status];
        if (!normalizado) continue;
        estados.push({
          idProveedor: estado.id,
          estado: normalizado,
          ocurridoEn: estado.timestamp
            ? new Date(Number(estado.timestamp) * 1000).toISOString()
            : new Date().toISOString(),
          detalle: estado.errors?.[0]?.title ?? null,
        });
      }
    }
  }

  return { mensajes, estados };
}

export function whatsAppDesdeEntorno(): WhatsApp | null {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return null;
  return new WhatsApp({
    token,
    phoneNumberId,
    appSecret: process.env.WHATSAPP_APP_SECRET,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    baseUrl: process.env.WHATSAPP_BASE_URL,
    version: process.env.WHATSAPP_VERSION,
    permitirEnvio: process.env.WHATSAPP_ENVIO === "true",
  });
}

/** Renderiza una plantilla para dejarla legible en la conversación del CRM. */
export function vistaPreviaPlantilla(nombre: string, variables: string[]): string {
  const definicion = plantilla(nombre);
  return definicion ? renderizar(definicion, variables) : `[plantilla ${nombre}]`;
}
