/**
 * Claves de acceso con scrypt.
 *
 * scrypt está en la librería estándar de Node y es resistente a hardware
 * dedicado, que es lo que se pide para almacenar claves.
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derivar = promisify(scrypt) as (
  clave: string,
  sal: string,
  largo: number,
) => Promise<Buffer>;

const LARGO_HASH = 64;

export async function hashDeClave(clave: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("hex");
  const derivada = await derivar(clave.normalize("NFKC"), salt, LARGO_HASH);
  return { hash: derivada.toString("hex"), salt };
}

export async function claveCorrecta(
  clave: string,
  hash: string,
  salt: string,
): Promise<boolean> {
  const derivada = await derivar(clave.normalize("NFKC"), salt, LARGO_HASH);
  const esperado = Buffer.from(hash, "hex");
  if (esperado.length !== derivada.length) return false;
  return timingSafeEqual(esperado, derivada);
}

/** Reglas mínimas para una clave de un sistema con datos de terceros. */
export function problemaDeClave(clave: string): string | null {
  if (clave.length < 10) return "La clave debe tener al menos 10 caracteres";
  if (!/[a-z]/i.test(clave)) return "La clave debe tener al menos una letra";
  if (!/\d/.test(clave)) return "La clave debe tener al menos un número";
  return null;
}
