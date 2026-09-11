/** Traducción entre el modelo del gestor y el del API de JetBrokers. */

import type { Calificacion, Lead, Proyecto } from "@/lib/dominio/tipos";
import type {
  ClienteEntrada,
  ModeloProyecto,
  ProyectoDetalle,
  ProyectoResumen,
} from "@/lib/jetbrokers/tipos";

function aNumero(valor: string | number | null | undefined): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Superficie útil en m². Varios modelos llegan con surfaceInterior en
 * "0.00": en ese caso vale la total, y si tampoco hay, no se muestra.
 */
export function superficieUtil(modelo: ModeloProyecto): number | null {
  const interior = aNumero(modelo.surfaceInterior);
  if (interior && interior > 0) return interior;
  const total = aNumero(modelo.surfaceTotal);
  return total && total > 0 ? total : null;
}

export function desdeResumen(resumen: ProyectoResumen): Proyecto {
  const mejorPrecio = aNumero(resumen.bestPrice);
  return {
    id: resumen.id,
    nombre: resumen.name,
    slug: resumen.slug,
    comuna: resumen.locality ?? "Sin comuna",
    region: null,
    direccion: null,
    desarrollador: resumen.developer,
    etapa: resumen.stage,
    modo: resumen.mode,
    alcance: resumen.scope,
    precioDesdeUf: mejorPrecio,
    precioHastaUf: mejorPrecio,
    reservaClp: aNumero(resumen.reservaCLP),
    feePorcentaje: null,
    entrega: resumen.dateOfDelivery,
    anoEntrega: resumen.yearOfDelivery,
    tags: resumen.tags ?? [],
    modelos: [],
    beneficios: [],
    descripcion: null,
    portadaId: resumen.cover,
    brokerEmail: null,
    brokerNombre: null,
    desdeApi: true,
  };
}

/** Completa un proyecto del buscador con los datos del detalle. */
export function conDetalle(base: Proyecto, detalle: ProyectoDetalle): Proyecto {
  const precios = detalle.models
    .map((modelo) => modelo.priceFinal)
    .filter((precio): precio is number => Number.isFinite(precio));

  return {
    ...base,
    nombre: detalle.name ?? base.nombre,
    slug: detalle.slug ?? base.slug,
    comuna: detalle.locality ?? base.comuna,
    direccion: detalle.address ?? base.direccion,
    desarrollador: detalle.developerName ?? base.desarrollador,
    etapa: detalle.stage ?? base.etapa,
    modo: detalle.mode ?? base.modo,
    alcance: detalle.scope ?? base.alcance,
    precioDesdeUf: aNumero(detalle.apartmentFrom) ?? (precios.length ? Math.min(...precios) : base.precioDesdeUf),
    precioHastaUf: aNumero(detalle.apartmentTo) ?? (precios.length ? Math.max(...precios) : base.precioHastaUf),
    reservaClp: aNumero(detalle.reserveCLP) ?? base.reservaClp,
    feePorcentaje: aNumero(detalle.fee),
    entrega: detalle.dateOfDelivery ?? base.entrega,
    anoEntrega: detalle.yearOfDelivery ?? base.anoEntrega,
    modelos: detalle.models ?? [],
    beneficios: [
      ...(detalle.perks ?? []),
      ...(detalle.perksNearby ?? []),
      ...(detalle.perksCommonAreas ?? []),
    ],
    descripcion: detalle.description ?? base.descripcion,
    portadaId: detalle.coverId ?? base.portadaId,
    brokerEmail: detalle.brokerEmail ?? base.brokerEmail,
    brokerNombre: detalle.brokerName ?? base.brokerNombre,
  };
}

export interface OpcionesCrm {
  /** Email del ejecutivo al que se asigna el cliente. */
  asignarA?: string;
  /** Texto libre; sirve para trazar de qué campaña vino. */
  referidoPor?: string;
  segmento?: string;
}

/**
 * Arma el payload del Customer API a partir del lead y su calificación.
 * Los montos en pesos van como números, que es lo único que acepta la API.
 */
export function aClienteJetBrokers(
  lead: Lead,
  calificacion: Calificacion,
  opciones: OpcionesCrm = {},
): ClienteEntrada {
  const perfil = calificacion.perfil;
  const comentario = [
    `Consulta: ${lead.mensajeInicial}`,
    `Calificación ${calificacion.puntaje}/100 (${calificacion.temperatura}).`,
    calificacion.presupuestoUfEstimado
      ? `Presupuesto estimado UF ${calificacion.presupuestoUfEstimado}.`
      : null,
    calificacion.recomendaciones.length
      ? `Proyectos sugeridos: ${calificacion.recomendaciones.map((item) => item.nombre).join(", ")}.`
      : null,
    calificacion.objeciones.length ? `Objeciones: ${calificacion.objeciones.join("; ")}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const entrada: ClienteEntrada = {
    fullName: lead.nombre,
    email: lead.email ?? undefined,
    mobile: lead.telefono ?? undefined,
    taxId: lead.rut ?? undefined,
    comments: comentario,
    campaign: lead.campana ?? undefined,
    origin: lead.canal,
    marketSegment: opciones.segmento,
    assignedTo: opciones.asignarA,
    referredBy: opciones.referidoPor,
    tags: calificacion.tags.join(","),
    status: calificacion.estadoSugerido,
    sex: lead.sexo ?? undefined,
    comuna: calificacion.comunasInteres[0] ?? lead.comunasInteres[0],
    salary: perfil.rentaClp ?? undefined,
    salaryVariable: perfil.rentaVariableClp ?? undefined,
    salaryType: perfil.tipoRenta ?? undefined,
    hasPartner: perfil.tienePareja ?? undefined,
    partnerSalary: perfil.rentaParejaClp ?? undefined,
    partnerSalaryVariable: perfil.rentaParejaVariableClp ?? undefined,
    partnerSalaryType: perfil.tipoRentaPareja ?? undefined,
    savingsCapacity: perfil.capacidadAhorroClp ?? undefined,
    savingsBalance: perfil.ahorroClp ?? undefined,
    hasBankAccount: perfil.tieneCuentaBancaria ?? undefined,
    hasDicom: perfil.tieneDicom ?? undefined,
    mortgageCount: perfil.creditosHipotecarios ?? undefined,
    mortgageMonthlyPaymentsTotal: perfil.dividendosMensualesClp ?? undefined,
    consumerCreditCount: perfil.creditosConsumo ?? undefined,
    consumerCreditMonthlyPaymentsTotal: perfil.cuotasConsumoMensualesClp ?? undefined,
    aimToInvest: perfil.paraInvertir ?? undefined,
    aimToLive: perfil.paraVivir ?? undefined,
  };

  return entrada;
}
