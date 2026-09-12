/**
 * Quién está conectado y qué puede ver.
 *
 * El alcance de la cartera se resuelve acá y no en cada página: un ejecutivo
 * ve lo suyo, operaciones y la jefatura ven todo.
 */

import "server-only";

import { redirect } from "next/navigation";
import type { Route } from "next";

import { sesionActual } from "@/lib/auth/sesion";
import { puede, type Permiso, type Usuario } from "@/lib/auth/tipos";
import { tienda } from "@/lib/datos";
import type { Negocio } from "@/lib/dominio/cierre";
import type { Lead } from "@/lib/dominio/tipos";

export async function usuarioActual(): Promise<Usuario | null> {
  const sesion = await sesionActual();
  if (!sesion) return null;

  const usuario = await tienda().obtenerUsuario(sesion.uid);
  if (!usuario || !usuario.activo) return null;

  // El rol se vuelve a leer de la base: si cambió, la cookie no manda.
  return usuario;
}

/** Exige sesión. Si no hay, manda al login. */
export async function exigirUsuario(destino?: string): Promise<Usuario> {
  const usuario = await usuarioActual();
  if (!usuario) {
    // typedRoutes no puede inferir una ruta con query armada en tiempo de
    // ejecución; la ruta base sí existe.
    const ruta = destino ? `/entrar?volver=${encodeURIComponent(destino)}` : "/entrar";
    redirect(ruta as Route);
  }
  return usuario;
}

export async function exigirPermiso(permiso: Permiso): Promise<Usuario> {
  const usuario = await exigirUsuario();
  if (!puede(usuario.rol, permiso)) redirect("/?sin_permiso=1" as Route);
  return usuario;
}

export function veTodo(usuario: Usuario): boolean {
  return puede(usuario.rol, "ver_toda_la_cartera");
}

/** Filtra una lista de leads al alcance del usuario. */
export function leadsVisibles(usuario: Usuario, leads: Lead[]): Lead[] {
  if (veTodo(usuario)) return leads;
  return leads.filter((lead) => lead.ejecutivoId === usuario.id);
}

export function negociosVisibles(usuario: Usuario, negocios: Negocio[]): Negocio[] {
  if (veTodo(usuario)) return negocios;
  return negocios.filter((negocio) => negocio.ejecutivoId === usuario.id);
}

export function puedeVerNegocio(usuario: Usuario, negocio: Negocio): boolean {
  return veTodo(usuario) || negocio.ejecutivoId === usuario.id;
}

export function puedeVerLead(usuario: Usuario, lead: Lead): boolean {
  return veTodo(usuario) || lead.ejecutivoId === usuario.id;
}
