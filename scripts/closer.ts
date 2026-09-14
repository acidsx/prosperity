/**
 * Reproduce una conversación del closer y la narra.
 *
 *   npm run closer -- A     el buscador de hogar indeciso
 *   npm run closer -- B     el inversor de alto patrimonio
 *
 * Con ANTHROPIC_API_KEY definida corre contra el modelo en vivo. Sin
 * credenciales reproduce la grabación de `grabaciones/`, y lo dice: una
 * demostración grabada no es una corrida en vivo y confundirlas es la forma
 * más fácil de creerle a un agente más de lo que corresponde.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { proveedorEnVivo, proveedorGrabado, type Grabacion } from "../src/lib/agente/modelo";
import { tiendaMemoria } from "../src/lib/datos/memoria";
import { ANCLA_GRABACION, simularCloser, type GuionCloser } from "../src/lib/simulacion/closer";

function grabacion(guion: GuionCloser, version: "v1" | "v2" | "v25" | "v26", crudo: boolean): Grabacion {
  const sufijo = version === "v1" ? "" : `-${version}`;
  const ruta = join(
    process.cwd(),
    "grabaciones",
    `closer-${guion.toLowerCase()}${sufijo}${crudo ? "-crudo" : ""}.json`,
  );
  return JSON.parse(readFileSync(ruta, "utf8")) as Grabacion;
}

function envolver(texto: string, ancho = 74, sangria = "  "): string {
  const lineas: string[] = [];
  for (const parrafo of texto.split("\n")) {
    let actual = "";
    for (const palabra of parrafo.split(" ")) {
      if ((actual + palabra).length > ancho) {
        lineas.push(sangria + actual.trimEnd());
        actual = "";
      }
      actual += `${palabra} `;
    }
    lineas.push(sangria + actual.trimEnd());
  }
  return lineas.join("\n");
}

async function principal() {
  const guion = (process.argv.find((arg) => arg === "A" || arg === "B" || arg === "C") ?? "A") as GuionCloser;
  const version = process.argv.includes("--v26")
    ? ("v26" as const)
    : process.argv.includes("--v25")
      ? ("v25" as const)
    : process.argv.includes("--v2")
      ? ("v2" as const)
      : ("v1" as const);
  const crudo = process.argv.includes("--crudo");
  const vivo = proveedorEnVivo();

  await tiendaMemoria.reiniciar({ proyectos: 8, leads: 2, semilla: 2026 });

  const { turnos, resumen } = await simularCloser({
    guion,
    version,
    intervencion: crudo ? "ninguna" : "correccion",
    proveedor: vivo ?? proveedorGrabado(grabacion(guion, version, crudo)),
    ahora: vivo ? new Date() : ANCLA_GRABACION,
  });

  console.log(`\nCLOSER ${resumen.nombreVersion.toUpperCase()} · PERFIL ${guion} — ${resumen.etiquetaPerfil.toUpperCase()}`);
  if (resumen.intervencion === "ninguna") {
    console.log("Prompt literal, sin apéndice del sistema. La salida va tal cual: la\nverificación solo anota, no corrige.");
  }
  console.log("=".repeat(78));
  console.log(
    resumen.origen === "modelo"
      ? "Respuestas generadas por el modelo en esta corrida."
      : "Respuestas REPRODUCIDAS de una grabación. El prompt y la ficha son los reales;\nlas respuestas se grabaron antes. Con ANTHROPIC_API_KEY corre en vivo.",
  );

  for (const turno of turnos) {
    const quien = turno.voz === "prospecto" ? "PROSPECTO" : turno.voz === "agente" ? "AGENTE   " : "SISTEMA  ";
    console.log(`\n${"-".repeat(78)}`);
    console.log(
      `[${quien}] día ${turno.dia}${turno.canal ? ` · ${turno.canal}` : ""}${
        turno.voz === "agente" && turno.perfil ? ` · perfil ${turno.perfil}` : ""
      }`,
    );
    console.log(envolver(turno.texto));
    if (turno.nota) console.log(`  → ${turno.nota}`);
    if (turno.reintentos > 0) {
      console.log(`  ⟲ El verificador rechazó la primera versión y el modelo la corrigió.`);
    }
    for (const problema of turno.problemas) {
      console.log(`  ⚠ ${problema.regla}: ${problema.detalle}`);
      if (problema.norma) console.log(`    Norma: ${problema.norma}`);
      if (problema.enSuLugar) console.log(`    En su lugar: ${problema.enSuLugar}`);
    }
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log("LO QUE EL AGENTE EXTRAJO (la métrica del prompt)");
  console.log(`  Perfil                 ${resumen.perfilFinal} · ${resumen.etiquetaPerfil}`);
  console.log(`  Detectado en el turno  ${resumen.turnoEnQueDetectoElPerfil ?? "no lo detectó"}`);
  console.log(`  Presupuesto            ${resumen.presupuestoUf ? `UF ${resumen.presupuestoUf.toLocaleString("es-CL")}` : "no extraído"}`);
  console.log(`  Plazo de compra        ${resumen.plazoCompra ?? "no extraído"}`);
  console.log(`  Financiamiento         ${resumen.metodoFinanciamiento ?? "no extraído"}`);
  console.log(`  Cierre propuesto       ${resumen.cierrePropuesto ?? "ninguno"}`);
  console.log(`  ¿Agendó?               ${resumen.agendo ? "sí" : "no"}`);
  console.log(`\nVERIFICACIÓN DE LO QUE ESCRIBIÓ`);
  console.log(`  Mensajes del agente    ${resumen.mensajesDelAgente}`);
  console.log(`  Correcciones forzadas  ${resumen.correcciones}`);
  console.log(
    `  Incumplimientos        ${resumen.incumplimientos.length === 0 ? "ninguno" : resumen.incumplimientos.length}`,
  );
  for (const problema of resumen.incumplimientos) {
    console.log(`    - ${problema.regla}: ${problema.detalle}`);
    if (problema.norma) console.log(`      Norma: ${problema.norma}`);
  }
  console.log("");
}

principal().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
