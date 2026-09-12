/**
 * El gestor: toma un lead y lo lleva desde la consulta hasta la visita
 * agendada, dejando todo registrado y sincronizado con el CRM.
 *
 * Orden de trabajo:
 *   1. extrae el perfil del mensaje (modelo, o heurística si no hay)
 *   2. calcula capacidad de compra con reglas de la banca chilena
 *   3. calza contra el inventario de JetBrokers
 *   4. puntúa y decide el estado del pipeline (determinista)
 *   5. redacta la respuesta y propone horarios
 *   6. empuja el cliente al CRM
 */

import "server-only";

import { extraerPerfil, redactarRespuesta, type ContextoRedaccion } from "@/lib/agente/claude";
import type { Extraccion, Redaccion } from "@/lib/agente/esquemas";
import { extraerPerfilHeuristico, redactarRespuestaHeuristica } from "@/lib/agente/heuristica";
import { buscarCandidatos, type Candidato, type Criterios } from "@/lib/agente/matching";
import { evaluar } from "@/lib/agente/puntaje";
import { tienda } from "@/lib/datos";
import { inventario } from "@/lib/datos/inventario";
import { nuevoId } from "@/lib/datos/tienda";
import {
  bloquesDisponibles,
  comisionUf as comisionEstandar,
  formatearFecha,
  valorUf,
} from "@/lib/dominio/chile";
import { nuevaVisita } from "@/lib/dominio/fabricas";
import { capacidadCompra } from "@/lib/dominio/financiamiento";
import type {
  Actividad,
  Calificacion,
  Lead,
  Oportunidad,
  PerfilFinanciero,
  Proyecto,
  TipoActividad,
} from "@/lib/dominio/tipos";
import { canalParaRespuesta, despachar } from "@/lib/mensajeria/despachador";
import { sincronizarCliente } from "@/lib/jetbrokers/sincronizacion";
import { ETIQUETA_ESTADO } from "@/lib/jetbrokers/tipos";

export const FIRMA = process.env.GESTOR_FIRMA ?? "Equipo Comercial";

export interface ResultadoGestion {
  leadId: string;
  calificacion: Calificacion;
  oportunidad: Oportunidad;
  /** Avisos del camino: fallos del modelo, del CRM, datos descartados. */
  avisos: string[];
}

function perfilDesdeExtraccion(extraccion: Extraccion, base: PerfilFinanciero): PerfilFinanciero {
  const preferir = <T,>(nuevo: T | null, actual: T | null): T | null => (nuevo !== null ? nuevo : actual);
  return {
    rentaClp: preferir(extraccion.rentaClp, base.rentaClp),
    rentaVariableClp: preferir(extraccion.rentaVariableClp, base.rentaVariableClp),
    tipoRenta: preferir(extraccion.tipoRenta, base.tipoRenta),
    tienePareja: preferir(extraccion.tienePareja, base.tienePareja),
    rentaParejaClp: preferir(extraccion.rentaParejaClp, base.rentaParejaClp),
    rentaParejaVariableClp: preferir(extraccion.rentaParejaVariableClp, base.rentaParejaVariableClp),
    tipoRentaPareja: preferir(extraccion.tipoRentaPareja, base.tipoRentaPareja),
    capacidadAhorroClp: preferir(extraccion.capacidadAhorroClp, base.capacidadAhorroClp),
    ahorroClp: preferir(extraccion.ahorroClp, base.ahorroClp),
    tieneCuentaBancaria: preferir(extraccion.tieneCuentaBancaria, base.tieneCuentaBancaria),
    tieneDicom: preferir(extraccion.tieneDicom, base.tieneDicom),
    creditosHipotecarios: preferir(extraccion.creditosHipotecarios, base.creditosHipotecarios),
    dividendosMensualesClp: preferir(extraccion.dividendosMensualesClp, base.dividendosMensualesClp),
    creditosConsumo: preferir(extraccion.creditosConsumo, base.creditosConsumo),
    cuotasConsumoMensualesClp: preferir(
      extraccion.cuotasConsumoMensualesClp,
      base.cuotasConsumoMensualesClp,
    ),
    paraInvertir: preferir(extraccion.paraInvertir, base.paraInvertir),
    paraVivir: preferir(extraccion.paraVivir, base.paraVivir),
  };
}

function criterios(lead: Lead, extraccion: Extraccion, presupuestoUf: number | null): Criterios {
  return {
    presupuestoUf,
    comunas: extraccion.comunasInteres.length > 0 ? extraccion.comunasInteres : lead.comunasInteres,
    dormitorios: extraccion.dormitorios,
    banos: extraccion.banos,
    paraInvertir: extraccion.paraInvertir === true,
    necesitaSubsidio: extraccion.postulaSubsidio === true,
    entregaInmediata: extraccion.urgencia === "alta",
    proyectoIdInteres: lead.proyectoIdInteres,
  };
}

function comisionDe(proyecto: Proyecto | undefined, valorUfProyecto: number | null): number | null {
  if (valorUfProyecto === null) return null;
  if (proyecto?.feePorcentaje) {
    return Math.round(valorUfProyecto * (proyecto.feePorcentaje / 100) * 100) / 100;
  }
  return comisionEstandar(valorUfProyecto);
}

async function registrar(
  leadId: string | null,
  tipo: TipoActividad,
  detalle: string,
): Promise<void> {
  const actividad: Actividad = {
    id: nuevoId("act"),
    leadId,
    tipo,
    detalle,
    autor: "agente",
    ocurridaEn: new Date().toISOString(),
  };
  await tienda().registrarActividad(actividad);
}

export async function gestionarLead(leadId: string): Promise<ResultadoGestion> {
  const db = tienda();
  const lead = await db.obtenerLead(leadId);
  if (!lead) throw new Error(`No existe el lead ${leadId}`);

  const avisos: string[] = [];
  const [proyectos, uf] = await Promise.all([inventario(), valorUf()]);
  if (uf.fuente === "fallback") {
    avisos.push("No se pudo leer la UF de mindicador.cl; se usó el valor de respaldo");
  }

  // 1. Extracción del perfil.
  let extraccion: Extraccion;
  let motor: Calificacion["motor"] = "claude";
  try {
    extraccion = await extraerPerfil(lead);
  } catch (error) {
    motor = "heuristica";
    extraccion = extraerPerfilHeuristico(lead);
    avisos.push(
      `Extracción con heurística local: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 2. Capacidad de compra.
  const perfil = perfilDesdeExtraccion(extraccion, lead.perfil);
  const capacidad = capacidadCompra(perfil, uf.valor, {
    pagaContado: extraccion.pagaContado === true,
    postulaSubsidio: extraccion.postulaSubsidio === true,
  });

  // El techo calculado manda por sobre lo que el comprador declara: la
  // banca evalúa con renta y deudas, no con expectativas.
  const presupuestoUf =
    capacidad.precioMaximoUf ?? extraccion.presupuestoUfDeclarado ?? lead.presupuestoUfDeclarado;

  // 3. Calce con el inventario.
  const candidatos: Candidato[] = buscarCandidatos(
    proyectos.filter((proyecto) => proyecto.modelos.length > 0 || proyecto.precioDesdeUf !== null),
    criterios(lead, extraccion, presupuestoUf),
  );

  // 4. Puntaje y estado.
  const evaluacion = evaluar(extraccion, capacidad, candidatos, presupuestoUf);

  // 5. Redacción.
  const horarios = bloquesDisponibles(new Date(), 4);
  const contexto: ContextoRedaccion = {
    lead,
    extraccion,
    capacidad,
    candidatos,
    horarios,
    valorUfClp: uf.valor,
    firma: FIRMA,
  };

  let redaccion: Redaccion;
  if (motor === "claude") {
    try {
      redaccion = await redactarRespuesta(contexto);
    } catch (error) {
      motor = "heuristica";
      redaccion = redactarRespuestaHeuristica(contexto);
      avisos.push(
        `Redacción con plantilla local: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    redaccion = redactarRespuestaHeuristica(contexto);
  }

  const motivoPorProyecto = new Map(redaccion.motivos.map((item) => [item.proyectoId, item.motivo]));

  const calificacion: Calificacion = {
    puntaje: evaluacion.puntaje,
    temperatura: evaluacion.temperatura,
    presupuestoUfEstimado: capacidad.precioMaximoUf,
    pieUfEstimado: capacidad.pieUf || null,
    perfil,
    comunasInteres: extraccion.comunasInteres.length > 0 ? extraccion.comunasInteres : lead.comunasInteres,
    urgencia: extraccion.urgencia,
    recomendaciones: candidatos.map((candidato) => ({
      proyectoId: candidato.proyecto.id,
      nombre: candidato.proyecto.nombre,
      comuna: candidato.proyecto.comuna,
      precioUf: candidato.precioUf,
      modelo: candidato.modelo?.name ?? null,
      motivo: motivoPorProyecto.get(candidato.proyecto.id) ?? candidato.motivos[0] ?? "",
    })),
    objeciones: redaccion.objeciones,
    riesgos: [...redaccion.riesgos, ...capacidad.notas],
    razonamiento: redaccion.razonamiento,
    estadoSugerido: evaluacion.estadoSugerido,
    siguienteAccion: evaluacion.siguienteAccion,
    mensajeRespuesta: redaccion.mensajeRespuesta,
    horariosPropuestos: horarios.slice(0, 2).map((bloque) => bloque.inicio.toISOString()),
    tags: redaccion.tags,
    motor,
    calificadoEn: new Date().toISOString(),
  };

  await db.actualizarLead(lead.id, { perfil });
  await registrar(
    lead.id,
    "lead_calificado",
    `Puntaje ${calificacion.puntaje}/100 (${calificacion.temperatura}), motor ${motor}`,
  );

  // 6. Persistencia de la oportunidad.
  const mejor = candidatos[0];
  const ahora = new Date().toISOString();
  const previa = await db.oportunidadDeLead(lead.id);
  const valorOportunidad = mejor?.precioUf ?? null;

  const oportunidad: Oportunidad = {
    id: previa?.id ?? nuevoId("opo"),
    leadId: lead.id,
    proyectoId: mejor?.proyecto.id ?? lead.proyectoIdInteres,
    modelo: mejor?.modelo?.name ?? null,
    estado: evaluacion.estadoSugerido,
    calificacion,
    valorUf: valorOportunidad,
    comisionUf: comisionDe(mejor?.proyecto, valorOportunidad),
    motivoPerdida: evaluacion.estadoSugerido === "noQualify" ? capacidad.notas[0] ?? null : null,
    sincronizadoEn: previa?.sincronizadoEn ?? null,
    huellaSincronizacion: previa?.huellaSincronizacion ?? null,
    sincronizacion: previa?.sincronizacion ?? "pendiente",
    detalleSincronizacion: previa?.detalleSincronizacion ?? null,
    creadaEn: previa?.creadaEn ?? ahora,
    actualizadaEn: ahora,
  };

  if (previa && previa.estado !== oportunidad.estado) {
    await registrar(
      lead.id,
      "estado_cambiado",
      `De ${ETIQUETA_ESTADO[previa.estado]} a ${ETIQUETA_ESTADO[oportunidad.estado]}`,
    );
  }

  // Envío de la respuesta. Pasa por el despachador para que se apliquen los
  // frenos y la ventana de 24 horas de WhatsApp.
  const canalRespuesta = canalParaRespuesta(lead);
  const despacho = await despachar({
    leadId: lead.id,
    canal: canalRespuesta,
    salida:
      canalRespuesta === "email"
        ? {
            tipo: "correo",
            asunto: mejor
              ? `${mejor.proyecto.nombre}, en ${mejor.proyecto.comuna}`
              : "Sobre tu consulta",
            html: `<p>${calificacion.mensajeRespuesta.replace(/\n/g, "<br>")}</p>`,
            texto: calificacion.mensajeRespuesta,
          }
        : { tipo: "texto", cuerpo: calificacion.mensajeRespuesta },
    // Responder una consulta recién recibida no espera al horario hábil.
    esRespuesta: true,
  });

  if (!despacho.veredicto.permitido) {
    avisos.push(`No se envió la respuesta: ${despacho.veredicto.motivo}`);
  } else if (despacho.resultado && !despacho.resultado.enviado) {
    avisos.push(`Respuesta en simulación: ${despacho.resultado.motivo}`);
  }

  // Visita propuesta cuando corresponde.
  if (evaluacion.siguienteAccion === "responder_y_agendar" && mejor && horarios.length > 0) {
    await db.guardarVisita(
      nuevaVisita({
        leadId: lead.id,
        proyectoId: mejor.proyecto.id,
        inicio: horarios[0].inicio.toISOString(),
        fin: horarios[0].fin.toISOString(),
        notas: `Propuesta automática para ${mejor.proyecto.nombre}`,
        creadaEn: ahora,
      }),
    );
    await registrar(
      lead.id,
      "visita_propuesta",
      `${mejor.proyecto.nombre} - ${formatearFecha(horarios[0].inicio.toISOString())}`,
    );
  }

  if (evaluacion.siguienteAccion === "derivar_a_ejecutivo") {
    await registrar(lead.id, "derivado_a_humano", "Lead caliente: requiere ejecutivo");
  }

  // 7. Sincronización con el CRM. La oportunidad se guarda antes para que
  // el sincronizador lea el estado recién calculado.
  await db.guardarOportunidad(oportunidad);

  const sincronizacion = await sincronizarCliente(lead.id, {
    segmento: calificacion.temperatura,
  });

  switch (sincronizacion.estado) {
    case "enviado":
      avisos.push(...sincronizacion.avisos);
      await registrar(
        lead.id,
        "crm_sincronizado",
        `Cliente creado en JetBrokers (quedan ${sincronizacion.cuposRestantes} envíos en la hora)`,
      );
      break;
    case "simulado":
      avisos.push(...sincronizacion.avisos);
      await registrar(lead.id, "crm_sincronizado", "Simulación: no se llamó al API de JetBrokers");
      break;
    case "sin_cambios":
      break;
    case "sin_cupo":
      avisos.push(
        `Sin cupo en JetBrokers: la sincronización queda pendiente (reintento en ~${sincronizacion.reintentarEnMinutos} min)`,
      );
      await registrar(lead.id, "crm_sincronizado", "Sin cupo: sincronización pendiente");
      break;
    case "sin_configurar":
      avisos.push("JETBROKERS_ORG_ID no está configurado: no se sincronizó con el CRM");
      break;
    case "error":
      avisos.push(`No se pudo sincronizar con JetBrokers: ${sincronizacion.detalle}`);
      await registrar(lead.id, "error_agente", `Fallo de sincronización: ${sincronizacion.detalle}`);
      break;
  }

  // La oportunidad se recarga: el sincronizador le escribió el resultado.
  const guardada = (await db.oportunidadDeLead(lead.id)) ?? oportunidad;

  return { leadId: lead.id, calificacion, oportunidad: guardada, avisos };
}

/** Procesa todos los leads que aún no han sido calificados. */
export async function gestionarPendientes(limite = 20): Promise<ResultadoGestion[]> {
  const db = tienda();
  const [leads, oportunidades] = await Promise.all([db.listarLeads(), db.listarOportunidades()]);
  const calificados = new Set(
    oportunidades.filter((opo) => opo.calificacion !== null).map((opo) => opo.leadId),
  );

  const pendientes = leads.filter((lead) => !calificados.has(lead.id)).slice(0, limite);
  const resultados: ResultadoGestion[] = [];

  // En serie: el POST de clientes de JetBrokers tiene límite por hora y no
  // conviene gastarlo en ráfagas paralelas.
  for (const lead of pendientes) {
    try {
      resultados.push(await gestionarLead(lead.id));
    } catch (error) {
      await registrar(
        lead.id,
        "error_agente",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return resultados;
}
