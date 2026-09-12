/**
 * Usuarios de demostración.
 *
 * Solo se siembran cuando los datos están en memoria, es decir cuando no hay
 * Supabase configurado. En cuanto hay persistencia real, esto no corre y los
 * usuarios se crean con `npm run usuarios`.
 */

import "server-only";

import { crearUsuario } from "@/lib/auth/sembrar";
import { tienda } from "@/lib/datos";

export const CLAVE_DEMO = "Demo2026clave";

export function esModoDemo(): boolean {
  return tienda().nombre === "memoria";
}

export async function sembrarUsuariosDemo(): Promise<void> {
  if (!esModoDemo()) return;

  const existentes = await tienda().listarUsuarios();
  if (existentes.length > 0) return;

  await crearUsuario({
    nombre: "Andrés Cid",
    email: "jefatura@corredora.cl",
    rol: "jefe_comercial",
    clave: CLAVE_DEMO,
  });
  await crearUsuario({
    nombre: "Paula Riveros",
    email: "paula@corredora.cl",
    rol: "ejecutivo",
    clave: CLAVE_DEMO,
  });
  await crearUsuario({
    nombre: "Rodrigo Cortés",
    email: "rodrigo@corredora.cl",
    rol: "ejecutivo",
    clave: CLAVE_DEMO,
  });
  await crearUsuario({
    nombre: "Operaciones",
    email: "operaciones@corredora.cl",
    rol: "operaciones",
    clave: CLAVE_DEMO,
  });
}

/** Reparte los leads sin dueño entre los ejecutivos, para que la demo tenga cartera. */
export async function repartirCarteraDemo(): Promise<void> {
  if (!esModoDemo()) return;

  const db = tienda();
  const [usuarios, leads] = await Promise.all([db.listarUsuarios(), db.listarLeads()]);
  const ejecutivos = usuarios.filter((usuario) => usuario.rol === "ejecutivo");
  if (ejecutivos.length === 0) return;

  const huerfanos = leads.filter((lead) => !lead.ejecutivoId);
  for (const [indice, lead] of huerfanos.entries()) {
    await db.actualizarLead(lead.id, { ejecutivoId: ejecutivos[indice % ejecutivos.length].id });
  }
}
