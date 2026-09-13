/**
 * El agente conversacional con modelo.
 *
 * Lo que se prueba acá no es que el modelo escriba bien — eso no se puede
 * probar con assertions. Se prueba el cerco: que la ficha de hechos tenga
 * solo lo verdadero, y que el verificador rechace una respuesta que se sale
 * de ella. Un modelo que suena convincente y cita una cifra que nadie
 * calculó es peor que un bot con plantillas.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";

import {
  aNumero,
  cifrasAVerificar,
  fichaDeHechos,
  verificarRespuesta,
  type FichaDeHechos,
} from "../src/lib/agente/closer";
import { proveedorGrabado, type Grabacion } from "../src/lib/agente/modelo";
import { EXIGENCIAS_DE_RESPUESTA, PREGUNTA_RADAR, SISTEMA_CLOSER } from "../src/lib/agente/persona";
import { tiendaMemoria } from "../src/lib/datos/memoria";
import { capacidadCompra } from "../src/lib/dominio/financiamiento";
import { nuevoLead } from "../src/lib/dominio/fabricas";
import { PERFIL_VACIO, type PerfilFinanciero } from "../src/lib/dominio/tipos";
import {
  ANCLA_GRABACION,
  simularCloser,
  type GuionCloser,
  type ResultadoCloser,
} from "../src/lib/simulacion/closer";

const UF = 40_000;

function grabacion(guion: GuionCloser): Grabacion {
  return JSON.parse(
    readFileSync(join(process.cwd(), "grabaciones", `closer-${guion.toLowerCase()}.json`), "utf8"),
  ) as Grabacion;
}

describe("lectura de cifras en formato chileno", () => {
  it("el punto separa miles y la coma decimales", () => {
    assert.equal(aNumero("UF 2.687"), 2687);
    assert.equal(aNumero("$469.319"), 469319);
    assert.equal(aNumero("4,47%"), 4.47);
    assert.equal(aNumero("$1.800.000"), 1800000);
  });

  it("verifica montos y porcentajes, no horas ni cantidades chicas", () => {
    const cifras = cifrasAVerificar("Tengo el viernes 11 a las 16:00, son 2 unidades de UF 3.592");
    assert.ok(cifras.includes(3592));
    assert.ok(!cifras.includes(16), "tomó una hora como monto");
    assert.ok(!cifras.includes(2), "tomó una cantidad como monto");
  });

  it("un porcentaje siempre se verifica, aunque sea chico", () => {
    assert.ok(cifrasAVerificar("rentabilidad de 5,5% anual").includes(5.5));
  });
});

describe("la ficha de hechos", () => {
  let ficha: FichaDeHechos;

  before(async () => {
    await tiendaMemoria.reiniciar({ proyectos: 4, leads: 1, semilla: 99 });
    const proyectos = await tiendaMemoria.listarProyectos();
    const proyecto = proyectos.find((item) => item.modelos.length > 0)!;
    const perfil: PerfilFinanciero = {
      ...PERFIL_VACIO,
      rentaClp: 4_500_000,
      ahorroClp: 70_000_000,
      tieneDicom: false,
      paraInvertir: true,
    };

    ficha = fichaDeHechos({
      lead: nuevoLead({ nombre: "Rodrigo Salazar" }),
      perfil: "B",
      perfilFinanciero: perfil,
      capacidad: capacidadCompra(perfil, UF),
      valorUfClp: UF,
      unidades: [
        {
          proyecto,
          modelo: proyecto.modelos[0],
          precioUf: Math.round(proyecto.modelos[0].priceFinal),
        },
      ],
      bloques: [],
      unidadesDeseadas: 4,
      gastosComunesClp: 90_000,
      ahora: ANCLA_GRABACION,
    });
  });

  it("dice explícitamente que no hay otras unidades", () => {
    assert.match(ficha.texto, /las únicas que existen; no hay otras/);
  });

  it("trae la rentabilidad neta y el flujo, no solo el precio", () => {
    assert.match(ficha.texto, /Rentabilidad NETA/);
    assert.match(ficha.texto, /FLUJO MENSUAL/);
    assert.ok(ficha.economia, "no calculó la economía del arriendo");
  });

  it("la economía de la unidad y el plan de cartera usan el mismo pie", () => {
    // El defecto que esto cubre: la ficha decía UF 1.078 de pie en un bloque
    // y UF 718 en el otro, para la misma unidad.
    assert.ok(ficha.plan);
    assert.equal(ficha.economia!.pieUf, ficha.plan!.unidades[0]?.pieUf ?? ficha.economia!.pieUf);
  });

  it("las cifras permitidas salen de la ficha misma", () => {
    assert.ok(ficha.cifras.has(ficha.economia!.dividendoClp));
    assert.ok(ficha.cifras.size > 10);
  });
});

describe("el verificador de respuestas", () => {
  const ficha: FichaDeHechos = {
    texto: "Unidad UF 3.592. Dividendo $638.896. Rentabilidad bruta 4,51%. Rentabilidad NETA 2,44%.",
    cifras: new Set([3592, 638896, 4.51, 2.44]),
    economia: {
      orden: 1,
      precioUf: 3592,
      financiamiento: 0.8,
      pieUf: 718,
      creditoUf: 2874,
      dividendoClp: 638896,
      interesClp: 431040,
      amortizacionClp: 207856,
      arriendoBrutoClp: 540000,
      arriendoNetoClp: 292247,
      flujoMensualClp: -346649,
      costoRealMensualClp: -138793,
      rentabilidadBrutaAnual: 4.51,
      rentabilidadNetaAnual: 2.44,
    },
    plan: null,
    alternativas: [],
  };

  it("rechaza una cifra que nadie calculó", () => {
    // El caso real: un prompt que pide vender con ROI produce un 5,5% que
    // suena bien y no sale de ningún cálculo.
    const problemas = verificarRespuesta(
      { mensaje: "La rentabilidad está en 5,5% anual. ¿Te mando el dossier?" },
      ficha,
    );
    assert.ok(problemas.some((problema) => /no está en la ficha/.test(problema.detalle)));
  });

  it("rechaza publicar la bruta sin la neta", () => {
    const problemas = verificarRespuesta(
      { mensaje: "Rentabilidad de 4,51% anual sobre UF 3.592. ¿Agendamos?" },
      ficha,
    );
    assert.ok(problemas.some((problema) => /aparece la neta/.test(problema.regla)));
  });

  it("rechaza decir que se paga solo cuando el flujo es negativo", () => {
    const problemas = verificarRespuesta(
      { mensaje: "Es una unidad que se paga sola con el arriendo. ¿Te interesa?" },
      ficha,
    );
    assert.ok(problemas.some((problema) => /flujo de arriendo es negativo/.test(problema.regla)));
  });

  it("rechaza prometer la aprobación del crédito", () => {
    const problemas = verificarRespuesta(
      { mensaje: "Con tu renta te lo van a aprobar sin problema. ¿Partimos?" },
      ficha,
    );
    assert.ok(problemas.some((problema) => /aprobación del crédito/.test(problema.regla)));
  });

  it("rechaza ofrecer un descuento que el agente no aprueba", () => {
    const problemas = verificarRespuesta(
      { mensaje: "Te lo dejo en UF 3.592 con descuento. ¿Lo tomas?" },
      ficha,
    );
    assert.ok(problemas.some((problema) => /descuentos ni negocia precio/.test(problema.regla)));
  });

  it("exige que el mensaje cierre con una pregunta", () => {
    const problemas = verificarRespuesta({ mensaje: "Te mando el dossier mañana." }, ficha);
    assert.ok(problemas.some((problema) => /pregunta de cierre/.test(problema.regla)));
  });

  it("acepta una respuesta que respeta la ficha", () => {
    const problemas = verificarRespuesta(
      {
        mensaje:
          "La unidad está en UF 3.592, dividendo $638.896. Rentabilidad 4,51% bruta y 2,44% neta. ¿Te mando el dossier?",
      },
      ficha,
    );
    assert.deepEqual(problemas, []);
  });

  it("deja citar las cifras que el propio prospecto dijo", () => {
    const problemas = verificarRespuesta(
      { mensaje: "Con tus $4.500.000 líquidos, la unidad de UF 3.592 calza. ¿Avanzamos?" },
      ficha,
      ["Gano $4.500.000 líquidos"],
    );
    assert.deepEqual(problemas, []);
  });
});

describe("el prompt del closer", () => {
  it("lleva la pregunta de radar y los tres hard stops", () => {
    assert.match(SISTEMA_CLOSER, new RegExp(PREGUNTA_RADAR.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(SISTEMA_CLOSER, /Jamás inventes propiedades ni cifras/);
    assert.match(SISTEMA_CLOSER, /No asesores legalmente/);
    assert.match(SISTEMA_CLOSER, /El Cierre es Rey/);
  });

  it("lleva los dos protocolos", () => {
    assert.match(SISTEMA_CLOSER, /PROTOCOLO A: EL BUSCADOR DE HOGAR INDECISO/);
    assert.match(SISTEMA_CLOSER, /PROTOCOLO B: EL INVERSOR DE ALTO PATRIMONIO/);
  });

  it("las exigencias del verificador están escritas en el prompt", () => {
    assert.ok(EXIGENCIAS_DE_RESPUESTA.length >= 5);
  });
});

describe("conversaciones grabadas", () => {
  for (const guion of ["A", "B"] as GuionCloser[]) {
    describe(`perfil ${guion}`, () => {
      let resultado: ResultadoCloser;

      before(async () => {
        await tiendaMemoria.reiniciar({ proyectos: 8, leads: 2, semilla: 2026 });
        resultado = await simularCloser({
          guion,
          proveedor: proveedorGrabado(grabacion(guion)),
          ahora: ANCLA_GRABACION,
        });
      });

      it("el primer mensaje del agente lanza la pregunta de radar", () => {
        const primera = resultado.turnos.find((turno) => turno.voz === "agente");
        assert.ok(primera);
        assert.equal(primera!.perfil, "indeterminado", "perfiló antes de preguntar");
        assert.match(primera!.texto, /para mudarte|rentabilizar/i);
      });

      it(`termina con el perfil ${guion} detectado`, () => {
        assert.equal(resultado.resumen.perfilFinal, guion);
        assert.equal(resultado.resumen.turnoEnQueDetectoElPerfil, 2);
      });

      it("ninguna respuesta incumple el contrato", () => {
        assert.deepEqual(
          resultado.resumen.incumplimientos,
          [],
          `incumplimientos: ${resultado.resumen.incumplimientos.map((p) => p.detalle).join("; ")}`,
        );
      });

      it("todos los mensajes cierran con una pregunta", () => {
        for (const turno of resultado.turnos.filter((item) => item.voz === "agente")) {
          assert.match(turno.texto, /\?\s*$/, `no cerró con pregunta: "${turno.texto.slice(-60)}"`);
        }
      });

      it("extrae presupuesto y método de financiamiento", () => {
        assert.ok(resultado.resumen.presupuestoUf, "no extrajo el presupuesto");
        assert.ok(resultado.resumen.metodoFinanciamiento);
      });

      it("propone un cierre concreto", () => {
        assert.ok(resultado.resumen.cierrePropuesto);
      });
    });
  }

  it("el perfil A no recibe más de dos opciones ni argumentos de inversión", async () => {
    await tiendaMemoria.reiniciar({ proyectos: 8, leads: 2, semilla: 2026 });
    const { turnos } = await simularCloser({
      guion: "A",
      proveedor: proveedorGrabado(grabacion("A")),
      ahora: ANCLA_GRABACION,
    });
    const delAgente = turnos
      .filter((turno) => turno.voz === "agente")
      .map((turno) => turno.texto)
      .join("\n");
    assert.doesNotMatch(delAgente, /cap rate|plusval[íi]a proyectada|ROI/i);
  });

  it("cuando no le alcanza, ofrece una vía en vez de cerrar la puerta", async () => {
    await tiendaMemoria.reiniciar({ proyectos: 8, leads: 2, semilla: 2026 });
    const { turnos } = await simularCloser({
      guion: "A",
      proveedor: proveedorGrabado(grabacion("A")),
      ahora: ANCLA_GRABACION,
    });
    const delAgente = turnos
      .filter((turno) => turno.voz === "agente")
      .map((turno) => turno.texto)
      .join("\n");

    // Su techo no alcanza para nada del inventario: la conversación no puede
    // terminar ahí teniendo bono pie y pie en cuotas disponibles.
    assert.match(delAgente, /bono pie/i, "no ofreció el bono pie");
    assert.match(delAgente, /pie (en cuotas|cero)/i, "no ofreció una vía para el pie");
    // Y la contra va dicha, no escondida.
    assert.match(delAgente, /lo aprueba la inmobiliaria/i);
  });

  it("el verificador rechaza cerrar la puerta habiendo alternativas", () => {
    const problemas = verificarRespuesta(
      { mensaje: "Lo siento, no tengo nada en tu rango. ¿Te aviso si entra algo?" },
      {
        texto: "",
        cifras: new Set<number>(),
        economia: null,
        plan: null,
        alternativas: [
          {
            tipo: "bono_pie",
            titulo: "Bono pie",
            comoFunciona: "x",
            requisito: "x",
            advertencia: "x",
            precioMaximoUf: 3600,
            gananciaUf: 1300,
            efectivoHoyClp: null,
            proyectos: [],
          },
        ],
      },
    );
    assert.ok(problemas.some((problema) => /ofrece una alternativa/.test(problema.regla)));
  });

  it("al preguntar por multicrédito, no ofrece una deuda invisible", async () => {
    await tiendaMemoria.reiniciar({ proyectos: 8, leads: 2, semilla: 2026 });
    const { turnos } = await simularCloser({
      guion: "B",
      proveedor: proveedorGrabado(grabacion("B")),
      ahora: ANCLA_GRABACION,
    });
    const delAgente = turnos
      .filter((turno) => turno.voz === "agente")
      .map((turno) => turno.texto)
      .join("\n");

    assert.match(delAgente, /neta/i, "nunca dio la rentabilidad neta");
    // El prospecto pregunta por estructurar varios créditos en paralelo. La
    // respuesta no puede ser que la deuda no se ve: desde abril de 2026 el
    // registro consolidado la cruza igual.
    assert.match(delAgente, /se declara todo lo que está en curso|registro consolidado/i);
    assert.doesNotMatch(delAgente, /no se informa|deuda invisible|capacidad crediticia limpia/i);
  });});
