/**
 * Simula una venta y la narra en el terminal.
 *
 *   npm run simular                    la venta completa, de la consulta a la entrega
 *   npm run simular -- --conversacion  solo la conversación con el comprador
 *   npm run simular -- --indeciso      un comprador indeciso, temeroso y lleno de dudas
 *
 * Corre contra la tienda en memoria, así que no toca nada real. Si además
 * defines JETBROKERS_BASE_URL apuntando al simulador, el inventario sale de
 * ahí en vez de los proyectos de demostración.
 */

import { tienda } from "../src/lib/datos";
import { formatearFecha, formatearUf } from "../src/lib/dominio/chile";
import { simularCompradorIndeciso, type Voz } from "../src/lib/simulacion/indeciso";
import { simularVenta, type Actor } from "../src/lib/simulacion/venta";

const ETIQUETA: Record<Actor, string> = {
  comprador: "COMPRADOR",
  agente: "AGENTE   ",
  ejecutivo: "EJECUTIVO",
  banco: "BANCO    ",
  notaria: "NOTARÍA  ",
  cbr: "CBR      ",
  sistema: "SISTEMA  ",
};

function fechaCorta(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Santiago",
  }).format(new Date(iso));
}

/** Imprime la conversación tal como quedó en la ficha del lead. */
async function mostrarConversacion(leadId: string) {
  const mensajes = (await tienda().listarMensajes(leadId)).sort(
    (uno, otro) => uno.enviadoEn.localeCompare(otro.enviadoEn) || uno.id.localeCompare(otro.id),
  );

  console.log("\nCONVERSACIÓN CON EL COMPRADOR");
  console.log("=".repeat(78));

  for (const mensaje of mensajes) {
    const quien = mensaje.direccion === "entrante" ? "COMPRADOR" : "AGENTE";
    const sello = [
      mensaje.canal,
      mensaje.direccion === "saliente" ? mensaje.estado : null,
      mensaje.plantilla ? `plantilla ${mensaje.plantilla}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    console.log(`\n[${quien}] ${formatearFecha(mensaje.enviadoEn)} — ${sello}`);
    if (mensaje.asunto) console.log(`  Asunto: ${mensaje.asunto}`);
    for (const linea of mensaje.cuerpo.split("\n")) {
      console.log(`  ${linea}`);
    }
  }
}

const ETIQUETA_VOZ: Record<Voz, string> = {
  comprador: "COMPRADOR",
  agente: "AGENTE   ",
  ejecutivo: "EJECUTIVO",
  sistema: "SISTEMA  ",
};

/** Narra la conversación con el comprador indeciso. */
async function mostrarIndeciso() {
  const { turnos, resumen } = await simularCompradorIndeciso();

  console.log("\nUN COMPRADOR QUE NO SABE QUÉ QUIERE, TIENE MIEDO Y DUDA DE TODO");
  console.log("=".repeat(78));
  console.log(
    `${resumen.comprador}${resumen.proyecto ? ` · ${resumen.proyecto}` : ""}${
      resumen.techoUf ? ` · el banco le financiaría hasta ${formatearUf(resumen.techoUf)}` : ""
    }`,
  );

  let ultimoDia = -1;
  for (const turno of turnos) {
    if (turno.dia !== ultimoDia) {
      console.log(`\n${"-".repeat(78)}`);
      console.log(`día ${String(turno.dia).padStart(3)} · ${fechaCorta(turno.fecha)}`);
      ultimoDia = turno.dia;
    }
    const sello = [turno.canal, turno.etiquetaObjecion].filter(Boolean).join(" · ");
    console.log(`\n[${ETIQUETA_VOZ[turno.voz]}]${sello ? ` ${sello}` : ""}`);
    for (const linea of turno.texto.split("\n")) console.log(`  ${linea}`);
    if (turno.nota) console.log(`  → ${turno.nota}`);
  }

  console.log("\n" + "=".repeat(78));
  console.log("OBJECIONES QUE APARECIERON");
  for (const objecion of resumen.objeciones) {
    console.log(
      `  ${objecion.etiqueta.padEnd(28)} ${objecion.intentos} ${
        objecion.intentos === 1 ? "vez" : "veces"
      }`,
    );
  }
  console.log("\nRESULTADO");
  console.log(`  Mensajes del agente    ${resumen.mensajesDelAgente}`);
  console.log(`  Pasó a una persona     ${resumen.escalamientos} ${resumen.escalamientos === 1 ? "vez" : "veces"}`);
  console.log(`  Dejó de insistir       ${resumen.seDetuvo ? "sí, a la tercera con el mismo miedo" : "no hizo falta"}`);
  console.log(`\n  ${resumen.desenlace}`);
  console.log(`\n  Lead ${resumen.leadId}`);
  console.log("\n  El agente nunca inventó escasez ni urgencia, no prometió la aprobación del");
  console.log("  crédito y, cuando la unidad quedó sobre lo que el banco le presta, lo dijo.\n");
}

async function principal() {
  const soloConversacion = process.argv.includes("--conversacion");

  if (process.argv.includes("--indeciso")) {
    await mostrarIndeciso();
    return;
  }

  const { pasos, resumen } = await simularVenta();

  if (soloConversacion) {
    await mostrarConversacion(resumen.leadId);
    console.log("");
    return;
  }

  console.log("\nSIMULACIÓN DE UNA VENTA COMPLETA");
  console.log("=".repeat(78));
  console.log(
    `${resumen.comprador} · ${resumen.proyecto}${resumen.unidad ? ` · ${resumen.unidad}` : ""}\n`,
  );

  let ultimoDia = -1;
  for (const paso of pasos) {
    if (paso.dia !== ultimoDia) {
      console.log(`\n  día ${String(paso.dia).padStart(3)} · ${fechaCorta(paso.fecha)}`);
      ultimoDia = paso.dia;
    }
    console.log(`    ${ETIQUETA[paso.actor]}  ${paso.titulo}`);
    console.log(`               ${paso.detalle}`);
  }

  console.log("\n" + "=".repeat(78));
  console.log("RESULTADO");
  console.log(`  Precio                 UF ${resumen.precioUf.toLocaleString("es-CL")}`);
  console.log(`  Comisión               UF ${resumen.comisionUf.toLocaleString("es-CL")}`);
  console.log(`  Duración               ${resumen.diasHabiles} días hábiles`);
  console.log(`  Mensajes del agente    ${resumen.mensajesDelAgente}`);
  console.log(`  Documentos recibidos   ${resumen.documentosRecibidos}`);
  console.log(`  Alertas que evitaron un problema  ${resumen.alertasResueltas}`);
  console.log(`\n  Lead ${resumen.leadId} · Cierre ${resumen.negocioId}`);
  console.log(
    "\n  La calificación, la respuesta y la confirmación de la visita las hizo el",
  );
  console.log("  agente con el mismo código que corre en producción. El banco, la notaría");
  console.log("  y el Conservador están simulados: no tienen API.");
  console.log("\n  Para leer la conversación: npm run simular -- --conversacion");
  console.log("  Para ver un comprador indeciso: npm run simular -- --indeciso\n");
}

principal().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
