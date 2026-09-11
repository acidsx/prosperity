/**
 * Origen del inventario: JetBrokers si está configurado, datos de
 * demostración si no.
 */

import "server-only";

import { tienda } from "@/lib/datos";
import { generarProyectos } from "@/lib/datos/generador";
import type { Proyecto } from "@/lib/dominio/tipos";
import { jetBrokersDesdeEntorno, type JetBrokers } from "@/lib/jetbrokers/cliente";
import { conDetalle, desdeResumen } from "@/lib/jetbrokers/mapeo";
import type { BusquedaProyectos } from "@/lib/jetbrokers/tipos";

export interface ResultadoSincronizacion {
  origen: "jetbrokers" | "demo";
  proyectos: number;
  conDetalle: number;
  advertencias: string[];
}

/** Trae el detalle de a pocos para no golpear el API con ráfagas. */
async function enLotes<T, R>(
  items: T[],
  tamano: number,
  tarea: (item: T) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const resultados: Array<PromiseSettledResult<R>> = [];
  for (let i = 0; i < items.length; i += tamano) {
    const lote = items.slice(i, i + tamano);
    resultados.push(...(await Promise.allSettled(lote.map(tarea))));
  }
  return resultados;
}

export async function sincronizarInventario(
  filtros: BusquedaProyectos = {},
  clienteApi?: JetBrokers | null,
): Promise<ResultadoSincronizacion> {
  const api = clienteApi ?? jetBrokersDesdeEntorno();
  const advertencias: string[] = [];

  if (!api) {
    const demo = generarProyectos(18);
    await tienda().guardarProyectos(demo);
    return {
      origen: "demo",
      proyectos: demo.length,
      conDetalle: demo.length,
      advertencias: ["JETBROKERS_ORG_ID no está configurado: se usó inventario de demostración"],
    };
  }

  const resumenes = await api.buscarProyectos(filtros);
  const base = resumenes.map(desdeResumen);

  // El buscador entrega solo el mejor precio; las tipologías y el monto de
  // reserva vienen en el detalle, y sin eso no se puede recomendar bien.
  const detalles = await enLotes(base, 4, async (proyecto) => {
    const detalle = await api.detalleProyecto(proyecto.id);
    return conDetalle(proyecto, detalle);
  });

  const proyectos: Proyecto[] = detalles.map((resultado, indice) => {
    if (resultado.status === "fulfilled") return resultado.value;
    advertencias.push(
      `No se pudo leer el detalle de ${base[indice].nombre}: ${
        resultado.reason instanceof Error ? resultado.reason.message : String(resultado.reason)
      }`,
    );
    return base[indice];
  });

  await tienda().guardarProyectos(proyectos);

  return {
    origen: "jetbrokers",
    proyectos: proyectos.length,
    conDetalle: detalles.filter((resultado) => resultado.status === "fulfilled").length,
    advertencias,
  };
}

/**
 * Inventario actual. Sincroniza si está vacío, y también cuando hay CRM
 * configurado pero lo cargado todavía es el inventario de demostración: los
 * datos reales siempre mandan sobre los sintéticos.
 */
export async function inventario(): Promise<Proyecto[]> {
  const actual = await tienda().listarProyectos();
  const hayCrm = Boolean(process.env.JETBROKERS_ORG_ID);
  const esReal = actual.some((proyecto) => proyecto.desdeApi);

  if (actual.length > 0 && (!hayCrm || esReal)) return actual;

  await sincronizarInventario();
  return tienda().listarProyectos();
}
