/**
 * Las vías para cerrar la brecha cuando no le alcanza.
 *
 * El defecto que esto cubre es concreto: el agente decía "no tengo nada en
 * tu rango" teniendo proyectos con bono pie y pie cero en el mismo
 * inventario. Decir que no se puede, pudiendo, no es prudencia.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  alternativasDeFinanciamiento,
  mejorAlternativa,
  mesesHastaEntrega,
  SUBSIDIO_REFERENCIA_UF,
  type Alternativa,
} from "../src/lib/dominio/alternativas";
import { TOPE_SUBSIDIO_UF } from "../src/lib/dominio/chile";
import { capacidadCompra } from "../src/lib/dominio/financiamiento";
import { PERFIL_VACIO, type PerfilFinanciero, type Proyecto } from "../src/lib/dominio/tipos";

const UF = 40_000;
const AHORA = new Date("2026-09-07T12:00:00-03:00");

function proyecto(cambios: Partial<Proyecto> = {}): Proyecto {
  return {
    id: "p1",
    nombre: "Proyecto Demo",
    slug: "demo",
    comuna: "Macul",
    region: "Metropolitana",
    direccion: "Av. Irarrázaval 7602",
    desarrollador: "Inmobiliaria Demo",
    etapa: "green",
    modo: null,
    alcance: null,
    precioDesdeUf: 3000,
    precioHastaUf: 4000,
    reservaClp: 500_000,
    feePorcentaje: 2,
    entrega: "Junio",
    anoEntrega: 2028,
    tags: [],
    modelos: [],
    beneficios: [],
    descripcion: null,
    portadaId: null,
    brokerEmail: null,
    brokerNombre: null,
    desdeApi: false,
    ...cambios,
  };
}

function comprador(cambios: Partial<PerfilFinanciero> = {}): PerfilFinanciero {
  return {
    ...PERFIL_VACIO,
    rentaClp: 1_800_000,
    tipoRenta: "fixed",
    ahorroClp: 18_000_000,
    tieneDicom: false,
    paraVivir: true,
    ...cambios,
  };
}

function vias(perfil: PerfilFinanciero, proyectos: Proyecto[], objetivoUf = 3592): Alternativa[] {
  return alternativasDeFinanciamiento({
    perfil,
    capacidadBase: capacidadCompra(perfil, UF),
    valorUfClp: UF,
    precioObjetivoUf: objetivoUf,
    proyectos,
    ahora: AHORA,
  });
}

describe("alternativas de financiamiento", () => {
  it("cada alternativa dice su contra: ninguna se ofrece sin costo", () => {
    const todas = vias(comprador(), [proyecto({ tags: ["Bono pie 10", "Pie cero", "Subsidio"] })]);
    assert.ok(todas.length > 0);
    for (const alternativa of todas) {
      assert.ok(alternativa.advertencia.length > 20, `${alternativa.tipo} no declara su contra`);
      assert.ok(alternativa.requisito.length > 10, `${alternativa.tipo} no declara su requisito`);
    }
  });

  it("el bono pie solo se ofrece si hay proyectos que lo tengan", () => {
    const sin = vias(comprador(), [proyecto({ tags: ["Amoblado"] })]);
    assert.ok(!sin.some((via) => via.tipo === "bono_pie"));

    const con = vias(comprador(), [proyecto({ tags: ["Bono pie 10"] })]);
    const bono = con.find((via) => via.tipo === "bono_pie");
    assert.ok(bono, "no ofreció el bono pie teniéndolo en el inventario");
    assert.ok(bono!.proyectos.length > 0, "no dice en qué proyecto está disponible");
    assert.ok((bono!.precioMaximoUf ?? 0) > (capacidadCompra(comprador(), UF).precioMaximoUf ?? 0));
  });

  it("el multicrédito suma la renta del segundo titular", () => {
    // Con el pie como restricción, sumar renta no mueve el techo: no se ofrece.
    const porPie = vias(comprador({ ahorroClp: 5_000_000 }), [proyecto()]);
    assert.ok(!porPie.some((via) => via.tipo === "segundo_titular"));

    // Con la renta como restricción sí, y con el segundo titular declarado.
    const porRenta = vias(comprador({ ahorroClp: 200_000_000 }), [proyecto()]);
    const multi = porRenta.find((via) => via.tipo === "segundo_titular");
    assert.ok(multi, "no ofreció multicrédito con la renta como restricción");
    assert.ok(multi!.gananciaUf > 0);
    assert.match(multi!.advertencia, /obligados por el total/i);
  });

  it("el subsidio nunca propone un techo sobre el tope legal del programa", () => {
    const conSubsidio = vias(comprador({ ahorroClp: 8_000_000 }), [proyecto({ tags: ["Subsidio"] })]);
    const subsidio = conSubsidio.find((via) => via.tipo === "subsidio");
    if (subsidio) {
      assert.ok(
        (subsidio.precioMaximoUf ?? 0) <= TOPE_SUBSIDIO_UF,
        `propuso UF ${subsidio.precioMaximoUf} con un tope de UF ${TOPE_SUBSIDIO_UF}`,
      );
    }

    // Con un techo ya sobre el tope, el subsidio no aporta y no se ofrece.
    const sobreElTope = vias(comprador({ ahorroClp: 60_000_000 }), [proyecto({ tags: ["Subsidio"] })]);
    assert.ok(!sobreElTope.some((via) => via.tipo === "subsidio"));
    assert.equal(SUBSIDIO_REFERENCIA_UF, 300);
  });

  it("el pie en cuotas solo aplica a proyectos en verde", () => {
    const entregado = vias(comprador(), [proyecto({ anoEntrega: 2024, entrega: "Marzo" })]);
    assert.ok(!entregado.some((via) => via.tipo === "pie_en_cuotas"));

    const enVerde = vias(comprador(), [proyecto({ anoEntrega: 2028, entrega: "Junio" })]);
    const cuotas = enVerde.find((via) => via.tipo === "pie_en_cuotas");
    assert.ok(cuotas);
    assert.ok((cuotas!.efectivoHoyClp ?? 0) > 0);
    assert.match(cuotas!.advertencia, /No reduce el pie, lo reparte/i);
  });

  it("cuenta los meses hasta la entrega y descarta lo ya entregado", () => {
    assert.equal(mesesHastaEntrega(proyecto({ anoEntrega: 2028, entrega: "Junio" }), AHORA), 21);
    assert.equal(mesesHastaEntrega(proyecto({ anoEntrega: 2024, entrega: "Junio" }), AHORA), null);
    assert.equal(mesesHastaEntrega(proyecto({ anoEntrega: null }), AHORA), null);
  });

  it("van ordenadas de la que más suma a la que menos", () => {
    const todas = vias(comprador({ ahorroClp: 200_000_000 }), [
      proyecto({ tags: ["Bono pie 10", "Pie cero", "Subsidio"] }),
    ]);
    const ganancias = todas.map((via) => via.gananciaUf);
    assert.deepEqual([...ganancias].sort((a, b) => b - a), ganancias);
  });

  it("elige la vía que de verdad alcanza el precio objetivo", () => {
    const todas = vias(comprador(), [proyecto({ tags: ["Bono pie 10", "Pie cero"] })]);
    const elegida = mejorAlternativa(todas, 3592);
    assert.ok(elegida);
    // La elegida alcanza el objetivo, o es la que más se acerca.
    if (todas.some((via) => (via.precioMaximoUf ?? 0) >= 3592)) {
      assert.ok((elegida!.precioMaximoUf ?? 0) >= 3592);
    }
  });

  it("con Dicom no se ofrece multicrédito: primero hay que regularizar", () => {
    const todas = vias(comprador({ tieneDicom: true }), [proyecto({ tags: ["Bono pie 10"] })]);
    assert.ok(!todas.some((via) => via.tipo === "segundo_titular"));
  });
});
