/**
 * Tienda en memoria: el modo por defecto del simulador.
 *
 * El estado vive en globalThis para sobrevivir al hot reload de Next. No es
 * persistente; al reiniciar el proceso se regenera con la misma semilla.
 */

import { generarLeads, generarProyectos } from "@/lib/datos/generador";
import { mismoCorreo, mismoTelefono } from "@/lib/dominio/chile";
import { nuevoMensaje } from "@/lib/dominio/fabricas";
import type { Tienda } from "@/lib/datos/tienda";
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

interface Estado {
  proyectos: Proyecto[];
  leads: Lead[];
  oportunidades: Oportunidad[];
  visitas: Visita[];
  mensajes: Mensaje[];
  actividades: Actividad[];
  solicitudes: SolicitudDocumentos[];
  usuarios: Usuario[];
  negocios: Negocio[];
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
      huellaSincronizacion: null,
      sincronizacion: "pendiente" as const,
      detalleSincronizacion: null,
      creadaEn: lead.creadoEn,
      actualizadaEn: lead.creadoEn,
    })),
    visitas: [],
    mensajes: consultas.map((lead, indice) =>
      nuevoMensaje({
        id: `msg_${String(indice + 1).padStart(4, "0")}`,
        leadId: lead.id,
        direccion: "entrante",
        canal: lead.canal === "whatsapp" ? "whatsapp" : "portal",
        cuerpo: lead.mensajeInicial,
        enviadoEn: lead.creadoEn,
      }),
    ),
    solicitudes: [],
    // Los usuarios no se regeneran al reiniciar el escenario: se siembran
    // aparte con `npm run sembrar-usuarios`.
    usuarios: (globalThis as unknown as Record<symbol, Estado | undefined>)[CLAVE]?.usuarios ?? [],
    negocios: [],
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

  async buscarLeadPorContacto({ telefono, email }) {
    const encontrado = estado().leads.find(
      (lead) =>
        (telefono !== undefined && mismoTelefono(lead.telefono, telefono)) ||
        (email !== undefined && mismoCorreo(lead.email, email)),
    );
    return clonar(encontrado ?? null);
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

  async actualizarMensaje(id, cambios) {
    const mensaje = estado().mensajes.find((item) => item.id === id);
    if (mensaje) Object.assign(mensaje, clonar(cambios));
  },

  async mensajePorIdProveedor(idProveedor) {
    return clonar(
      estado().mensajes.find((mensaje) => mensaje.idProveedor === idProveedor) ?? null,
    );
  },

  async listarSolicitudes() {
    return clonar(estado().solicitudes);
  },

  async solicitudDeLead(leadId) {
    return clonar(estado().solicitudes.find((item) => item.leadId === leadId) ?? null);
  },

  async solicitudPorToken(token) {
    return clonar(estado().solicitudes.find((item) => item.token === token) ?? null);
  },

  async guardarSolicitud(solicitud) {
    const actual = estado().solicitudes;
    const indice = actual.findIndex((item) => item.id === solicitud.id);
    if (indice >= 0) actual[indice] = clonar(solicitud);
    else actual.push(clonar(solicitud));
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

  async listarUsuarios() {
    return clonar(estado().usuarios);
  },

  async obtenerUsuario(id) {
    return clonar(estado().usuarios.find((usuario) => usuario.id === id) ?? null);
  },

  async usuarioPorEmail(email) {
    const buscado = email.trim().toLowerCase();
    return clonar(
      estado().usuarios.find((usuario) => usuario.email.toLowerCase() === buscado) ?? null,
    );
  },

  async guardarUsuario(usuario) {
    const actual = estado().usuarios;
    const indice = actual.findIndex((item) => item.id === usuario.id);
    if (indice >= 0) actual[indice] = clonar(usuario);
    else actual.push(clonar(usuario));
  },

  async listarNegocios() {
    return clonar(estado().negocios);
  },

  async obtenerNegocio(id) {
    return clonar(estado().negocios.find((negocio) => negocio.id === id) ?? null);
  },

  async negocioDeLead(leadId) {
    return clonar(estado().negocios.find((negocio) => negocio.leadId === leadId) ?? null);
  },

  async guardarNegocio(negocio) {
    const actual = estado().negocios;
    const indice = actual.findIndex((item) => item.id === negocio.id);
    if (indice >= 0) actual[indice] = clonar(negocio);
    else actual.push(clonar(negocio));
  },

  async reiniciar(opciones) {
    contenedor()[CLAVE] = poblar(opciones?.proyectos, opciones?.leads, opciones?.semilla);
  },
};
