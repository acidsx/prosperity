/**
 * Simula una venta completa y la narra en el terminal.
 *
 *   npm run simular
 *
 * Corre contra la tienda en memoria, así que no toca nada real. Si además
 * defines JETBROKERS_BASE_URL apuntando al simulador, el inventario sale de
 * ahí en vez de los proyectos de demostración.
 */

import { tienda } from "../src/lib/datos";
import { formatearFecha } from "../src/lib/dominio/chile";
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

async function principal() {
  const soloConversacion = process.argv.includes("--conversacion");
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
  console.log("\n  Para leer la conversación: npm run simular -- --conversacion\n");
}

principal().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
