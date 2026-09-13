/**
 * Carga del registro de incentivos.
 *
 * Vive en `datos/incentivos.json` y no en el código a propósito: lo actualiza
 * quien revisa las fuentes, sin tocar TypeScript ni desplegar. Se lee una vez
 * por proceso; para recargar tras editarlo, `recargarIncentivos()`.
 */

import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Incentivo } from "@/lib/dominio/incentivos";

const CLAVE = Symbol.for("prosperity.incentivos");

function leerDelDisco(): Incentivo[] {
  const ruta = process.env.INCENTIVOS_RUTA ?? join(process.cwd(), "datos", "incentivos.json");
  try {
    const crudo = JSON.parse(readFileSync(ruta, "utf8")) as { incentivos?: Incentivo[] };
    return crudo.incentivos ?? [];
  } catch {
    // Sin registro el agente no ofrece beneficios, que es el estado seguro.
    return [];
  }
}

export function incentivos(): Incentivo[] {
  const almacen = globalThis as unknown as Record<symbol, Incentivo[] | undefined>;
  if (!almacen[CLAVE]) almacen[CLAVE] = leerDelDisco();
  return almacen[CLAVE]!;
}

export function recargarIncentivos(): Incentivo[] {
  const almacen = globalThis as unknown as Record<symbol, Incentivo[] | undefined>;
  almacen[CLAVE] = leerDelDisco();
  return almacen[CLAVE]!;
}
