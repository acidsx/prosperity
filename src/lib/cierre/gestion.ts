/**
 * Control de gestión: cómo va el equipo y qué está haciendo el agente.
 *
 * Las métricas se calculan sobre lo que ya está registrado; no hay un
 * contador aparte que pueda quedar desfasado.
 */

import type { UsuarioPublico } from "@/lib/auth/tipos";
import { alertasDelNegocio, type Alerta } from "@/lib/cierre/negocio";
import { precioFinalUf, type Negocio } from "@/lib/dominio/cierre";
import type { Actividad, Lead, Mensaje, Oportunidad, Visita } from "@/lib/dominio/tipos";

export interface MetricasEjecutivo {
  ejecutivo: UsuarioPublico | null;
  leads: number;
  calificados: number;
  /** Mediana de minutos hasta la primera respuesta. */
  primeraRespuestaMediana: number | null;
  /** Leads sin ninguna respuesta saliente. */
  sinResponder: number;
  visitasAgendadas: number;
  visitasRealizadas: number;
  negociosActivos: number;
  negociosCerrados: number;
  /** Valor de los negocios vivos, en UF. */
  pipelineUf: number;
  comisionProyectadaUf: number;
  comisionCerradaUf: number;
  alertas: number;
}

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 0
    ? Math.round((ordenados[medio - 1] + ordenados[medio]) / 2)
    : ordenados[medio];
}

/** Minutos entre la consulta y la primera respuesta saliente. */
export function minutosPrimeraRespuesta(lead: Lead, mensajes: Mensaje[]): number | null {
  const delLead = mensajes
    .filter((mensaje) => mensaje.leadId === lead.id)
    .sort((a, b) => a.enviadoEn.localeCompare(b.enviadoEn));

  const primeraEntrada = delLead.find((mensaje) => mensaje.direccion === "entrante");
  if (!primeraEntrada) return null;

  const primeraSalida = delLead.find(
    (mensaje) => mensaje.direccion === "saliente" && mensaje.enviadoEn >= primeraEntrada.enviadoEn,
  );
  if (!primeraSalida) return null;

  return Math.round(
    (new Date(primeraSalida.enviadoEn).getTime() - new Date(primeraEntrada.enviadoEn).getTime()) /
      60000,
  );
}

export interface DatosGestion {
  usuarios: UsuarioPublico[];
  leads: Lead[];
  oportunidades: Oportunidad[];
  mensajes: Mensaje[];
  visitas: Visita[];
  negocios: Negocio[];
  ahora?: Date;
}

export function metricasPorEjecutivo(datos: DatosGestion): MetricasEjecutivo[] {
  const ahora = datos.ahora ?? new Date();
  const porLead = new Map(datos.oportunidades.map((opo) => [opo.leadId, opo]));

  const grupos = new Map<string | null, Lead[]>();
  for (const lead of datos.leads) {
    const clave = lead.ejecutivoId ?? null;
    grupos.set(clave, [...(grupos.get(clave) ?? []), lead]);
  }
  // Los ejecutivos sin cartera también aparecen, con ceros.
  for (const usuario of datos.usuarios) {
    if (!grupos.has(usuario.id)) grupos.set(usuario.id, []);
  }

  const filas: MetricasEjecutivo[] = [];

  for (const [ejecutivoId, leads] of grupos) {
    const ejecutivo = datos.usuarios.find((usuario) => usuario.id === ejecutivoId) ?? null;
    const idsLeads = new Set(leads.map((lead) => lead.id));

    const tiempos = leads
      .map((lead) => minutosPrimeraRespuesta(lead, datos.mensajes))
      .filter((valor): valor is number => valor !== null);

    const visitas = datos.visitas.filter((visita) => idsLeads.has(visita.leadId));
    const negocios = datos.negocios.filter((negocio) => idsLeads.has(negocio.leadId));
    const activos = negocios.filter(
      (negocio) => negocio.etapa !== "cerrado" && negocio.etapa !== "caido",
    );
    const cerrados = negocios.filter((negocio) => negocio.etapa === "cerrado");

    filas.push({
      ejecutivo,
      leads: leads.length,
      calificados: leads.filter((lead) => porLead.get(lead.id)?.calificacion).length,
      primeraRespuestaMediana: mediana(tiempos),
      sinResponder: leads.filter((lead) => minutosPrimeraRespuesta(lead, datos.mensajes) === null)
        .length,
      visitasAgendadas: visitas.filter((visita) =>
        ["propuesta", "confirmada"].includes(visita.estado),
      ).length,
      visitasRealizadas: visitas.filter((visita) => visita.estado === "realizada").length,
      negociosActivos: activos.length,
      negociosCerrados: cerrados.length,
      pipelineUf: Math.round(activos.reduce((total, negocio) => total + precioFinalUf(negocio), 0)),
      comisionProyectadaUf:
        Math.round(activos.reduce((total, negocio) => total + (negocio.comisionUf ?? 0), 0) * 10) / 10,
      comisionCerradaUf:
        Math.round(cerrados.reduce((total, negocio) => total + (negocio.comisionUf ?? 0), 0) * 10) / 10,
      alertas: activos.reduce(
        (total, negocio) => total + alertasDelNegocio(negocio, ahora).length,
        0,
      ),
    });
  }

  return filas.sort((a, b) => b.pipelineUf - a.pipelineUf);
}

export interface AuditoriaAgente {
  leadsProcesados: number;
  conModelo: number;
  conHeuristica: number;
  mensajesEnviados: number;
  mensajesSimulados: number;
  enviosBloqueados: number;
  escalamientos: number;
  bajas: number;
  errores: number;
  /** Motivos por los que el agente se detuvo, de más a menos frecuente. */
  motivosDeFreno: Array<{ motivo: string; veces: number }>;
}

/**
 * Qué hizo el agente. Sirve para decidir si darle más autonomía o menos:
 * un agente que escala mucho no está fallando, está pidiendo ayuda.
 */
export function auditoriaDelAgente(
  oportunidades: Oportunidad[],
  mensajes: Mensaje[],
  actividades: Actividad[],
): AuditoriaAgente {
  const calificadas = oportunidades.filter((opo) => opo.calificacion);
  const salientesAutomaticos = mensajes.filter(
    (mensaje) => mensaje.direccion === "saliente" && mensaje.automatico,
  );

  const bloqueos = actividades.filter((actividad) => actividad.tipo === "envio_bloqueado");
  const conteo = new Map<string, number>();
  for (const bloqueo of bloqueos) {
    // El detalle trae el motivo; se agrupa por su primera frase.
    const motivo = bloqueo.detalle.split(/[:.(]/)[0].trim();
    conteo.set(motivo, (conteo.get(motivo) ?? 0) + 1);
  }

  return {
    leadsProcesados: calificadas.length,
    conModelo: calificadas.filter((opo) => opo.calificacion?.motor === "claude").length,
    conHeuristica: calificadas.filter((opo) => opo.calificacion?.motor === "heuristica").length,
    mensajesEnviados: salientesAutomaticos.filter((mensaje) =>
      ["enviado", "entregado", "leido"].includes(mensaje.estado),
    ).length,
    mensajesSimulados: salientesAutomaticos.filter((mensaje) => mensaje.estado === "simulado").length,
    enviosBloqueados: bloqueos.length,
    escalamientos: actividades.filter((actividad) => actividad.tipo === "derivado_a_humano").length,
    bajas: actividades.filter((actividad) => actividad.tipo === "opt_out").length,
    errores: actividades.filter((actividad) => actividad.tipo === "error_agente").length,
    motivosDeFreno: [...conteo.entries()]
      .map(([motivo, veces]) => ({ motivo, veces }))
      .sort((a, b) => b.veces - a.veces),
  };
}

/** Todas las alertas de la cartera, ordenadas por gravedad. */
export function alertasDeLaCartera(negocios: Negocio[], ahora = new Date()): Alerta[] {
  return negocios
    .flatMap((negocio) => alertasDelNegocio(negocio, ahora))
    .sort((a, b) => {
      const orden = { critica: 0, alta: 1, media: 2 };
      return orden[a.gravedad] - orden[b.gravedad] || b.dias - a.dias;
    });
}
