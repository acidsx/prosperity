/**
 * Webhook de WhatsApp.
 *
 * GET  responde el desafío de verificación que hace Meta al guardar la URL.
 * POST recibe mensajes y cambios de estado.
 *
 * La firma se calcula sobre el cuerpo crudo: hay que leerlo como texto antes
 * de parsear el JSON, o la verificación falla siempre.
 */

import { NextResponse } from "next/server";

import { procesarEntrante } from "@/lib/agente/conversacion";
import { registrarEstadoEntrega } from "@/lib/mensajeria/despachador";
import { leerWebhookWhatsApp, whatsAppDesdeEntorno } from "@/lib/mensajeria/whatsapp";

export const runtime = "nodejs";

export async function GET(peticion: Request) {
  const cliente = whatsAppDesdeEntorno();
  if (!cliente) {
    return NextResponse.json({ error: "WhatsApp no está configurado" }, { status: 503 });
  }
  const challenge = cliente.verificarSuscripcion(new URL(peticion.url).searchParams);
  if (challenge === null) {
    return NextResponse.json({ error: "Token de verificación inválido" }, { status: 403 });
  }
  // Meta espera el challenge en texto plano, no en JSON.
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(peticion: Request) {
  const cliente = whatsAppDesdeEntorno();
  if (!cliente) {
    return NextResponse.json({ error: "WhatsApp no está configurado" }, { status: 503 });
  }

  const crudo = await peticion.text();
  if (!cliente.firmaValida(crudo, peticion.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    return NextResponse.json({ error: "Cuerpo no es JSON" }, { status: 400 });
  }

  const { mensajes, estados } = leerWebhookWhatsApp(cuerpo);
  const resultados = [];

  for (const estado of estados) {
    await registrarEstadoEntrega(estado);
  }

  for (const entrante of mensajes) {
    try {
      resultados.push(await procesarEntrante(entrante));
    } catch (error) {
      // Se responde 200 igual: si devolvemos error, Meta reintenta el lote
      // completo y los mensajes ya procesados se duplicarían.
      resultados.push({
        leadId: null,
        intencion: "otro",
        accion: `error: ${error instanceof Error ? error.message : String(error)}`,
        respondio: false,
        avisos: [],
      });
    }
  }

  return NextResponse.json({ mensajes: resultados.length, estados: estados.length, resultados });
}
