/**
 * Estado del registro de beneficios.
 *
 *   npm run incentivos          qué está vigente y qué hay que revisar
 *   npm run incentivos -- --ficha   cómo lo ve el agente
 *
 * Este comando existe para que alguien lo corra una vez por semana. FOGAES
 * tiene fecha de término, los subsidios abren y cierran por llamado, y el
 * crédito de IVA se extingue por ley: lo que hoy es un argumento de venta
 * en tres meses puede ser una promesa que la corredora no puede cumplir.
 */

import { incentivos } from "../src/lib/datos/incentivos";
import {
  alertasDeIncentivos,
  efectoEnCapacidad,
  estadoDeVigencia,
  incentivosUtilizables,
  resumenParaFicha,
  type EstadoVigencia,
} from "../src/lib/dominio/incentivos";
import { formatearUf } from "../src/lib/dominio/chile";

const MARCA: Record<EstadoVigencia, string> = {
  vigente: "✓ VIGENTE     ",
  por_vencer: "! POR VENCER  ",
  vencido: "✗ VENCIDO     ",
  sin_verificar: "? SIN VERIFICAR",
  no_aplica: "· NO APLICA   ",
};

function principal() {
  const hoy = new Date();
  const todos = incentivos();

  if (todos.length === 0) {
    console.log("\nNo hay registro de incentivos. El agente no ofrecerá ningún beneficio.");
    console.log("Se espera un archivo en datos/incentivos.json\n");
    return;
  }

  if (process.argv.includes("--ficha")) {
    const utilizables = incentivosUtilizables(todos, hoy);
    console.log("\nLO QUE EL AGENTE RECIBE EN LA FICHA DE HECHOS");
    console.log("=".repeat(78));
    for (const [indice, incentivo] of utilizables.entries()) {
      console.log(`\n${indice + 1}. ${resumenParaFicha(incentivo)}`);
    }
    console.log(
      `\n${todos.length - utilizables.length} de ${todos.length} quedaron fuera por vigencia o por falta de verificación.\n`,
    );
    return;
  }

  console.log("\nREGISTRO DE BENEFICIOS");
  console.log("=".repeat(78));

  for (const incentivo of todos) {
    const estado = estadoDeVigencia(incentivo, hoy);
    console.log(`\n${MARCA[estado]} ${incentivo.nombre}`);
    console.log(`               ${incentivo.organismo} · beneficiario: ${incentivo.beneficiario}`);
    console.log(
      `               vigencia ${incentivo.vigenciaDesde ?? "—"} a ${incentivo.vigenciaHasta ?? "sin término declarado"} · verificado ${incentivo.verificadoEn} · ${incentivo.confianza}`,
    );
    console.log(`               ${incentivo.fuente}`);

    // El efecto concreto sobre alguien con un pie de UF 450, para que se vea
    // qué significa el beneficio en la práctica.
    const efecto = efectoEnCapacidad(incentivo, 450);
    if (efecto) {
      console.log(
        `               Con UF 450 de pie: financia ${Math.round(efecto.financiamiento * 100)}% y habilita hasta ${formatearUf(efecto.precioMaximoUf ?? 0)} (sin garantía serían UF 2.250)`,
      );
    }
  }

  const alertas = alertasDeIncentivos(todos, hoy);
  console.log(`\n${"=".repeat(78)}`);
  console.log("LO QUE HAY QUE REVISAR");
  if (alertas.length === 0) {
    console.log("  Nada: todo vigente y verificado.");
  }
  for (const alerta of alertas) {
    console.log(`\n  ${alerta.incentivo.nombre}`);
    console.log(`    ${alerta.mensaje}`);
    if (alerta.incentivo.notas) console.log(`    Nota: ${alerta.incentivo.notas}`);
  }

  const utilizables = incentivosUtilizables(todos, hoy);
  console.log(`\n${"=".repeat(78)}`);
  console.log(
    `El agente puede usar ${utilizables.length} de ${todos.length}. El resto no llega a ninguna conversación.`,
  );
  console.log(
    "\nPara actualizar: edita datos/incentivos.json, sube verificadoEn a la fecha de hoy y\ncambia confianza a \"verificado\" solo si leíste la fuente.\n",
  );
}

principal();
