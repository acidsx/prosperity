"use server";

import { revalidatePath } from "next/cache";

import { exigirUsuario } from "@/lib/auth/acceso";
import { simularCompradorIndeciso, type ResultadoIndeciso } from "@/lib/simulacion/indeciso";
import { simularVenta, type ResultadoSimulacion } from "@/lib/simulacion/venta";

const CLAVE = Symbol.for("prosperity.ultimaSimulacion");
const CLAVE_INDECISO = Symbol.for("prosperity.ultimoIndeciso");

function almacen(): Record<symbol, unknown> {
  return globalThis as unknown as Record<symbol, unknown>;
}

export async function ultimaSimulacion(): Promise<ResultadoSimulacion | null> {
  return (almacen()[CLAVE] as ResultadoSimulacion | undefined) ?? null;
}

export async function ultimoIndeciso(): Promise<ResultadoIndeciso | null> {
  return (almacen()[CLAVE_INDECISO] as ResultadoIndeciso | undefined) ?? null;
}

function revalidar(): void {
  for (const ruta of ["/simulacion", "/", "/leads", "/negocios", "/control", "/agenda"]) {
    revalidatePath(ruta);
  }
}

export async function correrSimulacion(): Promise<void> {
  const usuario = await exigirUsuario("/simulacion");

  // Queda a nombre de quien la corre, para que aparezca en su cartera.
  almacen()[CLAVE] = await simularVenta({ ejecutivoId: usuario.id });
  revalidar();
}

export async function correrIndeciso(): Promise<void> {
  const usuario = await exigirUsuario("/simulacion");

  almacen()[CLAVE_INDECISO] = await simularCompradorIndeciso({ ejecutivoId: usuario.id });
  revalidar();
}
