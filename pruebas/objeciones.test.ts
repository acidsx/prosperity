/**
 * Persuasión con límites.
 *
 * Lo que se prueba acá no es que el agente convenza, sino dónde se detiene:
 * no insiste más de dos veces, no inventa escasez y, cuando la propiedad
 * está sobre lo que el banco le va a prestar al comprador, lo dice.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  arriendoEstimadoClp,
  detectarObjecion,
  LIMITES_DE_PERSUASION,
  responderObjecion,
  type ContextoObjecion,
  type TipoObjecion,
} from "../src/lib/agente/objeciones";
import type { CapacidadCompra } from "../src/lib/dominio/financiamiento";

const UF_CLP = 40_000;

function capacidad(cambios: Partial<CapacidadCompra> = {}): CapacidadCompra {
  return {
    rentaPonderadaClp: 1_800_000,
    dividendoMaximoClp: 450_000,
    pieUf: 450,
    precioMaximoUf: 2250,
    restriccion: "pie",
    notas: [],
    ...cambios,
  };
}

function contexto(cambios: Partial<ContextoObjecion> = {}): ContextoObjecion {
  return {
    primerNombre: "Sofía",
    capacidad: capacidad(),
    valorUfClp: UF_CLP,
    precioUf: 2000,
    proyecto: "Mirador Alto",
    comuna: "Macul",
    gastosComunesClp: null,
    vecesTratada: 0,
    nombreCorredora: "Corredora Demo",
    ...cambios,
  };
}

describe("detección de objeciones", () => {
  const casos: Array<[string, TipoObjecion]> = [
    ["La verdad no sé bien qué busco, recién estoy empezando a mirar", "no_sabe_que_quiere"],
    ["Me da miedo endeudarme a 25 años, es mucho tiempo", "miedo_deuda"],
    ["¿Y si pierdo la pega en un par de años?", "miedo_cesantia"],
    ["Igual lo encuentro caro, se me va del presupuesto", "precio_alto"],
    ["Y la verdad no tengo el pie completo", "pie_insuficiente"],
    ["Estoy viendo otro proyecto de otra inmobiliaria", "comparando"],
    ["¿Cómo sé que ustedes son serios?", "desconfianza"],
    ["Prefiero esperar a que bajen las tasas", "esperar_mejor_momento"],
    ["Lo voy a pensar y lo converso con mi pareja", "prefiere_pensarlo"],
    ["¿Cuánto son los gastos comunes?", "gastos_comunes"],
  ];

  for (const [texto, esperado] of casos) {
    it(`reconoce "${texto.slice(0, 38)}…" como ${esperado}`, () => {
      assert.equal(detectarObjecion(texto), esperado);
    });
  }

  it("funciona sin tildes: la gente escribe como escribe", () => {
    assert.equal(detectarObjecion("me da miedo endeudarme por 25 anos"), "miedo_deuda");
    assert.equal(detectarObjecion("como se que ustedes son serios"), "desconfianza");
  });

  it("no ve objeciones donde no las hay", () => {
    assert.equal(detectarObjecion("Sí, confirmo la visita del martes"), null);
    assert.equal(detectarObjecion("¿Qué documentos necesito para la preaprobación?"), null);
  });
});

describe("límites de la persuasión", () => {
  it("a la tercera vez con la misma objeción, deja de insistir", () => {
    const primera = responderObjecion("miedo_deuda", contexto({ vecesTratada: 0 }));
    const segunda = responderObjecion("miedo_deuda", contexto({ vecesTratada: 1 }));
    const tercera = responderObjecion("miedo_deuda", contexto({ vecesTratada: 2 }));

    assert.equal(primera.seDetiene, false);
    assert.equal(segunda.seDetiene, false);
    assert.equal(tercera.seDetiene, true);
    assert.equal(tercera.siguientePaso, null);
    assert.match(tercera.texto, /no quiero seguir insistiendo/i);

    // La segunda no repite el mismo párrafo palabra por palabra.
    assert.notEqual(primera.texto, segunda.texto);
  });

  it("nunca inventa escasez ni urgencia", () => {
    const prohibido =
      /queda (solo|solamente) un|[úu]ltima unidad|hay otro interesado|se va a subir el precio|oferta por hoy/i;

    for (const veces of [0, 1, 2]) {
      for (const tipo of [
        "precio_alto",
        "miedo_deuda",
        "miedo_cesantia",
        "esperar_mejor_momento",
        "comparando",
        "no_sabe_que_quiere",
        "desconfianza",
        "gastos_comunes",
        "prefiere_pensarlo",
        "pie_insuficiente",
      ] as TipoObjecion[]) {
        const respuesta = responderObjecion(tipo, contexto({ vecesTratada: veces }));
        const completo = `${respuesta.texto} ${respuesta.siguientePaso ?? ""}`;
        assert.doesNotMatch(completo, prohibido, `${tipo} (intento ${veces + 1}) inventó urgencia`);
        // Y nunca promete lo que decide el banco.
        assert.doesNotMatch(
          completo,
          /te (lo )?van a aprobar|cr[ée]dito asegurado|aprobaci[óo]n garantizada/i,
          `${tipo} prometió la aprobación del crédito`,
        );
      }
    }
  });

  it("si la unidad está sobre lo que le prestan, lo dice en vez de empujar", () => {
    const respuesta = responderObjecion(
      "precio_alto",
      contexto({ precioUf: 3592, capacidad: capacidad({ precioMaximoUf: 2250 }) }),
    );

    assert.match(respuesta.texto, /Tienes raz[óo]n/i);
    assert.match(respuesta.texto, /UF 2\.250/);
    assert.match(respuesta.texto, /UF 3\.592/);
    assert.match(respuesta.texto ?? "", /no te voy a insistir/i);
    assert.match(respuesta.siguientePaso ?? "", /tu rango/i);
  });

  it("el miedo a la cesantía se responde reconociendo el riesgo", () => {
    const respuesta = responderObjecion("miedo_cesantia", contexto());
    assert.match(respuesta.texto, /s[íi] es un riesgo real/i);
    assert.match(respuesta.texto, /seguro de cesant[íi]a/i);
    assert.match(respuesta.texto, /no te voy a decir es que no hay riesgo/i);
  });

  it("la desconfianza la toma una persona", () => {
    const respuesta = responderObjecion("desconfianza", contexto());
    assert.equal(respuesta.escala, true);
    assert.match(respuesta.texto, /Conservador de Bienes Ra[íi]ces/i);
  });

  it("cuando quiere pensarlo, no lo apura", () => {
    const respuesta = responderObjecion("prefiere_pensarlo", contexto());
    assert.match(respuesta.texto, /no te voy a apurar/i);
    assert.equal(respuesta.escala, false);
  });

  it("compara el dividendo con el arriendo de mercado, no con una promesa", () => {
    const arriendo = arriendoEstimadoClp(2000, UF_CLP);
    // 4,5% anual sobre el precio, repartido en doce meses.
    assert.equal(arriendo, 300_000);

    const respuesta = responderObjecion("precio_alto", contexto());
    assert.match(respuesta.texto, /arrendar algo parecido/i);
    assert.match(respuesta.texto, /estimaciones referenciales/i);
  });

  it("los límites están escritos y son revisables", () => {
    assert.ok(LIMITES_DE_PERSUASION.length >= 5);
    assert.ok(LIMITES_DE_PERSUASION.some((limite) => /escasez|urgencia/i.test(limite)));
    assert.ok(LIMITES_DE_PERSUASION.some((limite) => /dos veces/i.test(limite)));
  });
});
