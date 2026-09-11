/**
 * Ingesta de leads. Se conecta al formulario de una landing, un portal o un
 * webhook de campaña; el agente califica y responde en la misma llamada.
 *
 * Acepta tanto los nombres del Customer API de JetBrokers (fullName, mobile,
 * taxId) como sus equivalentes en español, para no obligar a cambiar los
 * formularios que ya existen.
 */

import { NextResponse } from "next/server";

import { gestionarLead } from "@/lib/agente/gestor";
import { tienda } from "@/lib/datos";
import { nuevoId } from "@/lib/datos/tienda";
import { PERFIL_VACIO, type CanalLead, type Lead } from "@/lib/dominio/tipos";

export const runtime = "nodejs";

const CANALES: CanalLead[] = [
  "portal_inmobiliario",
  "yapo",
  "toctoc",
  "sitio_web",
  "whatsapp",
  "referido",
  "instagram",
  "landing_campana",
];

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

export async function POST(peticion: Request) {
  // Si hay token configurado, se exige. Sin token, la ruta queda abierta:
  // úsalo solo en desarrollo.
  const esperado = process.env.INGESTA_TOKEN;
  if (esperado && peticion.headers.get("x-ingesta-token") !== esperado) {
    return NextResponse.json({ error: "Token de ingesta inválido" }, { status: 401 });
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await peticion.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "El cuerpo debe ser JSON" }, { status: 400 });
  }

  const nombre = texto(cuerpo.fullName) ?? texto(cuerpo.nombre);
  const mensaje = texto(cuerpo.comments) ?? texto(cuerpo.mensaje) ?? "";
  if (!nombre) {
    return NextResponse.json({ error: "fullName (o nombre) es obligatorio" }, { status: 422 });
  }

  const canalRecibido = texto(cuerpo.origin) ?? texto(cuerpo.canal) ?? "sitio_web";
  const canal = CANALES.includes(canalRecibido as CanalLead)
    ? (canalRecibido as CanalLead)
    : "sitio_web";

  const comunas = Array.isArray(cuerpo.comunasInteres)
    ? cuerpo.comunasInteres.filter((valor): valor is string => typeof valor === "string")
    : [texto(cuerpo.comuna)].filter((valor): valor is string => valor !== null);

  const presupuesto = Number(cuerpo.presupuestoUf);

  const lead: Lead = {
    id: nuevoId("lead"),
    nombre,
    email: texto(cuerpo.email),
    telefono: texto(cuerpo.mobile) ?? texto(cuerpo.telefono),
    rut: texto(cuerpo.taxId) ?? texto(cuerpo.rut),
    canal,
    campana: texto(cuerpo.campaign) ?? texto(cuerpo.campana),
    proyectoIdInteres: texto(cuerpo.projectId) ?? texto(cuerpo.proyectoId),
    mensajeInicial: mensaje || "Consulta sin mensaje.",
    comunasInteres: comunas,
    presupuestoUfDeclarado: Number.isFinite(presupuesto) && presupuesto > 0 ? presupuesto : null,
    sexo: cuerpo.sex === "male" || cuerpo.sex === "female" ? cuerpo.sex : null,
    perfil: { ...PERFIL_VACIO },
    creadoEn: new Date().toISOString(),
  };

  const db = tienda();
  await db.crearLead(lead);
  await db.guardarMensaje({
    id: nuevoId("msg"),
    leadId: lead.id,
    direccion: "entrante",
    canal: canal === "whatsapp" ? "whatsapp" : "portal",
    cuerpo: lead.mensajeInicial,
    automatico: false,
    enviadoEn: lead.creadoEn,
  });

  try {
    const resultado = await gestionarLead(lead.id);
    return NextResponse.json(
      {
        leadId: lead.id,
        estado: resultado.oportunidad.estado,
        puntaje: resultado.calificacion.puntaje,
        temperatura: resultado.calificacion.temperatura,
        presupuestoUfEstimado: resultado.calificacion.presupuestoUfEstimado,
        respuesta: resultado.calificacion.mensajeRespuesta,
        recomendaciones: resultado.calificacion.recomendaciones,
        horariosPropuestos: resultado.calificacion.horariosPropuestos,
        crm: resultado.oportunidad.sincronizacion,
        avisos: resultado.avisos,
      },
      { status: 201 },
    );
  } catch (error) {
    // El lead ya quedó guardado: se puede recalificar después desde la ficha.
    return NextResponse.json(
      {
        leadId: lead.id,
        error: error instanceof Error ? error.message : "No se pudo calificar el lead",
      },
      { status: 202 },
    );
  }
}
