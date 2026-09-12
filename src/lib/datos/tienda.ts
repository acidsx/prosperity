/**
 * Contrato de la capa de datos. Hay dos implementaciones: en memoria
 * (simulación, sin configurar nada) y sobre Supabase (persistente).
 */

import type { Usuario } from "@/lib/auth/tipos";
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

export interface Tienda {
  readonly nombre: "memoria" | "supabase";

  listarProyectos(): Promise<Proyecto[]>;
  obtenerProyecto(id: string): Promise<Proyecto | null>;
  guardarProyectos(proyectos: Proyecto[]): Promise<void>;

  listarLeads(): Promise<Lead[]>;
  obtenerLead(id: string): Promise<Lead | null>;
  /** Busca por teléfono normalizado o correo, para calzar un mensaje entrante. */
  buscarLeadPorContacto(contacto: { telefono?: string; email?: string }): Promise<Lead | null>;
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
  actualizarMensaje(id: string, cambios: Partial<Mensaje>): Promise<void>;
  /** Para descartar webhooks repetidos: el proveedor reintenta. */
  mensajePorIdProveedor(idProveedor: string): Promise<Mensaje | null>;

  listarSolicitudes(): Promise<SolicitudDocumentos[]>;
  solicitudDeLead(leadId: string): Promise<SolicitudDocumentos | null>;
  solicitudPorToken(token: string): Promise<SolicitudDocumentos | null>;
  guardarSolicitud(solicitud: SolicitudDocumentos): Promise<void>;

  listarActividades(limite?: number): Promise<Actividad[]>;
  registrarActividad(actividad: Actividad): Promise<void>;

  listarUsuarios(): Promise<Usuario[]>;
  obtenerUsuario(id: string): Promise<Usuario | null>;
  usuarioPorEmail(email: string): Promise<Usuario | null>;
  guardarUsuario(usuario: Usuario): Promise<void>;

  listarNegocios(): Promise<Negocio[]>;
  obtenerNegocio(id: string): Promise<Negocio | null>;
  negocioDeLead(leadId: string): Promise<Negocio | null>;
  guardarNegocio(negocio: Negocio): Promise<void>;

  /** Repuebla el escenario con datos sintéticos. */
  reiniciar(opciones?: { proyectos?: number; leads?: number; semilla?: number }): Promise<void>;
}

let contador = 0;

export function nuevoId(prefijo: string): string {
  contador += 1;
  return `${prefijo}_${Date.now().toString(36)}${contador.toString(36)}`;
}
