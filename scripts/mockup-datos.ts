/**
 * Vuelca las dos conversaciones del closer a JSON, para el mockup.
 *
 *   npm run mockup-datos > mockup/datos.json
 *
 * Sale de la misma simulación que corre en las pruebas: el mockup muestra lo
 * que el sistema produce, no una maqueta escrita aparte.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { proveedorGrabado, type Grabacion } from "../src/lib/agente/modelo";
import { tiendaMemoria } from "../src/lib/datos/memoria";
import { ANCLA_GRABACION, simularCloser, type GuionCloser } from "../src/lib/simulacion/closer";

function grabacion(guion: GuionCloser): Grabacion {
  return JSON.parse(
    readFileSync(join(process.cwd(), "grabaciones", `closer-${guion.toLowerCase()}.json`), "utf8"),
  ) as Grabacion;
}

async function principal() {
  const salida: Record<string, unknown> = {};

  for (const guion of ["A", "B"] as GuionCloser[]) {
    await tiendaMemoria.reiniciar({ proyectos: 8, leads: 2, semilla: 2026 });
    const { turnos, resumen } = await simularCloser({
      guion,
      proveedor: proveedorGrabado(grabacion(guion)),
      ahora: ANCLA_GRABACION,
    });
    // La ficha de cada turno, tal como se le pasó al modelo.
    const fichas = grabacion(guion).turnos.map((turno) => {
      const contenido = turno.peticion.mensajes[0]?.contenido ?? "";
      const inicio = contenido.indexOf("## FICHA DE HECHOS");
      const fin = contenido.indexOf("## CONVERSACIÓN HASTA AHORA");
      return contenido.slice(inicio, fin).replace("## FICHA DE HECHOS\n", "").trim();
    });
    salida[guion] = { turnos, resumen, fichas };
  }

  process.stdout.write(JSON.stringify(salida, null, 2));
}

principal().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
