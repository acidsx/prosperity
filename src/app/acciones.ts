"use server";

import { revalidatePath } from "next/cache";

import { gestionarLead, gestionarPendientes } from "@/lib/agente/gestor";
import { tienda } from "@/lib/datos";
import { sincronizarInventario } from "@/lib/datos/inventario";
import { tiendaMemoria } from "@/lib/datos/memoria";
import { nuevoLead, nuevoMensaje } from "@/lib/dominio/fabricas";
import type { CanalLead, Lead } from "@/lib/dominio/tipos";

function refrescar() {
  for (const ruta of ["/", "/leads", "/pipeline", "/proyectos", "/agenda"]) {
    revalidatePath(ruta);
  }
}

export async function ejecutarAgente() {
  await gestionarPendientes();
  refrescar();
}

export async function gestionarUno(formData: FormData) {
  const leadId = String(formData.get("leadId") ?? "");
  if (leadId) await gestionarLead(leadId);
  refrescar();
}

export async function sincronizarProyectos() {
  await sincronizarInventario();
  refrescar();
}

export async function reiniciarSimulacion() {
  const db = tienda();
  if (db.nombre !== "memoria") {
    throw new Error("Reiniciar solo está disponible en modo simulación (tienda en memoria)");
  }
  await tiendaMemoria.reiniciar();
  refrescar();
}

/** Alta manual de un lead, como si llegara de un formulario web. */
export async function ingresarLead(formData: FormData): Promise<void> {
  const nombre = String(formData.get("nombre") ?? "").trim();
  const mensaje = String(formData.get("mensaje") ?? "").trim();
  if (!nombre || !mensaje) return;

  const lead: Lead = nuevoLead({
    nombre,
    email: String(formData.get("email") ?? "").trim() || null,
    telefono: String(formData.get("telefono") ?? "").trim() || null,
    rut: String(formData.get("rut") ?? "").trim() || null,
    canal: (String(formData.get("canal") ?? "sitio_web") as CanalLead) || "sitio_web",
    proyectoIdInteres: String(formData.get("proyectoId") ?? "").trim() || null,
    mensajeInicial: mensaje,
    ultimoEntranteEn: new Date().toISOString(),
  });

  await tienda().crearLead(lead);
  await tienda().guardarMensaje(
    nuevoMensaje({
      leadId: lead.id,
      direccion: "entrante",
      canal: "portal",
      cuerpo: mensaje,
      enviadoEn: lead.creadoEn,
    }),
  );
  await gestionarLead(lead.id);
  refrescar();
}
