"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";

import { claveCorrecta } from "@/lib/auth/clave";
import { abrirSesion, cerrarSesion } from "@/lib/auth/sesion";
import { tienda } from "@/lib/datos";

export interface EstadoIngreso {
  error: string | null;
}

export async function ingresar(
  _estado: EstadoIngreso,
  formData: FormData,
): Promise<EstadoIngreso> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const clave = String(formData.get("clave") ?? "");
  const volver = String(formData.get("volver") ?? "/");

  if (!email || !clave) return { error: "Escribe tu correo y tu clave" };

  const usuario = await tienda().usuarioPorEmail(email);

  // Mismo mensaje para usuario inexistente y clave incorrecta: no confirmamos
  // qué correos existen en el sistema.
  const generico = { error: "Correo o clave incorrectos" };

  if (!usuario || !usuario.activo) return generico;
  if (!(await claveCorrecta(clave, usuario.hash, usuario.salt))) return generico;

  await tienda().guardarUsuario({ ...usuario, ultimoIngresoEn: new Date().toISOString() });
  await abrirSesion(usuario.id, usuario.rol);

  // Solo rutas internas: un `volver` con dominio externo sería un redirect abierto.
  const destino = volver.startsWith("/") && !volver.startsWith("//") ? volver : "/";
  redirect(destino as Route);
}

export async function salir(): Promise<void> {
  await cerrarSesion();
  redirect("/entrar");
}
