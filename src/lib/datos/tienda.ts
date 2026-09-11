/**
 * Contrato de la capa de datos. Hay dos implementaciones: en memoria
 * (simulación, sin configurar nada) y sobre Supabase (persistente).
 */

import type {
  Actividad,
  Lead,
  Mensaje,
  Oportunidad,
  Proyecto,
  Visita,
} from "@/lib/dominio/tipos";

export interface Tienda {
  readonly nombre: "memoria" | "supabase";

  listarProyectos(): Promise<Proyecto[]>;
  obtenerProyecto(id: string): Promise<Proyecto | null>;
  guardarProyectos(proyectos: Proyecto[]): Promise<void>;

  listarLeads(): Promise<Lead[]>;
  obtenerLead(id: string): Promise<Lead | null>;
  crearLead(lead: Lead): Promise<Lead>;
  actualizarLead(id: string, cambios: Partial<Lead>): Promise<void>;

  listarOportunidades(): Promise<Oportunidad[]>;
  oportunidadDeLead(leadId: string): Promise<Oportunidad | null>;
  guardarOportunidad(oportunidad: Oportunidad): Promise<void>;

  listarVisitas(): Promise<Visita[]>;
  guardarVisita(visita: Visita): Promise<void>;
  actualizarVisita(id: string, cambios: Partial<Visita>): Promise<void>;

  listarMensajes(leadId?: string): Promise<Mensaje[]>;
  guardarMensaje(mensaje: Mensaje): Promise<void>;

  listarActividades(limite?: number): Promise<Actividad[]>;
  registrarActividad(actividad: Actividad): Promise<void>;

  /** Repuebla el escenario con datos sintéticos. */
  reiniciar(opciones?: { proyectos?: number; leads?: number; semilla?: number }): Promise<void>;
}

let contador = 0;

export function nuevoId(prefijo: string): string {
  contador += 1;
  return `${prefijo}_${Date.now().toString(36)}${contador.toString(36)}`;
}
