/**
 * Webhook de correo (Resend).
 *
 * El evento `email.received` trae solo metadatos: el cuerpo y los adjuntos se
 * piden después con el email_id.
 */

import { NextResponse } from "next/server";

import { procesarEntrante } from "@/lib/agente/conversacion";
import { correoDesdeEntorno, leerWebhookCorreo } from "@/lib/mensajeria/correo";

export const runtime = "nodejs";

export async function POST(peticion: Request) {
  const cliente = correoDesdeEntorno();
  if (!cliente) {
    return NextResponse.json({ error: "El correo no está configurado" }, { status: 503 });
  }

  const crudo = await peticion.text();
  const firmaOk = cliente.firmaValida(crudo, {
    id: peticion.headers.get("svix-id"),
    timestamp: peticion.headers.get("svix-timestamp"),
    firma: peticion.headers.get("svix-signature"),
  });
  if (!firmaOk) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    return NextResponse.json({ error: "Cuerpo no es JSON" }, { status: 400 });
  }

  const evento = leerWebhookCorreo(cuerpo);

  if (evento.tipo !== "recibido" || !evento.emailId) {
    // Entregas, rebotes y reclamos no se procesan como conversación.
    return NextResponse.json({ procesado: false, tipo: evento.tipo });
  }

  try {
    const entrante = await cliente.detalleEntrante(evento.emailId);
    const resultado = await procesarEntrante(entrante);
    return NextResponse.json({ procesado: true, resultado });
  } catch (error) {
    return NextResponse.json(
      { procesado: false, error: error instanceof Error ? error.message : String(error) },
      // 200 a propósito: un 5xx hace que Resend reintente y el mensaje se
      // procesaría dos veces.
      { status: 200 },
    );
  }
}
