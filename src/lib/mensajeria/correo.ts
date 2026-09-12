/**
 * Correo con Resend: envío, y recepción de respuestas con adjuntos.
 *
 * El webhook `email.received` trae solo los metadatos; el cuerpo y los
 * adjuntos se piden después con el `email_id`. Los archivos se quedan en
 * Resend: acá se guardan referencias, no contenido.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { Resend } from "resend";

import { correoDesdeEncabezado, tokenDeAlias } from "@/lib/dominio/chile";
import type {
  Destinatario,
  Entrante,
  ProveedorMensajeria,
  ResultadoEnvio,
  Salida,
} from "@/lib/mensajeria/tipos";

export interface ConfigCorreo {
  apiKey: string;
  /** Remitente con nombre: "Prosperity Latam <hola@corredora.cl>". */
  remitente: string;
  /** Dominio del alias de respuesta, para calzar las vueltas por token. */
  dominioRespuesta?: string;
  /** Casilla base del alias: "documentos" -> documentos+token@dominio. */
  buzonRespuesta?: string;
  /** Secreto de firma del webhook (empieza con whsec_). */
  secretoWebhook?: string;
  permitirEnvio?: boolean;
}

export class ErrorCorreo extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorCorreo";
  }
}

export class Correo implements ProveedorMensajeria {
  readonly canal = "email" as const;
  private readonly cliente: Resend;

  constructor(private readonly config: ConfigCorreo) {
    if (!config.apiKey) throw new Error("Resend necesita una API key");
    if (!config.remitente) throw new Error("Falta el remitente del correo");
    this.cliente = new Resend(config.apiKey);
  }

  get simulado(): boolean {
    return this.config.permitirEnvio !== true;
  }

  /** Alias con subdirección: permite calzar la respuesta aunque cambie de casilla. */
  aliasRespuesta(token: string): string | undefined {
    const dominio = this.config.dominioRespuesta;
    if (!dominio) return undefined;
    const buzon = this.config.buzonRespuesta ?? "documentos";
    return `${buzon}+${token}@${dominio}`;
  }

  async enviar(destinatario: Destinatario, salida: Salida): Promise<ResultadoEnvio> {
    if (salida.tipo !== "correo") {
      throw new Error("El proveedor de correo solo envía salidas de tipo correo");
    }
    if (!destinatario.email) {
      return {
        enviado: false,
        idProveedor: null,
        simulado: this.simulado,
        motivo: "El lead no tiene correo",
      };
    }

    if (this.simulado) {
      return {
        enviado: false,
        idProveedor: null,
        simulado: true,
        motivo: "Simulación: CORREO_ENVIO no está habilitado",
      };
    }

    const { data, error } = await this.cliente.emails.send({
      from: this.config.remitente,
      to: destinatario.email,
      subject: salida.asunto,
      html: salida.html,
      text: salida.texto,
      replyTo: salida.responderA,
      attachments: salida.adjuntos?.map((adjunto) => ({
        filename: adjunto.nombre,
        content: adjunto.contenido,
        contentType: adjunto.mime,
      })),
    });

    if (error) throw new ErrorCorreo(`Resend rechazó el envío: ${error.message}`);
    return { enviado: true, idProveedor: data?.id ?? null, simulado: false };
  }

  /**
   * Completa un `email.received` con el cuerpo y los adjuntos, que el
   * webhook no trae.
   */
  async detalleEntrante(emailId: string): Promise<Entrante> {
    const { data, error } = await this.cliente.emails.receiving.get(emailId);
    if (error || !data) {
      throw new ErrorCorreo(`No se pudo leer el correo ${emailId}: ${error?.message ?? "sin datos"}`);
    }

    const de = correoDesdeEncabezado(data.from) ?? data.from;
    const destinos = [...(data.to ?? []), ...(data.received_for ?? [])];
    const token = destinos.map((destino) => tokenDeAlias(destino)).find((valor) => valor) ?? null;

    return {
      canal: "email",
      idProveedor: data.id,
      de,
      nombreRemitente: nombreDesdeEncabezado(data.from),
      recibidoEn: data.created_at,
      texto: data.text ?? textoDesdeHtml(data.html ?? ""),
      asunto: data.subject,
      token,
      adjuntos: (data.attachments ?? []).map((adjunto) => ({
        idAdjunto: adjunto.id,
        nombre: adjunto.filename,
        mime: adjunto.content_type,
        tamano: adjunto.size,
      })),
    };
  }

  /**
   * URL firmada para descargar un adjunto. Expira, así que se pide en el
   * momento en que el ejecutivo la va a usar y no se guarda.
   */
  async urlAdjunto(emailId: string, idAdjunto: string): Promise<{ url: string; expiraEn: string }> {
    const { data, error } = await this.cliente.emails.receiving.attachments.get({
      emailId,
      id: idAdjunto,
    });
    if (error || !data) {
      throw new ErrorCorreo(`No se pudo obtener el adjunto ${idAdjunto}: ${error?.message ?? "sin datos"}`);
    }
    return { url: data.download_url, expiraEn: data.expires_at };
  }

  /**
   * Verifica la firma del webhook (esquema Svix, que es el que usa Resend):
   * HMAC-SHA256 sobre "id.timestamp.cuerpo" con el secreto en base64.
   */
  firmaValida(
    cuerpoCrudo: string,
    cabeceras: { id: string | null; timestamp: string | null; firma: string | null },
    toleranciaSegundos = 300,
  ): boolean {
    const secreto = this.config.secretoWebhook;
    if (!secreto || !cabeceras.id || !cabeceras.timestamp || !cabeceras.firma) return false;

    // Rechaza reenvíos viejos.
    const enviadoEn = Number(cabeceras.timestamp);
    if (!Number.isFinite(enviadoEn)) return false;
    const desfase = Math.abs(Date.now() / 1000 - enviadoEn);
    if (desfase > toleranciaSegundos) return false;

    const clave = Buffer.from(secreto.replace(/^whsec_/, ""), "base64");
    const esperado = createHmac("sha256", clave)
      .update(`${cabeceras.id}.${cabeceras.timestamp}.${cuerpoCrudo}`)
      .digest("base64");

    // La cabecera puede traer varias firmas separadas por espacio.
    for (const parte of cabeceras.firma.split(" ")) {
      const valor = parte.includes(",") ? parte.split(",")[1] : parte;
      const a = Buffer.from(esperado, "base64");
      const b = Buffer.from(valor, "base64");
      if (a.length === b.length && a.length > 0 && timingSafeEqual(a, b)) return true;
    }
    return false;
  }
}

function nombreDesdeEncabezado(encabezado: string): string | null {
  const coincidencia = encabezado.match(/^\s*"?([^"<]+?)"?\s*</);
  return coincidencia ? coincidencia[1].trim() : null;
}

/** Texto plano aproximado, para cuando el correo solo trae HTML. */
export function textoDesdeHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Eventos del webhook de Resend que interesan. */
export interface EventoCorreo {
  tipo: "recibido" | "entregado" | "rebotado" | "reclamado" | "fallido" | "otro";
  /** ID del correo en Resend. */
  emailId: string | null;
  ocurridoEn: string;
}

export function leerWebhookCorreo(cuerpo: unknown): EventoCorreo {
  const evento = cuerpo as {
    type?: string;
    created_at?: string;
    data?: { email_id?: string; id?: string };
  };
  const emailId = evento.data?.email_id ?? evento.data?.id ?? null;
  const ocurridoEn = evento.created_at ?? new Date().toISOString();

  const tipos: Record<string, EventoCorreo["tipo"]> = {
    "email.received": "recibido",
    "email.delivered": "entregado",
    "email.bounced": "rebotado",
    "email.complained": "reclamado",
    "email.failed": "fallido",
  };

  return { tipo: tipos[evento.type ?? ""] ?? "otro", emailId, ocurridoEn };
}

export function correoDesdeEntorno(): Correo | null {
  const apiKey = process.env.RESEND_API_KEY;
  const remitente = process.env.CORREO_REMITENTE;
  if (!apiKey || !remitente) return null;
  return new Correo({
    apiKey,
    remitente,
    dominioRespuesta: process.env.CORREO_DOMINIO_RESPUESTA,
    buzonRespuesta: process.env.CORREO_BUZON_RESPUESTA,
    secretoWebhook: process.env.RESEND_WEBHOOK_SECRET,
    permitirEnvio: process.env.CORREO_ENVIO === "true",
  });
}
