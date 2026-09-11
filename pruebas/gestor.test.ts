/** Pruebas de la lógica de calificación: finanzas, calce y estados. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Extraccion } from "../src/lib/agente/esquemas";
import { extraerPerfilHeuristico } from "../src/lib/agente/heuristica";
import { buscarCandidatos } from "../src/lib/agente/matching";
import { evaluar } from "../src/lib/agente/puntaje";
import { generarProyectos } from "../src/lib/datos/generador";
import { comisionUf, digitoVerificador, dividendoUf, rutEsValido } from "../src/lib/dominio/chile";
import { capacidadCompra } from "../src/lib/dominio/financiamiento";
import { PERFIL_VACIO, type Lead, type PerfilFinanciero, type Proyecto } from "../src/lib/dominio/tipos";
import { aClienteJetBrokers } from "../src/lib/jetbrokers/mapeo";
import { validarCliente } from "../src/lib/jetbrokers/validacion";

const UF = 40_000;

function perfil(cambios: Partial<PerfilFinanciero>): PerfilFinanciero {
  return { ...PERFIL_VACIO, ...cambios };
}

function lead(cambios: Partial<Lead> = {}): Lead {
  return {
    id: "lead_001",
    nombre: "Camila Fuentes",
    email: "camila@gmail.com",
    telefono: "+56912345678",
    rut: null,
    canal: "portal_inmobiliario",
    campana: null,
    proyectoIdInteres: null,
    mensajeInicial: "Hola",
    comunasInteres: ["Ñuñoa"],
    presupuestoUfDeclarado: null,
    sexo: null,
    perfil: { ...PERFIL_VACIO },
    creadoEn: new Date().toISOString(),
    ...cambios,
  };
}

describe("utilidades chilenas", () => {
  it("calcula el dígito verificador del RUT", () => {
    // Casos conocidos de módulo 11, incluyendo el dígito K.
    assert.equal(digitoVerificador(12345678), "5");
    assert.equal(digitoVerificador(11111111), "1");
    assert.ok(rutEsValido("12.345.678-5"));
    assert.ok(!rutEsValido("12.345.678-9"));
  });

  it("calcula el dividendo de un crédito en UF", () => {
    // UF 2.000 de crédito a 25 años y 4,5% anual: ~UF 11 mensuales.
    const dividendo = dividendoUf(2500, 500);
    assert.ok(dividendo > 10 && dividendo < 12, `dividendo fuera de rango: ${dividendo}`);
  });

  it("calcula la comisión del corredor con IVA", () => {
    // 2% + 19% de IVA sobre UF 3.000.
    assert.equal(comisionUf(3000), 71.4);
  });
});

describe("capacidad de compra", () => {
  it("estima el techo con renta y ahorro", () => {
    const capacidad = capacidadCompra(
      perfil({ rentaClp: 2_400_000, ahorroClp: 28_000_000 }),
      UF,
    );
    assert.equal(capacidad.pieUf, 700);
    assert.ok(capacidad.precioMaximoUf !== null);
    assert.ok(capacidad.precioMaximoUf! > 3000 && capacidad.precioMaximoUf! < 3900);
    // Con UF 700 de pie alcanzaría para UF 3.500; la renta deja el techo más abajo.
    assert.equal(capacidad.restriccion, "renta");
  });

  it("marca el pie como restricción cuando la renta da para más", () => {
    const capacidad = capacidadCompra(
      perfil({ rentaClp: 6_000_000, ahorroClp: 20_000_000 }),
      UF,
    );
    assert.equal(capacidad.pieUf, 500);
    assert.equal(capacidad.restriccion, "pie");
    assert.equal(capacidad.precioMaximoUf, 2500);
  });

  it("descuenta las deudas vigentes de la capacidad mensual", () => {
    const sinDeuda = capacidadCompra(perfil({ rentaClp: 1_800_000, ahorroClp: 40_000_000 }), UF);
    const conDeuda = capacidadCompra(
      perfil({ rentaClp: 1_800_000, ahorroClp: 40_000_000, cuotasConsumoMensualesClp: 180_000 }),
      UF,
    );
    assert.ok(conDeuda.precioMaximoUf! < sinDeuda.precioMaximoUf!);
    assert.equal(conDeuda.dividendoMaximoClp, 1_800_000 * 0.25 - 180_000);
  });

  it("bloquea la evaluación si hay Dicom", () => {
    const capacidad = capacidadCompra(
      perfil({ rentaClp: 3_000_000, ahorroClp: 60_000_000, tieneDicom: true }),
      UF,
    );
    assert.equal(capacidad.precioMaximoUf, null);
    assert.equal(capacidad.restriccion, "dicom");
  });

  it("marca el pie como restricción cuando no hay ahorro", () => {
    const capacidad = capacidadCompra(perfil({ rentaClp: 2_000_000 }), UF);
    assert.equal(capacidad.precioMaximoUf, 0);
    assert.equal(capacidad.restriccion, "pie");
  });

  it("pondera la renta variable al 50%", () => {
    const capacidad = capacidadCompra(
      perfil({ rentaClp: 1_000_000, rentaVariableClp: 1_000_000, ahorroClp: 30_000_000 }),
      UF,
    );
    assert.equal(capacidad.rentaPonderadaClp, 1_500_000);
  });

  it("suma la renta de la pareja solo si la declara", () => {
    const sinPareja = capacidadCompra(
      perfil({ rentaClp: 1_500_000, rentaParejaClp: 1_500_000, ahorroClp: 30_000_000 }),
      UF,
    );
    const conPareja = capacidadCompra(
      perfil({ rentaClp: 1_500_000, tienePareja: true, rentaParejaClp: 1_500_000, ahorroClp: 30_000_000 }),
      UF,
    );
    assert.equal(sinPareja.rentaPonderadaClp, 1_500_000);
    assert.equal(conPareja.rentaPonderadaClp, 3_000_000);
  });
});

describe("extracción heurística", () => {
  it("lee montos en pesos con separador de miles", () => {
    const extraccion = extraerPerfilHeuristico(
      lead({
        mensajeInicial:
          "Hola, gano líquido $2.400.000 con contrato indefinido y tengo $28.000.000 ahorrados para el pie. ¿Se puede visitar esta semana?",
      }),
    );
    assert.equal(extraccion.rentaClp, 2_400_000);
    assert.equal(extraccion.ahorroClp, 28_000_000);
    assert.equal(extraccion.tipoRenta, "fixed");
    assert.equal(extraccion.pideVisita, true);
    assert.equal(extraccion.urgencia, "alta");
  });

  it("detecta subsidio, Dicom e intención de inversión", () => {
    const subsidio = extraerPerfilHeuristico(
      lead({ mensajeInicial: "Postulé al subsidio DS19, ¿aplica este proyecto?" }),
    );
    assert.equal(subsidio.postulaSubsidio, true);

    const dicom = extraerPerfilHeuristico(
      lead({ mensajeInicial: "Estuve en Dicom hasta el año pasado, ¿igual puedo postular?" }),
    );
    assert.equal(dicom.tieneDicom, true);

    const inversion = extraerPerfilHeuristico(
      lead({ mensajeInicial: "Busco depto para arrendar en Airbnb en Ñuñoa" }),
    );
    assert.equal(inversion.paraInvertir, true);
    assert.deepEqual(inversion.comunasInteres, ["Ñuñoa"]);
  });

  it("lee presupuestos expresados en UF", () => {
    const extraccion = extraerPerfilHeuristico(
      lead({ mensajeInicial: "Tengo preaprobado UF 3.500 en el Banco de Chile" }),
    );
    assert.equal(extraccion.presupuestoUfDeclarado, 3500);
    assert.equal(extraccion.creditoPreaprobado, true);
  });
});

describe("calce con el inventario", () => {
  const proyectos = generarProyectos(18, 2026);

  it("descarta lo que está fuera de presupuesto", () => {
    const candidatos = buscarCandidatos(proyectos, {
      presupuestoUf: 2500,
      comunas: [],
      dormitorios: null,
      banos: null,
      paraInvertir: false,
      necesitaSubsidio: false,
      entregaInmediata: false,
      proyectoIdInteres: null,
    });
    for (const candidato of candidatos) {
      assert.ok(
        candidato.precioUf === null || candidato.precioUf <= 2500 * 1.1,
        `${candidato.proyecto.nombre} quedó muy por sobre el presupuesto`,
      );
    }
  });

  it("prioriza la comuna que busca el comprador", () => {
    const comuna = proyectos[0].comuna;
    const candidatos = buscarCandidatos(proyectos, {
      presupuestoUf: 100000,
      comunas: [comuna],
      dormitorios: null,
      banos: null,
      paraInvertir: false,
      necesitaSubsidio: false,
      entregaInmediata: false,
      proyectoIdInteres: null,
    });
    assert.equal(candidatos[0].proyecto.comuna, comuna);
  });

  it("prefiere proyectos con subsidio cuando el comprador postula", () => {
    const conSubsidio: Proyecto[] = [
      { ...proyectos[0], id: "sin", tags: [] },
      { ...proyectos[0], id: "con", tags: ["Subsidio"] },
    ];
    const candidatos = buscarCandidatos(conSubsidio, {
      presupuestoUf: 100000,
      comunas: [],
      dormitorios: null,
      banos: null,
      paraInvertir: false,
      necesitaSubsidio: true,
      entregaInmediata: false,
      proyectoIdInteres: null,
    });
    assert.equal(candidatos[0].proyecto.id, "con");
  });
});

describe("puntaje y estado del pipeline", () => {
  function extraccion(cambios: Partial<Extraccion> = {}): Extraccion {
    return {
      rentaClp: null,
      rentaVariableClp: null,
      tipoRenta: null,
      tienePareja: null,
      rentaParejaClp: null,
      rentaParejaVariableClp: null,
      tipoRentaPareja: null,
      capacidadAhorroClp: null,
      ahorroClp: null,
      tieneCuentaBancaria: null,
      tieneDicom: null,
      creditosHipotecarios: null,
      dividendosMensualesClp: null,
      creditosConsumo: null,
      cuotasConsumoMensualesClp: null,
      paraInvertir: null,
      paraVivir: null,
      comunasInteres: [],
      dormitorios: null,
      banos: null,
      presupuestoUfDeclarado: null,
      creditoPreaprobado: null,
      postulaSubsidio: null,
      pideVisita: false,
      urgencia: "media",
      resumen: "",
      ...cambios,
    };
  }

  const proyectos = generarProyectos(6, 7);
  const candidatos = buscarCandidatos(proyectos, {
    presupuestoUf: 100000,
    comunas: [proyectos[0].comuna],
    dormitorios: null,
    banos: null,
    paraInvertir: false,
    necesitaSubsidio: false,
    entregaInmediata: false,
    proyectoIdInteres: null,
  });

  it("agenda visita a quien califica y la pide", () => {
    const capacidad = capacidadCompra(
      perfil({ rentaClp: 2_500_000, ahorroClp: 30_000_000 }),
      UF,
    );
    const resultado = evaluar(
      extraccion({ pideVisita: true, urgencia: "alta", creditoPreaprobado: true }),
      capacidad,
      candidatos,
    );
    assert.equal(resultado.estadoSugerido, "scheduled");
    assert.equal(resultado.siguienteAccion, "responder_y_agendar");
    assert.equal(resultado.temperatura, "caliente");
  });

  it("marca noQualify cuando hay Dicom", () => {
    const capacidad = capacidadCompra(perfil({ rentaClp: 2_000_000, tieneDicom: true }), UF);
    const resultado = evaluar(extraccion({ pideVisita: true }), capacidad, candidatos);
    assert.equal(resultado.estadoSugerido, "noQualify");
  });

  it("pide datos cuando el mensaje no trae nada financiero", () => {
    const capacidad = capacidadCompra(perfil({}), UF);
    const resultado = evaluar(extraccion(), capacidad, candidatos);
    assert.equal(resultado.estadoSugerido, "callAgain");
    assert.equal(resultado.siguienteAccion, "responder_y_pedir_datos");
  });
});

describe("mapeo al CRM", () => {
  it("arma un payload que pasa la validación del Customer API", () => {
    const entrada = aClienteJetBrokers(
      lead({ rut: "12.345.678-5", campana: "meta-septiembre" }),
      {
        puntaje: 72,
        temperatura: "caliente",
        presupuestoUfEstimado: 3400,
        pieUfEstimado: 700,
        perfil: perfil({ rentaClp: 2_400_000, ahorroClp: 28_000_000, tieneDicom: false, paraVivir: true }),
        comunasInteres: ["Ñuñoa"],
        urgencia: "alta",
        recomendaciones: [
          { proyectoId: "cpmoqN5r", nombre: "Mirador Alto", comuna: "La Reina", precioUf: 3200, modelo: "A8", motivo: "Calza" },
        ],
        objeciones: [],
        riesgos: [],
        razonamiento: "Buen calce",
        estadoSugerido: "scheduled",
        siguienteAccion: "responder_y_agendar",
        mensajeRespuesta: "Hola Camila...",
        horariosPropuestos: [],
        tags: ["preaprobado", "primera-vivienda"],
        motor: "heuristica",
        calificadoEn: new Date().toISOString(),
      },
      { asignarA: "ejecutivo@corredora.cl", segmento: "caliente" },
    );

    const { payload, avisos } = validarCliente(entrada);
    assert.equal(payload.fullName, "Camila Fuentes");
    assert.equal(payload.taxId, "12.345.678-5");
    assert.equal(payload.status, "scheduled");
    assert.equal(payload.salary, 2_400_000);
    assert.equal(payload.savingsBalance, 28_000_000);
    assert.equal(payload.aimToLive, true);
    assert.equal(payload.tags, "preaprobado,primera-vivienda");
    assert.equal(payload.assignedTo, "ejecutivo@corredora.cl");
    assert.equal(payload.comuna, "Ñuñoa");
    assert.ok((payload.comments?.length ?? 0) <= 500);
    assert.deepEqual(avisos, []);
  });
});
