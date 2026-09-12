/**
 * Sesión en cookie firmada.
 *
 * La cookie lleva el id del usuario, su rol y la expiración, firmados con
 * HMAC-SHA256. No lleva datos personales y no sirve si se altera.
 */

import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import type { Rol } from "@/lib/auth/tipos";

export const COOKIE_SESION = "gestor_sesion";
const DURACION_HORAS = 12;

export interface Sesion {
  uid: string;
  rol: Rol;
  /** Epoch en segundos. */
  exp: number;
}

function secreto(): string {
  const valor = process.env.AUTH_SECRET;
  if (valor && valor.length >= 32) return valor;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Falta AUTH_SECRET (mínimo 32 caracteres). Sin él las sesiones se podrían falsificar.",
    );
  }
  // Solo para desarrollo: en producción la línea de arriba corta la ejecución.
  return "secreto-de-desarrollo-no-usar-en-produccion";
}

function firmar(carga: string): string {
  return createHmac("sha256", secreto()).update(carga).digest("base64url");
}

export function crearToken(uid: string, rol: Rol): string {
  const sesion: Sesion = {
    uid,
    rol,
    exp: Math.floor(Date.now() / 1000) + DURACION_HORAS * 3600,
  };
  const carga = Buffer.from(JSON.stringify(sesion)).toString("base64url");
  return `${carga}.${firmar(carga)}`;
}

export function leerToken(token: string | undefined): Sesion | null {
  if (!token) return null;
  const [carga, firma] = token.split(".");
  if (!carga || !firma) return null;

  const esperada = Buffer.from(firmar(carga));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;

  try {
    const sesion = JSON.parse(Buffer.from(carga, "base64url").toString("utf8")) as Sesion;
    if (typeof sesion.exp !== "number" || sesion.exp * 1000 < Date.now()) return null;
    return sesion;
  } catch {
    return null;
  }
}

export async function abrirSesion(uid: string, rol: Rol): Promise<void> {
  const almacen = await cookies();
  almacen.set(COOKIE_SESION, crearToken(uid, rol), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DURACION_HORAS * 3600,
  });
}

export async function cerrarSesion(): Promise<void> {
  const almacen = await cookies();
  almacen.delete(COOKIE_SESION);
}

export async function sesionActual(): Promise<Sesion | null> {
  const almacen = await cookies();
  return leerToken(almacen.get(COOKIE_SESION)?.value);
}
