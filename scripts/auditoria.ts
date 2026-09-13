/**
 * Auditoría de un prompt: qué le hizo decir al modelo y qué se rechazó.
 *
 *   npm run auditoria > mockup/auditoria.json
 *
 * Corre la misma conversación con cada versión del prompt y junta, turno a
 * turno, lo que el verificador objetó. Un prompt no se evalúa leyéndolo.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PROMPTS, type VersionPrompt } from "../src/lib/agente/closer";
import { proveedorGrabado, type Grabacion } from "../src/lib/agente/modelo";
import { AFIRMACIONES_PROHIBIDAS } from "../src/lib/dominio/afirmaciones";
import { tiendaMemoria } from "../src/lib/datos/memoria";
import { ANCLA_GRABACION, simularCloser, type GuionCloser } from "../src/lib/simulacion/closer";

function grabacion(guion: GuionCloser, version: VersionPrompt, crudo: boolean): Grabacion | null {
  const sufijo = version === "v1" ? "" : `-${version}`;
  try {
    return JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "grabaciones",
          `closer-${guion.toLowerCase()}${sufijo}${crudo ? "-crudo" : ""}.json`,
        ),
        "utf8",
      ),
    ) as Grabacion;
  } catch {
    return null;
  }
}

async function principal() {
  const corridas: unknown[] = [];

  for (const version of ["v1", "v2"] as VersionPrompt[]) {
    for (const crudo of [false, true]) {
      for (const guion of ["A", "B"] as GuionCloser[]) {
      const grabada = grabacion(guion, version, crudo);
      if (!grabada) continue;

      await tiendaMemoria.reiniciar({ proyectos: 8, leads: 2, semilla: 2026 });
      const { turnos, resumen } = await simularCloser({
        guion,
        version,
        intervencion: crudo ? "ninguna" : "correccion",
        proveedor: proveedorGrabado(grabada),
        ahora: ANCLA_GRABACION,
      });

      // Lo que el modelo escribió antes de que lo corrigieran: vive en la
      // grabación, en el turno de corrección, y es lo que hay que mostrar.
      const rechazados = grabada.turnos
        .filter((turno) => turno.etiqueta.endsWith(":correccion"))
        .map((turno) => {
          const previo = turno.peticion.mensajes.find((m) => m.rol === "assistant");
          const reproche = turno.peticion.mensajes[turno.peticion.mensajes.length - 1];
          let mensaje = "";
          try {
            mensaje = String(JSON.parse(previo?.contenido ?? "{}").mensaje ?? "");
          } catch {
            mensaje = previo?.contenido ?? "";
          }
          return {
            turno: turno.etiqueta.replace(":correccion", ""),
            mensajeRechazado: mensaje,
            objeciones: reproche?.contenido ?? "",
          };
        });

      corridas.push({
        version,
        nombreVersion: PROMPTS[version].nombre,
        intervencion: crudo ? "ninguna" : "correccion",
        guion,
        turnos,
        resumen,
        rechazados,
      });
      }
    }
  }

  process.stdout.write(
    JSON.stringify({ corridas, afirmaciones: AFIRMACIONES_PROHIBIDAS.map((a) => ({
      id: a.id, afirmacion: a.afirmacion, porQue: a.porQue, norma: a.norma,
      fuente: a.fuente, gravedad: a.gravedad, enSuLugar: a.enSuLugar,
    })) }, null, 2),
  );
}

principal().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
