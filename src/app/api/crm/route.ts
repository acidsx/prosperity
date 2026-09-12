/**
 * Reintento de las sincronizaciones que quedaron pendientes por falta de
 * cupo. Pensado para un cron cada hora, que es el ritmo al que se libera la
 * ventana de JetBrokers.
 */

import { NextResponse } from "next/server";

import { reintentarPendientes } from "@/lib/jetbrokers/sincronizacion";

export const runtime = "nodejs";

export async function POST(peticion: Request) {
  const esperado = process.env.INGESTA_TOKEN;
  if (esperado && peticion.headers.get("x-ingesta-token") !== esperado) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  const resultado = await reintentarPendientes();
  return NextResponse.json(resultado);
}
