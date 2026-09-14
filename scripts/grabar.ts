/**
 * Graba las respuestas del closer, turno a turno.
 *
 *   npm run grabar -- A        graba (o continúa grabando) el perfil A
 *   npm run grabar -- B --ver  muestra el prompt del próximo turno sin grabar
 *
 * Con ANTHROPIC_API_KEY definida llama al modelo y va guardando. Sin
 * credenciales, escribe el prompt exacto del próximo turno pendiente en
 * grabaciones/pendiente.txt y se detiene: así se puede revisar qué se le iba
 * a pedir al modelo, o completar la respuesta a mano para una demostración.
 *
 * La grabación guarda la huella del prompt. Si el prompt cambia, reproducir
 * falla en vez de mostrar respuestas que ya no corresponden.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  huellaPeticion,
  proveedorEnVivo,
  type Grabacion,
  type PeticionModelo,
  type ProveedorModelo,
} from "../src/lib/agente/modelo";
import { MODELO } from "../src/lib/agente/claude";
import { tiendaMemoria } from "../src/lib/datos/memoria";
import { simularCloser, type GuionCloser } from "../src/lib/simulacion/closer";

const CARPETA = join(process.cwd(), "grabaciones");

function versionElegida(): "v1" | "v2" | "v25" | "v26" {
  if (process.argv.includes("--v26")) return "v26";
  if (process.argv.includes("--v25")) return "v25";
  return process.argv.includes("--v2") ? "v2" : "v1";
}

function intervencionElegida(): "correccion" | "ninguna" {
  return process.argv.includes("--crudo") ? "ninguna" : "correccion";
}

export function rutaGrabacion(guion: GuionCloser, version = versionElegida()): string {
  const sufijo = version === "v1" ? "" : `-${version}`;
  const crudo = intervencionElegida() === "ninguna" ? "-crudo" : "";
  return join(CARPETA, `closer-${guion.toLowerCase()}${sufijo}${crudo}.json`);
}

function leer(guion: GuionCloser): Grabacion {
  try {
    return JSON.parse(readFileSync(rutaGrabacion(guion), "utf8")) as Grabacion;
  } catch {
    return { modelo: MODELO, grabadaEn: new Date().toISOString(), turnos: [] };
  }
}

function guardar(guion: GuionCloser, grabacion: Grabacion): void {
  mkdirSync(CARPETA, { recursive: true });
  writeFileSync(rutaGrabacion(guion), `${JSON.stringify(grabacion, null, 2)}\n`);
}

class TurnoPendiente extends Error {
  constructor(readonly peticion: PeticionModelo) {
    super("__pendiente__");
  }
}

/**
 * Reproduce lo grabado y se detiene en el primer turno que falta.
 *
 * Si hay credenciales, en vez de detenerse lo pide al modelo y lo agrega.
 */
function proveedorQueContinua(
  grabacion: Grabacion,
  enVivo: ProveedorModelo | null,
  /**
   * Respuesta escrita a mano para el primer turno pendiente.
   *
   * Existe para poder armar una demostración sin credenciales: se revisa el
   * prompt, se escribe la respuesta y se graba. Queda marcada como grabación,
   * nunca como salida del modelo en vivo.
   */
  respuestaManual: string | null,
): ProveedorModelo {
  let indice = 0;
  let manualUsada = false;

  return {
    enVivo: enVivo !== null,
    async generar(peticion) {
      const grabado = grabacion.turnos[indice];
      const huella = huellaPeticion(peticion);

      if (grabado) {
        if (grabado.huella !== huella) {
          throw new Error(
            `El turno ${indice + 1} ("${peticion.etiqueta}") cambió de prompt desde que se grabó. ` +
              `Borra grabaciones/ desde ese turno y vuelve a grabar.`,
          );
        }
        indice += 1;
        return { texto: grabado.respuesta, origen: "grabacion" };
      }

      if (!enVivo) {
        if (respuestaManual !== null && !manualUsada) {
          manualUsada = true;
          grabacion.turnos.push({
            etiqueta: peticion.etiqueta,
            huella,
            peticion,
            respuesta: respuestaManual,
          });
          indice += 1;
          return { texto: respuestaManual, origen: "grabacion" };
        }
        throw new TurnoPendiente(peticion);
      }

      const respuesta = await enVivo.generar(peticion);
      grabacion.turnos.push({
        etiqueta: peticion.etiqueta,
        huella,
        peticion,
        respuesta: respuesta.texto,
      });
      indice += 1;
      return respuesta;
    },
  };
}

async function principal() {
  const guion = (process.argv.find((arg) => arg === "A" || arg === "B" || arg === "C") ?? "A") as GuionCloser;
  const grabacion = leer(guion);
  const enVivo = proveedorEnVivo();

  // Respuesta a mano para el turno pendiente, si se dejó preparada.
  const archivoRespuesta = join(CARPETA, "respuesta.txt");
  const respuestaManual =
    process.argv.includes("--responder") && existsSync(archivoRespuesta)
      ? readFileSync(archivoRespuesta, "utf8").trim()
      : null;

  await tiendaMemoria.reiniciar({ proyectos: 8, leads: 2, semilla: 2026 });

  try {
    const { resumen } = await simularCloser({
      guion,
      version: versionElegida(),
      intervencion: intervencionElegida(),
      proveedor: proveedorQueContinua(grabacion, enVivo, respuestaManual),
    });
    guardar(guion, grabacion);
    if (respuestaManual !== null) rmSync(archivoRespuesta, { force: true });
    console.log(
      `\nGrabación del perfil ${guion} (${resumen.nombreVersion}) completa: ${grabacion.turnos.length} turnos (${resumen.origen}).`,
    );
    console.log(`  ${rutaGrabacion(guion)}\n`);
  } catch (error) {
    if (!(error instanceof TurnoPendiente)) throw error;

    guardar(guion, grabacion);
    if (respuestaManual !== null) rmSync(archivoRespuesta, { force: true });
    const destino = join(CARPETA, "pendiente.txt");
    const { peticion } = error;
    mkdirSync(CARPETA, { recursive: true });
    writeFileSync(
      destino,
      [
        `TURNO PENDIENTE: ${peticion.etiqueta}`,
        `HUELLA: ${huellaPeticion(peticion)}`,
        `TURNOS YA GRABADOS: ${grabacion.turnos.length}`,
        "",
        "=== SYSTEM ===",
        peticion.sistema,
        "",
        ...peticion.mensajes.flatMap((mensaje) => [
          `=== ${mensaje.rol.toUpperCase()} ===`,
          mensaje.contenido,
          "",
        ]),
      ].join("\n"),
    );

    console.log(`\nFalta el turno ${grabacion.turnos.length + 1} del perfil ${guion} (${versionElegida()}).`);
    console.log(`Sin ANTHROPIC_API_KEY no se puede pedir al modelo.`);
    console.log(`El prompt exacto quedó en ${destino}\n`);
    process.exitCode = 2;
  }
}

principal().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
