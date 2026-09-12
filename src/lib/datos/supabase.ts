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
import type { Usuario } from "@/lib/auth/tipos";
import { normalizarTelefono } from "@/lib/dominio/chile";
import type { Negocio } from "@/lib/dominio/cierre";
import type {
  Actividad,
  Lead,
  Mensaje,
  Oportunidad,
  Proyecto,
  SolicitudDocumentos,
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

    async buscarLeadPorContacto({ telefono, email }) {
      // Las columnas generadas guardan el contacto tal como lo escribió el
      // cliente, así que el teléfono se compara normalizado en memoria.
      if (email) {
        const filas = await leer<Lead>("leads", { columna: "email", valor: email.toLowerCase() });
        if (filas[0]) return filas[0];
      }
      if (!telefono) return null;
      const buscado = normalizarTelefono(telefono);
      const todos = await leer<Lead>("leads");
      return todos.find((lead) => normalizarTelefono(lead.telefono) === buscado) ?? null;
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

    async actualizarMensaje(id, cambios) {
      const actual = await uno<Mensaje>("mensajes", id);
      if (!actual) return;
      const siguiente = { ...actual, ...cambios };
      await escribir("mensajes", { id, lead_id: siguiente.leadId, datos: siguiente });
    },

    async mensajePorIdProveedor(idProveedor) {
      const { data, error } = await db
        .from("mensajes")
        .select("id, datos")
        .eq("id_proveedor", idProveedor)
        .maybeSingle();
      if (error) throw new Error(`Supabase (mensajes): ${error.message}`);
      return data ? ((data as Fila).datos as Mensaje) : null;
    },

    async listarSolicitudes() {
      return leer<SolicitudDocumentos>("solicitudes_documentos");
    },

    async solicitudDeLead(leadId) {
      const filas = await leer<SolicitudDocumentos>("solicitudes_documentos", {
        columna: "lead_id",
        valor: leadId,
      });
      return filas[0] ?? null;
    },

    async solicitudPorToken(token) {
      const filas = await leer<SolicitudDocumentos>("solicitudes_documentos", {
        columna: "token",
        valor: token,
      });
      return filas[0] ?? null;
    },

    async guardarSolicitud(solicitud) {
      await escribir("solicitudes_documentos", {
        id: solicitud.id,
        lead_id: solicitud.leadId,
        datos: solicitud,
      });
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

    async listarUsuarios() {
      return leer<Usuario>("usuarios");
    },

    async obtenerUsuario(id) {
      return uno<Usuario>("usuarios", id);
    },

    async usuarioPorEmail(email) {
      const filas = await leer<Usuario>("usuarios", {
        columna: "email",
        valor: email.trim().toLowerCase(),
      });
      return filas[0] ?? null;
    },

    async guardarUsuario(usuario) {
      await escribir("usuarios", { id: usuario.id, datos: usuario });
    },

    async listarNegocios() {
      return leer<Negocio>("negocios");
    },

    async obtenerNegocio(id) {
      return uno<Negocio>("negocios", id);
    },

    async negocioDeLead(leadId) {
      const filas = await leer<Negocio>("negocios", { columna: "lead_id", valor: leadId });
      return filas[0] ?? null;
    },

    async guardarNegocio(negocio) {
      await escribir("negocios", {
        id: negocio.id,
        lead_id: negocio.leadId,
        datos: negocio,
        actualizado_en: negocio.actualizadoEn,
      });
    },

    async reiniciar() {
      throw new Error(
        "reiniciar() solo está disponible en la tienda en memoria. Con Supabase, limpia las tablas y vuelve a sembrar con `npm run sembrar`.",
      );
    },
  };
}
