/**
 * El registro de beneficios.
 *
 * Es la parte del sistema que más rápido se echa a perder: FOGAES tiene
 * fecha de término, los subsidios abren y cierran por llamado y el crédito
 * de IVA se extingue por ley. Lo que se prueba acá es que nada vencido, ni
 * nada que nadie haya verificado, llegue a una conversación con un cliente.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { incentivos as registro } from "../src/lib/datos/incentivos";
import {
  alertasDeIncentivos,
  DIAS_PARA_REVERIFICAR,
  efectoEnCapacidad,
  estadoDeVigencia,
  incentivosUtilizables,
  resumenParaFicha,
  type Incentivo,
} from "../src/lib/dominio/incentivos";

const HOY = new Date("2026-09-13T12:00:00-03:00");

function incentivo(cambios: Partial<Incentivo> = {}): Incentivo {
  return {
    id: "prueba",
    nombre: "Beneficio de prueba",
    tipo: "garantia_estatal",
    organismo: "Organismo",
    beneficiario: "comprador",
    estado: "vigente",
    resumen: "Financia hasta el 90%.",
    requisitos: ["Primera vivienda"],
    advertencias: ["Sube el dividendo"],
    topeViviendaUf: 4500,
    financiamientoMaximo: 0.9,
    aporteUf: null,
    ahorroMinimoUf: null,
    vigenciaDesde: "2025-06-01",
    vigenciaHasta: "2027-06-30",
    fuente: "https://ejemplo.cl",
    verificadoEn: "2026-09-01",
    confianza: "verificado",
    notas: null,
    ...cambios,
  };
}

describe("vigencia de un beneficio", () => {
  it("vigente cuando está dentro de plazo y verificado hace poco", () => {
    assert.equal(estadoDeVigencia(incentivo(), HOY), "vigente");
  });

  it("vencido cuando pasó su fecha de término", () => {
    assert.equal(estadoDeVigencia(incentivo({ vigenciaHasta: "2026-06-30" }), HOY), "vencido");
  });

  it("por vencer dentro de los dos meses previos: todavía sirve y hay que apurar", () => {
    assert.equal(estadoDeVigencia(incentivo({ vigenciaHasta: "2026-10-15" }), HOY), "por_vencer");
  });

  it("sin verificar cuando nadie leyó la fuente hace demasiado", () => {
    const viejo = new Date(HOY.getTime() - (DIAS_PARA_REVERIFICAR + 10) * 86_400_000);
    assert.equal(
      estadoDeVigencia(incentivo({ verificadoEn: viejo.toISOString().slice(0, 10) }), HOY),
      "sin_verificar",
    );
  });

  it("marcado por confirmar nunca cuenta como verificado", () => {
    assert.equal(estadoDeVigencia(incentivo({ confianza: "por_confirmar" }), HOY), "sin_verificar");
  });

  it("vencido manda sobre sin verificar: no es viejo, se acabó", () => {
    const estado = estadoDeVigencia(
      incentivo({ vigenciaHasta: "2026-01-01", confianza: "por_confirmar" }),
      HOY,
    );
    assert.equal(estado, "vencido");
  });

  it("lo que está en trámite no aplica: todavía no es ley", () => {
    assert.equal(estadoDeVigencia(incentivo({ estado: "en_tramite" }), HOY), "no_aplica");
  });

  it("un beneficio que todavía no empieza no aplica", () => {
    assert.equal(estadoDeVigencia(incentivo({ vigenciaDesde: "2027-01-01" }), HOY), "no_aplica");
  });
});

describe("qué llega al agente", () => {
  it("solo lo vigente y lo que está por vencer", () => {
    const lista = [
      incentivo({ id: "ok" }),
      incentivo({ id: "vence_pronto", vigenciaHasta: "2026-10-15" }),
      incentivo({ id: "vencido", vigenciaHasta: "2020-01-01" }),
      incentivo({ id: "sin_verificar", confianza: "por_confirmar" }),
      incentivo({ id: "en_tramite", estado: "en_tramite" }),
    ];
    const usables = incentivosUtilizables(lista, HOY).map((item) => item.id);
    assert.deepEqual(usables, ["ok", "vence_pronto"]);
  });

  it("cada uno llega con sus requisitos y sus advertencias completas", () => {
    const texto = resumenParaFicha(
      incentivo({ requisitos: ["Uno", "Dos"], advertencias: ["Cuidado con esto"] }),
    );
    assert.match(texto, /Requisitos: Uno · Dos/);
    assert.match(texto, /Advertencias: Cuidado con esto/);
    assert.match(texto, /Fuente: https:\/\/ejemplo\.cl \(verificado 2026-09-01\)/);
  });

  it("un beneficio de la constructora se marca como tal en la ficha", () => {
    const texto = resumenParaFicha(
      incentivo({ tipo: "tributario", beneficiario: "constructora", financiamientoMaximo: null }),
    );
    assert.match(texto, /BENEFICIARIO: la constructora, NO el comprador/);
  });
});

describe("efecto de una garantía estatal", () => {
  it("bajar el pie de 20% a 10% duplica lo que alcanza con el mismo ahorro", () => {
    const efecto = efectoEnCapacidad(incentivo(), 450);
    assert.ok(efecto);
    assert.equal(efecto!.fraccionPie, 0.1);
    // UF 450 al 10% de pie alcanzan para UF 4.500, que además es el tope.
    assert.equal(efecto!.precioMaximoUf, 4500);
  });

  it("nunca propone por sobre el tope del programa", () => {
    const efecto = efectoEnCapacidad(incentivo({ topeViviendaUf: 3000 }), 450);
    assert.equal(efecto!.precioMaximoUf, 3000);
  });

  it("un subsidio no es una garantía: no cambia el financiamiento", () => {
    assert.equal(
      efectoEnCapacidad(incentivo({ tipo: "subsidio", financiamientoMaximo: null }), 450),
      null,
    );
  });
});

describe("alertas para el equipo", () => {
  it("avisa lo vencido, lo que vence pronto y lo que falta verificar", () => {
    const lista = [
      incentivo({ id: "vencido", nombre: "Vencido", vigenciaHasta: "2026-01-01" }),
      incentivo({ id: "pronto", nombre: "Pronto", vigenciaHasta: "2026-10-15" }),
      incentivo({ id: "dudoso", nombre: "Dudoso", confianza: "por_confirmar" }),
      incentivo({ id: "sano", nombre: "Sano" }),
    ];
    const alertas = alertasDeIncentivos(lista, HOY);
    const ids = alertas.map((alerta) => alerta.incentivo.id);

    assert.ok(ids.includes("vencido"));
    assert.ok(ids.includes("pronto"));
    assert.ok(ids.includes("dudoso"));
    assert.ok(!ids.includes("sano"), "alertó de uno que está bien");
    assert.match(alertas.find((a) => a.incentivo.id === "pronto")!.mensaje, /Vence en \d+ días/);
  });
});

describe("el registro que viene con el proyecto", () => {
  const todos = registro();

  it("tiene entradas y todas declaran fuente y fecha de verificación", () => {
    assert.ok(todos.length > 0, "el registro llegó vacío");
    for (const incentivo of todos) {
      assert.match(incentivo.fuente, /^https?:\/\//, `${incentivo.id} sin fuente`);
      assert.match(incentivo.verificadoEn, /^\d{4}-\d{2}-\d{2}$/, `${incentivo.id} sin fecha`);
      assert.ok(incentivo.advertencias.length > 0, `${incentivo.id} no declara advertencias`);
    }
  });

  it("FOGAES está y habilita el 90% con tope de UF 4.500", () => {
    const fogaes = todos.find((item) => item.id === "fogaes_vivienda");
    assert.ok(fogaes, "falta FOGAES en el registro");
    assert.equal(fogaes!.financiamientoMaximo, 0.9);
    assert.equal(fogaes!.topeViviendaUf, 4500);
    assert.equal(fogaes!.beneficiario, "comprador");
    assert.ok(
      fogaes!.advertencias.some((aviso) => /cupo/i.test(aviso)),
      "no advierte que los cupos son limitados",
    );
  });

  it("el crédito de IVA está marcado como beneficio de la constructora", () => {
    const iva = todos.find((item) => item.id === "ceec_iva_construccion");
    assert.ok(iva);
    assert.equal(iva!.beneficiario, "constructora");
    assert.ok(
      iva!.advertencias.some((aviso) => /NUNCA decirle a un comprador/i.test(aviso)),
      "no advierte contra prometerle la devolución al comprador",
    );
  });

  it("lo que no se pudo verificar queda fuera del alcance del agente", () => {
    const usables = incentivosUtilizables(todos, HOY).map((item) => item.id);
    assert.ok(usables.includes("fogaes_vivienda"));
    assert.ok(!usables.includes("ley_iva_vivienda_2026"), "ofreció un proyecto de ley");
    for (const incentivo of todos) {
      if (incentivo.confianza === "por_confirmar") {
        assert.ok(!usables.includes(incentivo.id), `${incentivo.id} llegó al agente sin verificar`);
      }
    }
  });
});
