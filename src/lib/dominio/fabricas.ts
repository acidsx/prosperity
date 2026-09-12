/**
 * Constructores de entidades con sus valores por defecto.
 *
 * Centralizarlos evita que cada lugar que crea un lead o un mensaje tenga
 * que repetir la lista completa de campos, que es como se cuelan omisiones.
 */

import { nuevoId } from "@/lib/datos/tienda";
import {
  PERFIL_VACIO,
  type CanalMensaje,
  type Lead,
  type Mensaje,
  type Visita,
} from "@/lib/dominio/tipos";

export function nuevoLead(parcial: Partial<Lead> & { nombre: string }): Lead {
  const ahora = new Date().toISOString();
  return {
    id: parcial.id ?? nuevoId("lead"),
    nombre: parcial.nombre,
    email: parcial.email ?? null,
    telefono: parcial.telefono ?? null,
    rut: parcial.rut ?? null,
    canal: parcial.canal ?? "sitio_web",
    campana: parcial.campana ?? null,
    proyectoIdInteres: parcial.proyectoIdInteres ?? null,
    mensajeInicial: parcial.mensajeInicial ?? "",
    comunasInteres: parcial.comunasInteres ?? [],
    presupuestoUfDeclarado: parcial.presupuestoUfDeclarado ?? null,
    sexo: parcial.sexo ?? null,
    perfil: parcial.perfil ?? { ...PERFIL_VACIO },
    creadoEn: parcial.creadoEn ?? ahora,
    ultimoEntranteEn: parcial.ultimoEntranteEn ?? null,
    optOut: parcial.optOut ?? false,
    optOutEn: parcial.optOutEn ?? null,
    enManosDeHumano: parcial.enManosDeHumano ?? false,
    ejecutivoId: parcial.ejecutivoId ?? null,
  };
}

export function nuevoMensaje(
  parcial: Partial<Mensaje> & { leadId: string; direccion: Mensaje["direccion"]; cuerpo: string },
): Mensaje {
  return {
    id: parcial.id ?? nuevoId("msg"),
    leadId: parcial.leadId,
    direccion: parcial.direccion,
    canal: parcial.canal ?? ("portal" as CanalMensaje),
    cuerpo: parcial.cuerpo,
    automatico: parcial.automatico ?? false,
    enviadoEn: parcial.enviadoEn ?? new Date().toISOString(),
    idProveedor: parcial.idProveedor ?? null,
    estado: parcial.estado ?? "enviado",
    plantilla: parcial.plantilla ?? null,
    asunto: parcial.asunto ?? null,
    detalleError: parcial.detalleError ?? null,
    objecion: parcial.objecion ?? null,
  };
}

export function nuevaVisita(
  parcial: Partial<Visita> & { leadId: string; proyectoId: string; inicio: string; fin: string },
): Visita {
  return {
    id: parcial.id ?? nuevoId("vis"),
    leadId: parcial.leadId,
    proyectoId: parcial.proyectoId,
    inicio: parcial.inicio,
    fin: parcial.fin,
    estado: parcial.estado ?? "propuesta",
    notas: parcial.notas ?? null,
    creadaEn: parcial.creadaEn ?? new Date().toISOString(),
    confirmadaEn: parcial.confirmadaEn ?? null,
    recordatorios: parcial.recordatorios ?? 0,
  };
}
