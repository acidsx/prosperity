/**
 * Tienda sobre Supabase. Se activa cuando están SUPABASE_URL y
 * SUPABASE_SERVICE_ROLE_KEY; si no, el gestor usa la tienda en memoria.
 *
 * Corre solo del lado del servidor: la service role key salta RLS y no
 * debe llegar nunca al navegador.
 */

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Tienda } from "@/lib/datos/tienda";
import type {
  Actividad,
  Lead,
  Mensaje,
  Oportunidad,
  Proyecto,
  Visita,
} from "@/lib/dominio/tipos";

interface Fila {
  id: string;
  datos: unknown;
}

function crear(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) return null;
  return createClient(url, clave, { auth: { persistSession: false } });
}

function desempaquetar<T>(filas: Fila[] | null): T[] {
  return (filas ?? []).map((fila) => fila.datos as T);
}

export function tiendaSupabase(): Tienda | null {
  const db = crear();
  if (!db) return null;

  async function leer<T>(tabla: string, filtro?: { columna: string; valor: string }): Promise<T[]> {
    let consulta = db!.from(tabla).select("id, datos");
    if (filtro) consulta = consulta.eq(filtro.columna, filtro.valor);
    const { data, error } = await consulta;
    if (error) throw new Error(`Supabase (${tabla}): ${error.message}`);
    return desempaquetar<T>(data as Fila[] | null);
  }

  async function escribir(tabla: string, fila: Record<string, unknown>): Promise<void> {
    const { error } = await db!.from(tabla).upsert(fila, { onConflict: "id" });
    if (error) throw new Error(`Supabase (${tabla}): ${error.message}`);
  }

  async function uno<T>(tabla: string, id: string): Promise<T | null> {
    const { data, error } = await db!.from(tabla).select("id, datos").eq("id", id).maybeSingle();
    if (error) throw new Error(`Supabase (${tabla}): ${error.message}`);
    return data ? ((data as Fila).datos as T) : null;
  }

  return {
    nombre: "supabase",

    async listarProyectos() {
      return leer<Proyecto>("proyectos");
    },

    async obtenerProyecto(id) {
      return uno<Proyecto>("proyectos", id);
    },

    async guardarProyectos(proyectos) {
      if (proyectos.length === 0) return;
      const { error } = await db
        .from("proyectos")
        .upsert(
          proyectos.map((proyecto) => ({ id: proyecto.id, datos: proyecto, actualizado_en: new Date().toISOString() })),
          { onConflict: "id" },
        );
      if (error) throw new Error(`Supabase (proyectos): ${error.message}`);
    },

    async listarLeads() {
      return leer<Lead>("leads");
    },

    async obtenerLead(id) {
      return uno<Lead>("leads", id);
    },

    async crearLead(lead) {
      await escribir("leads", { id: lead.id, datos: lead, creado_en: lead.creadoEn });
      return lead;
    },

    async actualizarLead(id, cambios) {
      const actual = await uno<Lead>("leads", id);
      if (!actual) return;
      await escribir("leads", { id, datos: { ...actual, ...cambios } });
    },

    async listarOportunidades() {
      return leer<Oportunidad>("oportunidades");
    },

    async oportunidadDeLead(leadId) {
      const filas = await leer<Oportunidad>("oportunidades", { columna: "lead_id", valor: leadId });
      return filas[0] ?? null;
    },

    async guardarOportunidad(oportunidad) {
      await escribir("oportunidades", {
        id: oportunidad.id,
        lead_id: oportunidad.leadId,
        datos: oportunidad,
        actualizada_en: oportunidad.actualizadaEn,
      });
    },

    async listarVisitas() {
      return leer<Visita>("visitas");
    },

    async guardarVisita(visita) {
      await escribir("visitas", { id: visita.id, lead_id: visita.leadId, datos: visita });
    },

    async actualizarVisita(id, cambios) {
      const actual = await uno<Visita>("visitas", id);
      if (!actual) return;
      const siguiente = { ...actual, ...cambios };
      await escribir("visitas", { id, lead_id: siguiente.leadId, datos: siguiente });
    },

    async listarMensajes(leadId) {
      return leadId
        ? leer<Mensaje>("mensajes", { columna: "lead_id", valor: leadId })
        : leer<Mensaje>("mensajes");
    },

    async guardarMensaje(mensaje) {
      await escribir("mensajes", { id: mensaje.id, lead_id: mensaje.leadId, datos: mensaje });
    },

    async listarActividades(limite = 60) {
      const { data, error } = await db
        .from("actividades")
        .select("id, datos")
        .order("ocurrida_en", { ascending: false })
        .limit(limite);
      if (error) throw new Error(`Supabase (actividades): ${error.message}`);
      return desempaquetar<Actividad>(data as Fila[] | null);
    },

    async registrarActividad(actividad) {
      await escribir("actividades", {
        id: actividad.id,
        lead_id: actividad.leadId,
        datos: actividad,
      });
    },

    async reiniciar() {
      throw new Error(
        "reiniciar() solo está disponible en la tienda en memoria. Con Supabase, limpia las tablas y vuelve a sembrar con `npm run sembrar`.",
      );
    },
  };
}
