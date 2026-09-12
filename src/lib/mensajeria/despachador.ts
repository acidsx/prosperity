/**
 * Único punto de salida de mensajes.
 *
 * Todo pasa por acá para que los frenos y la ventana de 24 horas no se
 * puedan saltar por error desde otra parte del código.
 */

import "server-only";

import { tienda } from "@/lib/datos";
import { nuevoId } from "@/lib/datos/tienda";
import { nuevoMensaje } from "@/lib/dominio/fabricas";
import type { Actividad, Lead, Mensaje } from "@/lib/dominio/tipos";
import { correoDesdeEntorno } from "@/lib/mensajeria/correo";
import { dentroDeVentana24h, puedeEnviar, type Veredicto } from "@/lib/mensajeria/politica";
import { ProveedorSimulado } from "@/lib/mensajeria/simulado";
import type {
  CanalEnvio,
  Destinatario,
  ProveedorMensajeria,
  ResultadoEnvio,
  Salida,
} from "@/lib/mensajeria/tipos";
import { vistaPreviaPlantilla, whatsAppDesdeEntorno, type EstadoEntrega } from "@/lib/mensajeria/whatsapp";

export interface SolicitudEnvio {
  leadId: string;
  canal: CanalEnvio;
  salida: Salida;
  /** Contesta algo que el comprador acaba de escribir: ver `esRespuesta` en la política. */
  esRespuesta?: boolean;
  /**
   * Plantilla a usar si se cae la ventana de 24 horas de WhatsApp. Sin esto,
   * un texto libre fuera de ventana se bloquea en vez de enviarse.
   */
  alternativaPlantilla?: { plantilla: string; variables: string[] };
  /** false para mensajes escritos por una persona: no cuentan para los topes. */
  automatico?: boolean;
}

export interface ResultadoDespacho {
  veredicto: Veredicto;
  resultado: ResultadoEnvio | null;
  mensaje: Mensaje | null;
}

export function proveedor(canal: CanalEnvio): ProveedorMensajeria {
  if (canal === "whatsapp") return whatsAppDesdeEntorno() ?? new ProveedorSimulado("whatsapp");
  return correoDesdeEntorno() ?? new ProveedorSimulado("email");
}

function destinatarioDe(lead: Lead): Destinatario {
  return { leadId: lead.id, nombre: lead.nombre, telefono: lead.telefono, email: lead.email };
}

async function registrar(
  leadId: string | null,
  tipo: Actividad["tipo"],
  detalle: string,
): Promise<void> {
  await tienda().registrarActividad({
    id: nuevoId("act"),
    leadId,
    tipo,
    detalle,
    autor: "agente",
    ocurridaEn: new Date().toISOString(),
  });
}

export async function despachar(solicitud: SolicitudEnvio): Promise<ResultadoDespacho> {
  const db = tienda();
  const lead = await db.obtenerLead(solicitud.leadId);
  if (!lead) throw new Error(`No existe el lead ${solicitud.leadId}`);

  const mensajes = await db.listarMensajes(lead.id);
  const automatico = solicitud.automatico ?? true;

  const veredicto = automatico
    ? puedeEnviar({ lead, mensajes, esRespuesta: solicitud.esRespuesta })
    : { permitido: true };

  if (!veredicto.permitido) {
    await registrar(lead.id, "envio_bloqueado", veredicto.motivo ?? "Envío bloqueado por política");
    return { veredicto, resultado: null, mensaje: null };
  }

  let salida = solicitud.salida;

  // Fuera de la ventana de 24 horas, WhatsApp no acepta texto libre.
  if (solicitud.canal === "whatsapp" && salida.tipo === "texto" && !dentroDeVentana24h(lead)) {
    if (!solicitud.alternativaPlantilla) {
      const motivo =
        "Pasaron más de 24 h desde el último mensaje del comprador: WhatsApp solo acepta plantillas aprobadas";
      await registrar(lead.id, "envio_bloqueado", motivo);
      return { veredicto: { permitido: false, motivo }, resultado: null, mensaje: null };
    }
    const { plantilla, variables } = solicitud.alternativaPlantilla;
    salida = {
      tipo: "plantilla",
      plantilla,
      variables,
      vistaPrevia: vistaPreviaPlantilla(plantilla, variables),
    };
  }

  const canal = proveedor(solicitud.canal);
  let resultado: ResultadoEnvio;
  try {
    resultado = await canal.enviar(destinatarioDe(lead), salida);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    const mensajeFallido = nuevoMensaje({
      leadId: lead.id,
      direccion: "saliente",
      canal: solicitud.canal === "whatsapp" ? "whatsapp" : "email",
      cuerpo: cuerpoLegible(salida),
      automatico,
      estado: "fallido",
      plantilla: salida.tipo === "plantilla" ? salida.plantilla : null,
      asunto: salida.tipo === "correo" ? salida.asunto : null,
      detalleError: detalle,
    });
    await db.guardarMensaje(mensajeFallido);
    await registrar(lead.id, "error_agente", `Falló el envío por ${solicitud.canal}: ${detalle}`);
    return {
      veredicto,
      resultado: { enviado: false, idProveedor: null, simulado: canal.simulado, motivo: detalle },
      mensaje: mensajeFallido,
    };
  }

  const mensaje = nuevoMensaje({
    leadId: lead.id,
    direccion: "saliente",
    canal: solicitud.canal === "whatsapp" ? "whatsapp" : "email",
    cuerpo: cuerpoLegible(salida),
    automatico,
    estado: resultado.enviado ? "enviado" : "simulado",
    idProveedor: resultado.idProveedor,
    plantilla: salida.tipo === "plantilla" ? salida.plantilla : null,
    asunto: salida.tipo === "correo" ? salida.asunto : null,
    detalleError: resultado.enviado ? null : (resultado.motivo ?? null),
  });
  await db.guardarMensaje(mensaje);
  await registrar(
    lead.id,
    "mensaje_enviado",
    resultado.enviado
      ? `Enviado por ${solicitud.canal}${salida.tipo === "plantilla" ? ` (plantilla ${salida.plantilla})` : ""}`
      : `Simulado por ${solicitud.canal}: ${resultado.motivo ?? "sin credenciales"}`,
  );

  return { veredicto, resultado, mensaje };
}

/** Texto que se guarda en la conversación, cualquiera sea el tipo de salida. */
function cuerpoLegible(salida: Salida): string {
  if (salida.tipo === "texto") return salida.cuerpo;
  if (salida.tipo === "plantilla") return salida.vistaPrevia;
  return salida.texto;
}

/** Aplica un cambio de estado que llegó por webhook. */
export async function registrarEstadoEntrega(estado: EstadoEntrega): Promise<boolean> {
  const db = tienda();
  const mensaje = await db.mensajePorIdProveedor(estado.idProveedor);
  if (!mensaje) return false;

  // No retroceder: un "entregado" que llega después de un "leído" se ignora.
  const orden: Record<string, number> = { encolado: 0, simulado: 0, enviado: 1, entregado: 2, leido: 3, fallido: 4 };
  if ((orden[estado.estado] ?? 0) <= (orden[mensaje.estado] ?? 0) && estado.estado !== "fallido") {
    return false;
  }

  await db.actualizarMensaje(mensaje.id, {
    estado: estado.estado,
    detalleError: estado.detalle,
  });
  return true;
}

/**
 * Canal por el que conviene responder.
 *
 * WhatsApp solo si la ventana de 24 horas está abierta: a un lead que llegó
 * de un portal y nunca escribió por WhatsApp no se le puede mandar texto
 * libre, aunque tengamos su teléfono.
 */
export function canalParaRespuesta(lead: Lead): CanalEnvio {
  if (lead.telefono && dentroDeVentana24h(lead)) return "whatsapp";
  if (lead.email) return "email";
  return "whatsapp";
}
