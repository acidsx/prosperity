/**
 * Tienda en memoria: el modo por defecto del simulador.
 *
 * El estado vive en globalThis para sobrevivir al hot reload de Next. No es
 * persistente; al reiniciar el proceso se regenera con la misma semilla.
 */

import { generarLeads, generarProyectos } from "@/lib/datos/generador";
import type { Tienda } from "@/lib/datos/tienda";
import type {
  Actividad,
  Lead,
  Mensaje,
  Oportunidad,
  Proyecto,
  Visita,
} from "@/lib/dominio/tipos";

interface Estado {
  proyectos: Proyecto[];
  leads: Lead[];
  oportunidades: Oportunidad[];
  visitas: Visita[];
  mensajes: Mensaje[];
  actividades: Actividad[];
}

const CLAVE = Symbol.for("prosperity.estado");

function contenedor(): Record<symbol, Estado | undefined> {
  return globalThis as unknown as Record<symbol, Estado | undefined>;
}

function estado(): Estado {
  const global = contenedor();
  if (!global[CLAVE]) global[CLAVE] = poblar();
  return global[CLAVE]!;
}

function poblar(proyectos = 18, leads = 14, semilla = 2026): Estado {
  const inventario = generarProyectos(proyectos, semilla);
  const consultas = generarLeads(leads, inventario, semilla + 51);

  return {
    proyectos: inventario,
    leads: consultas,
    oportunidades: consultas.map((lead) => ({
      id: `opo_${lead.id.slice(5)}`,
      leadId: lead.id,
      proyectoId: lead.proyectoIdInteres,
      modelo: null,
      estado: "new" as const,
      calificacion: null,
      valorUf: null,
      comisionUf: null,
      motivoPerdida: null,
      sincronizadoEn: null,
      sincronizacion: "pendiente" as const,
      detalleSincronizacion: null,
      creadaEn: lead.creadoEn,
      actualizadaEn: lead.creadoEn,
    })),
    visitas: [],
    mensajes: consultas.map((lead, indice) => ({
      id: `msg_${String(indice + 1).padStart(4, "0")}`,
      leadId: lead.id,
      direccion: "entrante" as const,
      canal: lead.canal === "whatsapp" ? ("whatsapp" as const) : ("portal" as const),
      cuerpo: lead.mensajeInicial,
      automatico: false,
      enviadoEn: lead.creadoEn,
    })),
    actividades: consultas.map((lead, indice) => ({
      id: `act_${String(indice + 1).padStart(4, "0")}`,
      leadId: lead.id,
      tipo: "lead_ingresado" as const,
      detalle: `Consulta entrante desde ${lead.canal.replace(/_/g, " ")}`,
      autor: "agente" as const,
      ocurridaEn: lead.creadoEn,
    })),
  };
}

const clonar = <T,>(valor: T): T => structuredClone(valor);

export const tiendaMemoria: Tienda = {
  nombre: "memoria",

  async listarProyectos() {
    return clonar(estado().proyectos);
  },

  async obtenerProyecto(id) {
    return clonar(estado().proyectos.find((proyecto) => proyecto.id === id) ?? null);
  },

  async guardarProyectos(proyectos) {
    estado().proyectos = clonar(proyectos);
  },

  async listarLeads() {
    return clonar(estado().leads);
  },

  async obtenerLead(id) {
    return clonar(estado().leads.find((lead) => lead.id === id) ?? null);
  },

  async crearLead(lead) {
    estado().leads.push(clonar(lead));
    return lead;
  },

  async actualizarLead(id, cambios) {
    const lead = estado().leads.find((item) => item.id === id);
    if (lead) Object.assign(lead, clonar(cambios));
  },

  async listarOportunidades() {
    return clonar(estado().oportunidades);
  },

  async oportunidadDeLead(leadId) {
    return clonar(estado().oportunidades.find((opo) => opo.leadId === leadId) ?? null);
  },

  async guardarOportunidad(oportunidad) {
    const actual = estado().oportunidades;
    const indice = actual.findIndex((item) => item.id === oportunidad.id);
    if (indice >= 0) actual[indice] = clonar(oportunidad);
    else actual.push(clonar(oportunidad));
  },

  async listarVisitas() {
    return clonar(estado().visitas);
  },

  async guardarVisita(visita) {
    estado().visitas.push(clonar(visita));
  },

  async actualizarVisita(id, cambios) {
    const visita = estado().visitas.find((item) => item.id === id);
    if (visita) Object.assign(visita, clonar(cambios));
  },

  async listarMensajes(leadId) {
    const mensajes = estado().mensajes;
    return clonar(leadId ? mensajes.filter((mensaje) => mensaje.leadId === leadId) : mensajes);
  },

  async guardarMensaje(mensaje) {
    estado().mensajes.push(clonar(mensaje));
  },

  async listarActividades(limite = 60) {
    return clonar(
      [...estado().actividades]
        .sort((a, b) => b.ocurridaEn.localeCompare(a.ocurridaEn))
        .slice(0, limite),
    );
  },

  async registrarActividad(actividad) {
    estado().actividades.push(clonar(actividad));
  },

  async reiniciar(opciones) {
    contenedor()[CLAVE] = poblar(opciones?.proyectos, opciones?.leads, opciones?.semilla);
  },
};
