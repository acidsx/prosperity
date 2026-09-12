"use server";

import { revalidatePath } from "next/cache";

import { exigirUsuario } from "@/lib/auth/acceso";
import { simularVenta, type ResultadoSimulacion } from "@/lib/simulacion/venta";

const CLAVE = Symbol.for("prosperity.ultimaSimulacion");

function almacen(): Record<symbol, ResultadoSimulacion | undefined> {
  return globalThis as unknown as Record<symbol, ResultadoSimulacion | undefined>;
}

export async function ultimaSimulacion(): Promise<ResultadoSimulacion | null> {
  return almacen()[CLAVE] ?? null;
}

export async function correrSimulacion(): Promise<void> {
  const usuario = await exigirUsuario("/simulacion");

  // Queda a nombre de quien la corre, para que aparezca en su cartera.
  almacen()[CLAVE] = await simularVenta({ ejecutivoId: usuario.id });

  for (const ruta of ["/simulacion", "/", "/leads", "/negocios", "/control", "/agenda"]) {
    revalidatePath(ruta);
  }
}
