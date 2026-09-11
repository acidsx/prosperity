/** Puntaje y estado del pipeline. Determinista: el modelo no decide esto. */

import type { Extraccion } from "@/lib/agente/esquemas";
import type { Candidato } from "@/lib/agente/matching";
import type { CapacidadCompra } from "@/lib/dominio/financiamiento";
import type { Calificacion } from "@/lib/dominio/tipos";
import type { EstadoCliente } from "@/lib/jetbrokers/tipos";

export interface Evaluacion {
  puntaje: number;
  temperatura: Calificacion["temperatura"];
  estadoSugerido: EstadoCliente;
  siguienteAccion: Calificacion["siguienteAccion"];
}

export function evaluar(
  extraccion: Extraccion,
  capacidad: CapacidadCompra,
  candidatos: Candidato[],
  /** Presupuesto efectivo con el que se buscó inventario, en UF. */
  presupuestoUf: number | null = null,
): Evaluacion {
  // Un crédito ya aprobado vale como capacidad demostrada aunque el mensaje
  // no diga la renta: el banco ya evaluó a esta persona.
  const preaprobado = extraccion.creditoPreaprobado === true && (presupuestoUf ?? 0) > 0;

  // Capacidad de pago: hasta 45 puntos.
  let capacidadPuntos = 0;
  if (capacidad.restriccion === "dicom") capacidadPuntos = 0;
  else if (capacidad.restriccion === "contado") capacidadPuntos = 45;
  else if (capacidad.precioMaximoUf !== null && capacidad.restriccion !== "pie") capacidadPuntos = 45;
  else if (capacidad.restriccion === "pie" && capacidad.precioMaximoUf) capacidadPuntos = 22;
  else if (preaprobado) capacidadPuntos = 38;
  else capacidadPuntos = 8;

  // Intención: hasta 25 puntos.
  let intencionPuntos = 0;
  if (extraccion.pideVisita) intencionPuntos += 12;
  if (extraccion.urgencia === "alta") intencionPuntos += 8;
  else if (extraccion.urgencia === "media") intencionPuntos += 4;
  if (extraccion.creditoPreaprobado) intencionPuntos += 10;
  intencionPuntos = Math.min(intencionPuntos, 25);

  // Calce con el inventario: hasta 30 puntos.
  const mejor = candidatos[0]?.puntaje ?? 0;
  const calcePuntos = Math.min(Math.round((mejor / 90) * 30), 30);

  const puntaje = Math.max(0, Math.min(100, capacidadPuntos + intencionPuntos + calcePuntos));

  const temperatura: Calificacion["temperatura"] =
    puntaje >= 65 ? "caliente" : puntaje >= 40 ? "tibio" : "frio";

  let estadoSugerido: EstadoCliente;
  let siguienteAccion: Calificacion["siguienteAccion"];

  if (capacidad.restriccion === "dicom") {
    estadoSugerido = "noQualify";
    siguienteAccion = "nutrir";
  } else if (capacidad.precioMaximoUf === null && !preaprobado) {
    // No alcanza para calificar: hay que pedir renta y ahorro.
    estadoSugerido = "callAgain";
    siguienteAccion = "responder_y_pedir_datos";
  } else if (puntaje >= 45 && extraccion.pideVisita && candidatos.length > 0) {
    estadoSugerido = "scheduled";
    siguienteAccion = "responder_y_agendar";
  } else if (puntaje >= 65) {
    // Buen lead que no pidió visita: lo toma un ejecutivo.
    estadoSugerido = "furtherOn";
    siguienteAccion = "derivar_a_ejecutivo";
  } else if (puntaje >= 40) {
    estadoSugerido = "furtherOn";
    siguienteAccion = "responder_y_pedir_datos";
  } else if (candidatos.length === 0 && capacidad.restriccion === "pie") {
    estadoSugerido = "furtherOn";
    siguienteAccion = "nutrir";
  } else {
    estadoSugerido = "callAgain";
    siguienteAccion = "responder_y_pedir_datos";
  }

  return { puntaje, temperatura, estadoSugerido, siguienteAccion };
}
