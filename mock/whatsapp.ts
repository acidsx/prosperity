/**
 * Simulador de la Cloud API de WhatsApp.
 *
 * Replica lo que se usa del contrato de Meta: el endpoint de envío, el
 * desafío de verificación y la forma del webhook. Permite probar el agente
 * conversacional completo sin tener todavía una cuenta de WhatsApp Business.
 */

import { createHmac, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface EnvioRegistrado {
  to: string;
  type: string;
  texto: string | null;
  plantilla: string | null;
  variables: string[];
  recibidoEn: string;
}

export const enviados: EnvioRegistrado[] = [];

interface CuerpoEnvio {
  messaging_product?: string;
  to?: string;
  type?: string;
  status?: string;
  text?: { body?: string };
  template?: {
    name?: string;
    components?: Array<{ type?: string; parameters?: Array<{ text?: string }> }>;
  };
}

async function leerCuerpo(peticion: IncomingMessage): Promise<CuerpoEnvio> {
  const trozos: Buffer[] = [];
  for await (const trozo of peticion) trozos.push(trozo as Buffer);
  if (trozos.length === 0) return {};
  return JSON.parse(Buffer.concat(trozos).toString("utf8"));
}

function json(respuesta: ServerResponse, estado: number, cuerpo: unknown) {
  respuesta.writeHead(estado, { "Content-Type": "application/json" });
  respuesta.end(JSON.stringify(cuerpo));
}

export function crearMockWhatsApp(puerto = 4030, phoneNumberId = "111222333444555") {
  const servidor = createServer(async (peticion, respuesta) => {
    const url = new URL(peticion.url ?? "/", `http://localhost:${puerto}`);
    const partes = url.pathname.split("/").filter(Boolean);

    // POST /{version}/{phoneNumberId}/messages
    if (peticion.method === "POST" && partes[2] === "messages") {
      if (partes[1] !== phoneNumberId) {
        return json(respuesta, 404, {
          error: { message: "Unknown phone number id", code: 100 },
        });
      }
      if (!peticion.headers.authorization?.startsWith("Bearer ")) {
        return json(respuesta, 401, {
          error: { message: "Missing access token", code: 190 },
        });
      }

      const cuerpo = await leerCuerpo(peticion);

      // Marcar como leído no devuelve id de mensaje.
      if (cuerpo.status === "read") return json(respuesta, 200, { success: true });

      if (cuerpo.messaging_product !== "whatsapp" || !cuerpo.to) {
        return json(respuesta, 400, {
          error: { message: "Invalid parameter", code: 100 },
        });
      }

      const variables =
        cuerpo.template?.components
          ?.find((componente) => componente.type === "body")
          ?.parameters?.map((parametro) => parametro.text ?? "") ?? [];

      enviados.push({
        to: cuerpo.to,
        type: cuerpo.type ?? "text",
        texto: cuerpo.text?.body ?? null,
        plantilla: cuerpo.template?.name ?? null,
        variables,
        recibidoEn: new Date().toISOString(),
      });

      return json(respuesta, 200, {
        messaging_product: "whatsapp",
        contacts: [{ input: cuerpo.to, wa_id: cuerpo.to }],
        messages: [{ id: `wamid.${randomUUID()}` }],
      });
    }

    // Auxiliar del simulador (no existe en la API real): permite revisar
    // desde fuera del proceso qué mensajes salieron.
    if (peticion.method === "GET" && url.pathname === "/__enviados") {
      return json(respuesta, 200, enviados);
    }

    json(respuesta, 404, { error: { message: "Unknown path", code: 100 } });
  });

  return {
    servidor,
    url: `http://localhost:${puerto}`,
    phoneNumberId,
    escuchar: () =>
      new Promise<void>((resolver) => servidor.listen(puerto, "127.0.0.1", () => resolver())),
    cerrar: () => new Promise<void>((resolver) => servidor.close(() => resolver())),
    limpiar: () => {
      enviados.length = 0;
    },
  };
}

/** Webhook de mensaje entrante, con la forma exacta que manda Meta. */
export function webhookMensaje(opciones: {
  de: string;
  texto?: string;
  nombre?: string;
  /** Identificador del botón, cuando responde a una plantilla. */
  boton?: { id: string; texto: string };
  documento?: { id: string; nombre: string; mime: string };
  phoneNumberId?: string;
  idMensaje?: string;
}): unknown {
  const mensaje: Record<string, unknown> = {
    id: opciones.idMensaje ?? `wamid.${randomUUID()}`,
    from: opciones.de,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };

  if (opciones.boton) {
    mensaje.type = "interactive";
    mensaje.interactive = {
      type: "button_reply",
      button_reply: { id: opciones.boton.id, title: opciones.boton.texto },
    };
  } else if (opciones.documento) {
    mensaje.type = "document";
    mensaje.document = {
      id: opciones.documento.id,
      filename: opciones.documento.nombre,
      mime_type: opciones.documento.mime,
      caption: opciones.texto,
    };
  } else {
    mensaje.type = "text";
    mensaje.text = { body: opciones.texto ?? "" };
  }

  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "56912340000",
                phone_number_id: opciones.phoneNumberId ?? "111222333444555",
              },
              contacts: opciones.nombre
                ? [{ wa_id: opciones.de, profile: { name: opciones.nombre } }]
                : [],
              messages: [mensaje],
            },
          },
        ],
      },
    ],
  };
}

/** Webhook de cambio de estado de entrega. */
export function webhookEstado(opciones: {
  idMensaje: string;
  estado: "sent" | "delivered" | "read" | "failed";
  destinatario: string;
}): unknown {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "111222333444555" },
              statuses: [
                {
                  id: opciones.idMensaje,
                  status: opciones.estado,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: opciones.destinatario,
                  ...(opciones.estado === "failed"
                    ? { errors: [{ code: 131047, title: "Re-engagement message" }] }
                    : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** Firma que Meta pone en X-Hub-Signature-256. */
export function firmar(cuerpo: string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(cuerpo, "utf8").digest("hex")}`;
}

if (process.argv[1]?.endsWith("whatsapp.ts")) {
  const mock = crearMockWhatsApp(Number(process.env.PUERTO_WHATSAPP ?? 4030));
  mock.escuchar().then(() => console.log(`Mock de WhatsApp Cloud API en ${mock.url}`));
}
