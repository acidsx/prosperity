/** Ejecuta el agente sobre los leads pendientes. Útil para un cron. */

import { NextResponse } from "next/server";

import { gestionarPendientes } from "@/lib/agente/gestor";

export const runtime = "nodejs";

export async function POST(peticion: Request) {
  const esperado = process.env.INGESTA_TOKEN;
  if (esperado && peticion.headers.get("x-ingesta-token") !== esperado) {
    return NextResponse.json({ error: "Token de ingesta inválido" }, { status: 401 });
  }

  const resultados = await gestionarPendientes();
  return NextResponse.json({
    procesados: resultados.length,
    leads: resultados.map((resultado) => ({
      leadId: resultado.leadId,
      estado: resultado.oportunidad.estado,
      puntaje: resultado.calificacion.puntaje,
      motor: resultado.calificacion.motor,
      avisos: resultado.avisos,
    })),
  });
}
