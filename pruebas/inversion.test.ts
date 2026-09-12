/**
 * La aritmética de una cartera de arriendo.
 *
 * Lo que se prueba acá es sobre todo que el sistema no pueda decir la
 * mentira más común del rubro: que la propiedad "se paga sola".
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planDeCartera, unidadesPedidas } from "../src/lib/agente/cartera";
import { detectarObjecion, responderObjecion, type TipoObjecion } from "../src/lib/agente/objeciones";
import {
  arriendoDeMercadoClp,
  economiaUnidad,
  FINANCIAMIENTO_INVERSION,
  pieFaltanteUf,
  planificarCartera,
} from "../src/lib/dominio/inversion";
import type { CapacidadCompra } from "../src/lib/dominio/financiamiento";
import { PERFIL_VACIO, type PerfilFinanciero } from "../src/lib/dominio/tipos";

const UF = 39_000;

function inversionista(cambios: Partial<PerfilFinanciero> = {}): PerfilFinanciero {
  return {
    ...PERFIL_VACIO,
    rentaClp: 4_500_000,
    rentaVariableClp: 1_200_000,
    tipoRenta: "fixed",
    ahorroClp: 70_000_000,
    tieneDicom: false,
    paraInvertir: true,
    paraVivir: false,
    ...cambios,
  };
}

describe("economía de una unidad arrendada", () => {
  it("la segunda propiedad se financia al 70%, no al 80%", () => {
    const primera = economiaUnidad(2500, UF, 1);
    const segunda = economiaUnidad(2500, UF, 2);

    assert.equal(primera.pieUf, 500);
    assert.equal(segunda.pieUf, 750);
    assert.equal(segunda.financiamiento, FINANCIAMIENTO_INVERSION);
  });

  it("el arriendo no cubre el dividendo: el flujo es negativo", () => {
    const unidad = economiaUnidad(2500, UF, 2);
    assert.ok(unidad.flujoMensualClp < 0, "el flujo salió positivo, revisar los supuestos");
    assert.ok(unidad.dividendoClp > unidad.arriendoNetoClp);
  });

  it("la amortización es parte del dividendo y suma con el interés", () => {
    const unidad = economiaUnidad(2500, UF, 2);
    assert.equal(unidad.amortizacionClp + unidad.interesClp, unidad.dividendoClp);
    assert.ok(unidad.amortizacionClp > 0);
    // Descontando la amortización, el costo real es bastante menor.
    assert.ok(Math.abs(unidad.costoRealMensualClp) < Math.abs(unidad.flujoMensualClp));
  });

  it("la rentabilidad neta siempre queda bajo la bruta", () => {
    for (const precio of [1500, 2500, 4000, 7000]) {
      const unidad = economiaUnidad(precio, UF, 2);
      assert.ok(
        unidad.rentabilidadNetaAnual < unidad.rentabilidadBrutaAnual,
        `en UF ${precio} la neta no quedó bajo la bruta`,
      );
      assert.ok(unidad.rentabilidadNetaAnual > 0);
    }
  });

  it("más vacancia baja la rentabilidad neta", () => {
    const normal = economiaUnidad(2500, UF, 2);
    const mala = economiaUnidad(2500, UF, 2, { vacanciaAnual: 3 / 12 });
    assert.ok(mala.rentabilidadNetaAnual < normal.rentabilidadNetaAnual);
  });

  it("el arriendo de mercado sale del retorno de referencia", () => {
    assert.equal(arriendoDeMercadoClp(2000, 40_000), 300_000);
  });
});

describe("dimensionar una cartera", () => {
  it("pide cuatro y le alcanzan menos: el pie por unidad es lo que frena", () => {
    const plan = planificarCartera(inversionista(), 2687, 4, UF);

    assert.ok(plan.unidadesFinanciables < 4, "no debería alcanzarle para las cuatro");
    assert.ok(plan.unidadesFinanciables >= 1);
    assert.notEqual(plan.restriccion, "ninguna");
    assert.ok(plan.pieRequeridoUf <= plan.pieDisponibleUf, "reservó más pie del que tiene");
    assert.ok(plan.dividendoTotalClp <= plan.dividendoMaximoClp, "pasó la carga financiera");
  });

  it("cada dividendo cuenta como deuda para el crédito siguiente", () => {
    // Con pie de sobra, lo que frena tiene que ser la renta.
    const plan = planificarCartera(inversionista({ ahorroClp: 500_000_000 }), 2687, 8, UF);
    assert.equal(plan.restriccion, "renta");
    assert.ok(plan.dividendoTotalClp <= plan.dividendoMaximoClp);

    const unaMas = plan.unidades[0]?.dividendoClp ?? 0;
    assert.ok(
      plan.dividendoTotalClp + unaMas > plan.dividendoMaximoClp,
      "cabía otra unidad y no la tomó",
    );
  });

  it("las deudas vigentes reducen la cartera", () => {
    const sinDeuda = planificarCartera(inversionista(), 2687, 4, UF);
    const conDeuda = planificarCartera(
      inversionista({ dividendosMensualesClp: 900_000 }),
      2687,
      4,
      UF,
    );
    assert.ok(conDeuda.unidadesFinanciables < sinDeuda.unidadesFinanciables);
  });

  it("sin renta o sin ahorro no inventa una cartera", () => {
    assert.equal(planificarCartera({ ...PERFIL_VACIO }, 2687, 4, UF).unidadesFinanciables, 0);
    assert.equal(
      planificarCartera(inversionista({ ahorroClp: null }), 2687, 4, UF).restriccion,
      "sin_datos",
    );
  });

  it("con Dicom no hay cartera que dimensionar", () => {
    const plan = planificarCartera(inversionista({ tieneDicom: true }), 2687, 4, UF);
    assert.equal(plan.unidadesFinanciables, 0);
    assert.match(plan.notas.join(" "), /Dicom/);
  });

  it("dice cuánto pie falta para las unidades que no salieron", () => {
    const plan = planificarCartera(inversionista(), 2687, 4, UF);
    const falta = pieFaltanteUf(plan, 2687);
    assert.ok(falta > 0);
    // 30% del precio por cada unidad que no entró.
    assert.equal(falta, Math.round((4 - plan.unidadesFinanciables) * 2687 * 0.3 * 10) / 10);
  });
});

describe("el mensaje del plan de cartera", () => {
  const base = {
    primerNombre: "Rodrigo",
    perfil: inversionista(),
    precioUnitarioUf: 2687,
    unidadesDeseadas: 4,
    valorUfClp: UF,
    proyecto: "Altamira",
    comuna: "Valparaíso",
  };

  it("dice cuántas salen antes de mostrar ninguna unidad", () => {
    const { texto, ajustaExpectativa, plan } = planDeCartera(base);
    assert.equal(ajustaExpectativa, true);
    assert.match(texto, new RegExp(`pediste 4 departamentos y los números dan para ${plan.unidadesFinanciables}`));
  });

  it("nunca dice que el arriendo paga el dividendo cuando no lo paga", () => {
    const { texto, plan } = planDeCartera(base);
    assert.ok(plan.flujoMensualTotalClp < 0, "el escenario de prueba dejó de tener flujo negativo");
    assert.match(texto, /el arriendo no las paga solas/i);
    assert.doesNotMatch(texto, /se pagan? sol[oa]/i);
  });

  it("muestra la amortización, que es la otra mitad de la verdad", () => {
    const { texto } = planDeCartera(base);
    assert.match(texto, /no son gasto sino capital/i);
    assert.match(texto, /amortizaci[óo]n y la plusval[íi]a/i);
  });

  it("desarma el techo de una sola propiedad cuando lo acaba de mandar", () => {
    const { texto } = planDeCartera({ ...base, topeUnaPropiedadUf: 7485 });
    assert.match(texto, /UF 7\.485 que te acabo de mandar es para UNA propiedad/);
  });

  it("publica la neta junto a la bruta, nunca la bruta sola", () => {
    const { texto } = planDeCartera(base);
    assert.match(texto, /bruta/);
    assert.match(texto, /neta/);
  });
});

describe("cuántas unidades pidió", () => {
  it("lee el número del texto", () => {
    assert.equal(unidadesPedidas("Busco comprar 4 departamentos para arriendo"), 4);
    assert.equal(unidadesPedidas("quiero dos deptos chicos"), 2);
    assert.equal(unidadesPedidas("me interesan tres unidades"), 3);
    assert.equal(unidadesPedidas("un par de departamentos"), 2);
  });

  it("no inventa un número cuando no lo dijo", () => {
    assert.equal(unidadesPedidas("quiero varios departamentos"), null);
    assert.equal(unidadesPedidas("busco un depto para vivir"), 1);
    assert.equal(unidadesPedidas("hola, quiero información"), null);
  });
});

describe("objeciones del inversionista", () => {
  const capacidad: CapacidadCompra = {
    rentaPonderadaClp: 5_100_000,
    dividendoMaximoClp: 1_275_000,
    pieUf: 1794,
    precioMaximoUf: 7485,
    restriccion: "renta",
    notas: [],
  };

  const contexto = {
    primerNombre: "Rodrigo",
    capacidad,
    valorUfClp: UF,
    precioUf: 2687,
    proyecto: "Altamira",
    comuna: "Valparaíso",
    gastosComunesClp: 90_000,
    vecesTratada: 0,
    nombreCorredora: "Corredora Demo",
    paraInvertir: true,
  };

  const casos: Array<[string, TipoObjecion]> = [
    ["¿Y cuánta rentabilidad dan estos departamentos?", "rentabilidad"],
    ["Pero se pagan solos con el arriendo, ¿no?", "se_paga_solo"],
    ["¿Y si no lo arriendo por unos meses?", "vacancia"],
    ["¿Las contribuciones las paga el arrendatario?", "contribuciones"],
    ["El pie es tan alto, pensé que era 20%", "pie_insuficiente"],
  ];

  for (const [texto, esperada] of casos) {
    it(`reconoce "${texto.slice(0, 34)}…" como ${esperada}`, () => {
      assert.equal(detectarObjecion(texto), esperada);
    });
  }

  it("a 'se paga solo' responde que no, con el número", () => {
    const respuesta = responderObjecion("se_paga_solo", contexto);
    assert.match(respuesta.texto, /^No, Rodrigo/);
    assert.match(respuesta.texto, /de tu bolsillo cada mes/i);
    assert.match(respuesta.texto, /capital que pasa a ser tuyo/i);
  });

  it("entrega la rentabilidad neta junto a la bruta", () => {
    const respuesta = responderObjecion("rentabilidad", contexto);
    assert.match(respuesta.texto, /Bruta: \d+,\d+%/);
    assert.match(respuesta.texto, /Neta: \d+,\d+%/);
    assert.match(respuesta.texto, /no una tasación/i);
  });

  it("al inversionista le explica el 70%, no el 80%", () => {
    const respuesta = responderObjecion("pie_insuficiente", contexto);
    assert.match(respuesta.texto, /70%/);
    assert.match(respuesta.texto, /30% de pie en vez de 20%/);
  });

  it("al comprador de primera vivienda le sigue hablando del 80%", () => {
    const respuesta = responderObjecion("pie_insuficiente", { ...contexto, paraInvertir: false });
    assert.match(respuesta.texto, /80%/);
    assert.doesNotMatch(respuesta.texto, /70%/);
  });

  it("la vacancia se cuantifica de cuánto a cuánto, no con adjetivos", () => {
    const respuesta = responderObjecion("vacancia", contexto);
    assert.match(respuesta.texto, /riesgo principal/i);
    assert.match(respuesta.texto, /pasa de \d+,\d+% a \d+,\d+%/);
  });

  it("las contribuciones las paga el dueño y ya están en la neta", () => {
    const respuesta = responderObjecion("contribuciones", contexto);
    assert.match(respuesta.texto, /Las paga el dueño/i);
    assert.match(respuesta.texto, /descontadas en la rentabilidad neta/i);
  });

  it("ninguna respuesta al inversionista promete rentabilidad asegurada", () => {
    for (const tipo of ["rentabilidad", "se_paga_solo", "vacancia", "contribuciones"] as TipoObjecion[]) {
      const respuesta = responderObjecion(tipo, contexto);
      const completo = `${respuesta.texto} ${respuesta.siguientePaso ?? ""}`;
      assert.doesNotMatch(
        completo,
        /rentabilidad (asegurada|garantizada)|arriendo garantizado|retorno seguro|nunca (se )?desocupa/i,
        `${tipo} prometió un retorno`,
      );
    }
  });
});
