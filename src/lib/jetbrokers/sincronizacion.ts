/**
 * Devolver el estado al CRM de JetBrokers.
 *
 * El Customer API no tiene un endpoint de actualización: se vuelve a hacer
 * POST del mismo cliente y JetBrokers lo reconoce por email, mobile o taxId,
 * anotando los valores nuevos en su timeline.
 *
 * Eso tiene una consecuencia incómoda: cada actualización gasta uno de los
 * diez envíos por hora. Por eso acá no se reenvía nada que no haya cambiado,
 * y cuando no hay cupo la sincronización queda pendiente en vez de fallar.
 */

import "server-only";

import { createHash } from "node:crypto";

import { tienda } from "@/lib/datos";
import type { EtapaCierre } from "@/lib/dominio/cierre";
import type { Calificacion, Lead, Oportunidad } from "@/lib/dominio/tipos";
import { jetBrokersDesdeEntorno } from "@/lib/jetbrokers/cliente";
import { aClienteJetBrokers, type OpcionesCrm } from "@/lib/jetbrokers/mapeo";
import type { ClienteEntrada, EstadoCliente } from "@/lib/jetbrokers/tipos";

/**
 * Etapa del cierre traducida al campo `status` del CRM.
 *
 * Todo el tramo entre la reserva y la entrega es `closing` para JetBrokers:
 * su lista de estados llega hasta ahí y no distingue las etapas internas.
 * El detalle fino vive en este sistema; el CRM necesita saber que la
 * operación está en cierre y cuándo pasó a cliente.
 */
export function estadoCrmDesdeCierre(etapa: EtapaCierre): EstadoCliente {
  if (etapa === "cerrado") return "customer";
  if (etapa === "caido") return "dropped";
  return "closing";
}

/** Huella del payload, para no reenviar lo mismo dos veces. */
export function huellaDePayload(payload: ClienteEntrada): string {
  // Claves ordenadas: el orden de las propiedades no debería contar como cambio.
  const ordenado = Object.fromEntries(
    Object.entries(payload).sort(([uno], [otro]) => uno.localeCompare(otro)),
  );
  return createHash("sha256").update(JSON.stringify(ordenado)).digest("hex").slice(0, 32);
}

export type ResultadoSincronizacion =
  | { estado: "enviado"; payload: ClienteEntrada; cuposRestantes: number; avisos: string[] }
  | { estado: "simulado"; payload: ClienteEntrada; avisos: string[] }
  | { estado: "sin_cambios"; payload: ClienteEntrada }
  | { estado: "sin_cupo"; payload: ClienteEntrada; reintentarEnMinutos: number }
  | { estado: "sin_configurar" }
  | { estado: "error"; detalle: string };

export interface OpcionesSincronizacion extends OpcionesCrm {
  /** Reenvía aunque el payload sea idéntico al último enviado. */
  forzar?: boolean;
}

/**
 * Sincroniza un lead con el CRM. Devuelve qué pasó en vez de lanzar: quien
 * llama casi siempre está en medio de otra cosa más importante que esto.
 */
export async function sincronizarCliente(
  leadId: string,
  opciones: OpcionesSincronizacion = {},
): Promise<ResultadoSincronizacion> {
  const api = jetBrokersDesdeEntorno();
  if (!api) return { estado: "sin_configurar" };

  const db = tienda();
  const [lead, oportunidad] = await Promise.all([
    db.obtenerLead(leadId),
    db.oportunidadDeLead(leadId),
  ]);
  if (!lead || !oportunidad?.calificacion) {
    return { estado: "error", detalle: "El lead no existe o todavía no está calificado" };
  }

  const payload = await construirPayload(lead, oportunidad, oportunidad.calificacion, opciones);
  const huella = huellaDePayload(payload);

  if (!opciones.forzar && oportunidad.huellaSincronizacion === huella) {
    return { estado: "sin_cambios", payload };
  }

  // Se consulta el cupo antes de llamar: preferimos dejarlo pendiente a
  // gastar el intento y recibir un 429.
  if (api.permitirEscritura && api.cuposRestantes() === 0) {
    await guardar(oportunidad, {
      sincronizacion: "pendiente",
      detalleSincronizacion: "Sin cupo en la ventana de una hora; queda para el próximo intento",
    });
    return { estado: "sin_cupo", payload, reintentarEnMinutos: 60 };
  }

  try {
    const resultado = await api.crearCliente(payload);

    await guardar(oportunidad, {
      sincronizacion: resultado.enviado ? "enviado" : "simulado",
      sincronizadoEn: new Date().toISOString(),
      detalleSincronizacion: resultado.avisos.join(" | ") || null,
      // La huella se guarda solo cuando salió de verdad: si fue simulado, el
      // CRM no tiene estos datos y el próximo intento debe reenviarlos.
      huellaSincronizacion: resultado.enviado ? huella : oportunidad.huellaSincronizacion,
    });

    return resultado.enviado
      ? {
          estado: "enviado",
          payload: resultado.payload,
          cuposRestantes: resultado.cuposRestantes,
          avisos: resultado.avisos,
        }
      : { estado: "simulado", payload: resultado.payload, avisos: resultado.avisos };
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    await guardar(oportunidad, { sincronizacion: "error", detalleSincronizacion: detalle });
    return { estado: "error", detalle };
  }
}

async function construirPayload(
  lead: Lead,
  oportunidad: Oportunidad,
  calificacion: Calificacion,
  opciones: OpcionesCrm,
): Promise<ClienteEntrada> {
  const negocio = await tienda().negocioDeLead(lead.id);

  const entrada = aClienteJetBrokers(lead, calificacion, {
    asignarA: opciones.asignarA ?? process.env.JETBROKERS_ASIGNAR_A,
    referidoPor: opciones.referidoPor ?? lead.campana ?? undefined,
    segmento: opciones.segmento ?? calificacion.temperatura,
  });

  // Si hay un cierre abierto, su etapa manda sobre el estado del pipeline
  // comercial: en el CRM interesa más que la operación está en cierre.
  if (negocio) {
    entrada.status = estadoCrmDesdeCierre(negocio.etapa);
  } else {
    entrada.status = oportunidad.estado;
  }

  return entrada;
}

async function guardar(oportunidad: Oportunidad, cambios: Partial<Oportunidad>): Promise<void> {
  await tienda().guardarOportunidad({
    ...oportunidad,
    ...cambios,
    actualizadaEn: new Date().toISOString(),
  });
}

/**
 * Reintenta lo que quedó pendiente por falta de cupo. Pensado para un cron
 * cada hora: manda de a poco y se detiene apenas se acaban los envíos.
 */
export async function reintentarPendientes(limite = 10): Promise<{
  intentados: number;
  enviados: number;
  sinCupo: number;
}> {
  const api = jetBrokersDesdeEntorno();
  if (!api) return { intentados: 0, enviados: 0, sinCupo: 0 };

  const oportunidades = await tienda().listarOportunidades();
  const pendientes = oportunidades
    .filter((opo) => opo.sincronizacion === "pendiente" || opo.sincronizacion === "error")
    .slice(0, limite);

  let enviados = 0;
  let sinCupo = 0;

  for (const oportunidad of pendientes) {
    const resultado = await sincronizarCliente(oportunidad.leadId);
    if (resultado.estado === "enviado") enviados += 1;
    if (resultado.estado === "sin_cupo") {
      sinCupo += 1;
      // No tiene sentido seguir: el cupo es por IP, no por lead.
      break;
    }
  }

  return { intentados: pendientes.length, enviados, sinCupo };
}
