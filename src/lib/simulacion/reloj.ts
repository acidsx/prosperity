/**
 * Reloj de las simulaciones.
 *
 * Las simulaciones corren hoy pero cuentan algo que pasó hace semanas o
 * meses. El agente sella cada mensaje con la hora real, así que después de
 * cada paso hay que reubicar lo que acaba de escribir en la fecha del guion:
 * si no, la ficha del lead queda con una conversación imposible.
 */

import "server-only";

import { tienda } from "@/lib/datos";
import type { Mensaje } from "@/lib/dominio/tipos";

/** El mismo día si es hábil; si cae fin de semana, el viernes anterior. */
export function ultimoDiaHabil(fecha: Date): Date {
  const resultado = new Date(fecha);
  while (resultado.getDay() === 0 || resultado.getDay() === 6) {
    resultado.setDate(resultado.getDate() - 1);
  }
  return resultado;
}

/**
 * La misma fecha, `dias` días hábiles antes.
 *
 * Parte desde el último día hábil: si se resta desde un sábado, volver a
 * sumar los mismos días hábiles aterriza dos días en el futuro, y la
 * simulación termina con mensajes que todavía no han pasado.
 */
export function restarDiasHabiles(desde: Date, dias: number): Date {
  const fecha = ultimoDiaHabil(desde);
  let restantes = dias;
  while (restantes > 0) {
    fecha.setDate(fecha.getDate() - 1);
    const dia = fecha.getDay();
    if (dia !== 0 && dia !== 6) restantes -= 1;
  }
  return fecha;
}

/**
 * Reescribe la hora de los mensajes que acaba de crear el agente y los
 * devuelve, ya ordenados.
 *
 * Los mensajes nuevos van después del último que ya existía: si se reinicia
 * el reloj en cada paso, la respuesta del comprador termina apareciendo
 * antes del mensaje que está respondiendo.
 */
export async function fecharMensajesNuevos(
  leadId: string,
  antes: Array<{ id: string }>,
  cuando: Date,
): Promise<Mensaje[]> {
  const db = tienda();
  const conocidos = new Set(antes.map((mensaje) => mensaje.id));
  const ahora = await db.listarMensajes(leadId);

  const ultimoConocido = ahora
    .filter((mensaje) => conocidos.has(mensaje.id))
    .reduce((maximo, mensaje) => Math.max(maximo, new Date(mensaje.enviadoEn).getTime()), 0);

  let siguiente = Math.max(cuando.getTime(), ultimoConocido + 3 * 60_000);
  const nuevos: Mensaje[] = [];
  for (const mensaje of ahora) {
    if (conocidos.has(mensaje.id)) continue;
    const enviadoEn = new Date(siguiente).toISOString();
    await db.actualizarMensaje(mensaje.id, { enviadoEn });
    nuevos.push({ ...mensaje, enviadoEn });
    siguiente += 3 * 60_000;
  }

  await db.actualizarLead(leadId, { ultimoEntranteEn: cuando.toISOString() });
  return nuevos;
}
