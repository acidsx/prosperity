/**
 * Afirmaciones prohibidas: la capa que un prompt comercial no puede apagar.
 *
 * Todas estas salieron de un prompt real de ventas. La prueba no es que el
 * modelo sea prudente — es que el sistema rechace la frase aunque el prompt
 * se la dicte palabra por palabra.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AFIRMACIONES_PROHIBIDAS,
  afirmacionesProhibidasEn,
} from "../src/lib/dominio/afirmaciones";
import { cifrasAVerificar, verificarRespuesta, type FichaDeHechos } from "../src/lib/agente/closer";
import { PROMPTS } from "../src/lib/agente/closer";

const ficha: FichaDeHechos = {
  texto: "Unidad UF 3.592. Dividendo $638.896. Bruta 4,51%. NETA 2,44%. Agenda: 11-09-26, 6:00 p. m.",
  cifras: new Set([3592, 638896, 4.51, 2.44]),
  economia: null,
  plan: null,
  alternativas: [],
};

describe("afirmaciones que ningún prompt puede habilitar", () => {
  const casos: Array<[string, string]> = [
    [
      "Estructuramos vía mutuaria, así la deuda no se informa en el sistema financiero.",
      "mutuaria_no_se_informa",
    ],
    [
      "Todas estas unidades son DFL2, los ingresos por arriendo quedan libres de Impuesto a la Renta.",
      "dfl2_arriendo_sin_impuesto",
    ],
    [
      "Accedes a una devolución de impuestos directa a tu bolsillo en la próxima Operación Renta.",
      "devolucion_directa_impuestos",
    ],
    ["Con FOGAES los bancos están obligados a financiarte hasta el 90%.", "banco_obligado_a_financiar"],
    ["Si postergas esto te va a costar millones.", "urgencia_fabricada"],
    ["Tu capital inmovilizado es casi cero, disparando el Cash on Cash sobre el 12%.", "cash_on_cash_inventado"],
    ["Es un sector con vacancia casi cero.", "vacancia_inventada"],
  ];

  for (const [frase, id] of casos) {
    it(`rechaza: "${frase.slice(0, 46)}…"`, () => {
      const detectadas = afirmacionesProhibidasEn(frase);
      assert.ok(
        detectadas.some((item) => item.afirmacion.id === id),
        `no detectó ${id}`,
      );
    });
  }

  it("cada afirmación trae su norma, su fuente y qué decir en su lugar", () => {
    for (const afirmacion of AFIRMACIONES_PROHIBIDAS) {
      assert.ok(afirmacion.norma.length > 10, `${afirmacion.id} sin norma`);
      assert.ok(afirmacion.fuente.length > 5, `${afirmacion.id} sin fuente`);
      assert.ok(afirmacion.enSuLugar.length > 20, `${afirmacion.id} no dice qué decir en su lugar`);
      assert.ok(afirmacion.porQue.length > 40, `${afirmacion.id} no explica por qué`);
    }
  });

  it("no dispara con la versión correcta de la misma idea", () => {
    const correctas = [
      "Desde abril de 2026 la deuda de una mutuaria se informa igual y el banco la va a ver.",
      "Si es DFL2, las dos primeras viviendas por persona natural tienen el arriendo libre de impuesto; de la tercera en adelante tributa.",
      "Con FOGAES el banco puede financiar hasta el 90% si calificas y queda cupo del fondo.",
      "El cálculo asume un mes de vacancia al año como supuesto, no como medición.",
    ];
    for (const frase of correctas) {
      assert.deepEqual(
        afirmacionesProhibidasEn(frase).map((item) => item.afirmacion.id),
        [],
        `marcó como prohibida una frase correcta: "${frase}"`,
      );
    }
  });
});

describe("el agujero que encontró la prueba del prompt v2.0", () => {
  it("una cifra chica inventada no calza con una hora de la agenda", () => {
    // El defecto: el "6" de las "6:00 p. m." de la ficha autorizaba cualquier
    // número que redondeara a 6, y así pasó un 5,5% de rentabilidad inventado.
    const problemas = verificarRespuesta(
      { mensaje: "La rentabilidad va en 5,5% anual, neta 2,44%. ¿Agendamos?" },
      ficha,
    );
    assert.ok(
      problemas.some((problema) => /5,5 no está en la ficha/.test(problema.detalle)),
      "dejó pasar una rentabilidad inventada",
    );
  });

  it("sigue aceptando el redondeo legítimo de un monto grande", () => {
    // "UF 3.592" donde la ficha dice 3591,8: eso sí es la misma cifra.
    const conDecimales: FichaDeHechos = { ...ficha, cifras: new Set([3591.8, 2.44]) };
    const problemas = verificarRespuesta(
      { mensaje: "La unidad está en UF 3.592. ¿Te la reservo?" },
      conDecimales,
    );
    assert.deepEqual(problemas, []);
  });

  it("las horas del mensaje no se verifican como montos", () => {
    assert.ok(!cifrasAVerificar("Te tomo las 16:00 del viernes").includes(16));
  });
});

describe("versiones del prompt", () => {
  it("las dos existen y ambas llevan el apéndice del sistema", () => {
    assert.match(PROMPTS.v1.sistema, /FICHA DE HECHOS/);
    assert.match(PROMPTS.v2.sistema, /APÉNDICE DEL SISTEMA/);
  });

  it("el v2.0 se guarda literal, con las frases que hay que poder auditar", () => {
    // Si alguien las "arregla" en el prompt, la prueba deja de medir algo.
    assert.match(PROMPTS.v2.sistema, /la deuda no se informa en el sistema financiero/);
    assert.match(PROMPTS.v2.sistema, /Cash on Cash a niveles sobre el 12% anual/);
    assert.match(PROMPTS.v2.sistema, /libres del pago de Impuesto a la Renta/);
    assert.match(PROMPTS.v2.sistema, /posponer la decisión le costará millones/);
  });
});
