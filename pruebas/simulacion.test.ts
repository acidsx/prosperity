/**
 * La simulación recorre el código real, así que sirve además como prueba de
 * integración de todo el recorrido: si algo se rompe en el camino, acá se ve.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { avance, alertasDelNegocio } from "../src/lib/cierre/negocio";
import { tiendaMemoria } from "../src/lib/datos/memoria";
import { PLAN_CIERRE } from "../src/lib/dominio/cierre";
import { simularVenta, type ResultadoSimulacion } from "../src/lib/simulacion/venta";

describe("simulación de una venta completa", () => {
  let resultado: ResultadoSimulacion;

  before(async () => {
    await tiendaMemoria.reiniciar({ proyectos: 8, leads: 2, semilla: 2026 });
    resultado = await simularVenta();
  });

  it("termina con la venta cerrada y todos los hitos cumplidos", async () => {
    const negocio = await tiendaMemoria.obtenerNegocio(resultado.resumen.negocioId);
    assert.ok(negocio, "no quedó guardado el cierre");
    assert.equal(negocio!.etapa, "cerrado");
    assert.equal(avance(negocio!), 100);

    const pendientes = PLAN_CIERRE.filter(
      (definicion) =>
        definicion.tipo !== "reserva_vence" &&
        definicion.tipo !== "plazo_escritura" &&
        !negocio!.hitos.find((hito) => hito.tipo === definicion.tipo)?.cumplidoEn,
    );
    assert.deepEqual(pendientes.map((item) => item.tipo), [], "quedaron hitos sin cumplir");
  });

  it("no deja alertas abiertas al terminar", async () => {
    const negocio = await tiendaMemoria.obtenerNegocio(resultado.resumen.negocioId);
    assert.deepEqual(alertasDelNegocio(negocio!), []);
  });

  it("cierra dentro de lo que el comprador puede pagar", async () => {
    const oportunidad = await tiendaMemoria.oportunidadDeLead(resultado.resumen.leadId);
    const techo = oportunidad?.calificacion?.presupuestoUfEstimado;
    assert.ok(techo, "el lead simulado tiene que quedar calificado");

    // El calce admite hasta 10% sobre el techo por negociable; la venta se
    // cierra con el descuento que haga falta para no dejar al comprador sin pie.
    assert.ok(
      resultado.resumen.precioUf <= techo!,
      `cerró en UF ${resultado.resumen.precioUf} con un techo de UF ${techo}`,
    );
  });

  it("la comisión se calcula sobre el precio final, no sobre el de lista", async () => {
    const negocio = await tiendaMemoria.obtenerNegocio(resultado.resumen.negocioId);
    const precioFinal = negocio!.precioUf - negocio!.descuentoUf;
    assert.equal(precioFinal, resultado.resumen.precioUf);

    const comision = negocio!.comisionUf ?? 0;
    assert.ok(comision > 0);
    // Nunca puede superar el 12% del precio final: sería un error de cálculo.
    assert.ok(comision < precioFinal * 0.12, `comisión desproporcionada: UF ${comision}`);
  });

  it("el agente respondió y dejó la conversación en la ficha", async () => {
    const mensajes = await tiendaMemoria.listarMensajes(resultado.resumen.leadId);
    const salientes = mensajes.filter((mensaje) => mensaje.direccion === "saliente");
    assert.ok(salientes.length >= 2, "el agente tendría que haber escrito al menos dos veces");

    // La conversación queda fechada en el guion, no en la hora de la corrida.
    const ahora = Date.now();
    assert.ok(
      mensajes.every((mensaje) => new Date(mensaje.enviadoEn).getTime() <= ahora),
      "hay mensajes con fecha futura",
    );
  });

  it("la visita quedó realizada y los documentos recibidos", async () => {
    const visitas = await tiendaMemoria.listarVisitas();
    const suya = visitas.filter((visita) => visita.leadId === resultado.resumen.leadId);
    assert.ok(suya.some((visita) => visita.estado === "realizada"));

    const solicitud = await tiendaMemoria.solicitudDeLead(resultado.resumen.leadId);
    assert.equal(solicitud?.estado, "completa");
    assert.ok(resultado.resumen.documentosRecibidos >= 3);
  });

  it("los certificados del Conservador se renovaron antes de la firma", async () => {
    const negocio = await tiendaMemoria.obtenerNegocio(resultado.resumen.negocioId);
    const dominio = negocio!.documentos.find((item) => item.documento === "dominio_vigente");
    const firmaComprador = negocio!.hitos.find((hito) => hito.tipo === "firma_comprador");

    assert.ok(dominio?.emitidoEn, "el dominio vigente no quedó registrado");
    // Emitido después del borrador de escritura: es la renovación, no la
    // primera vuelta que ya había vencido.
    const borrador = negocio!.hitos.find((hito) => hito.tipo === "borrador_escritura");
    assert.ok(
      new Date(dominio!.emitidoEn!) > new Date(borrador!.cumplidoEn!),
      "el certificado usado en la firma es el vencido",
    );
    assert.ok(new Date(dominio!.emitidoEn!) < new Date(firmaComprador!.cumplidoEn!));
  });

  it("la narración cubre el recorrido completo y en orden", () => {
    assert.ok(resultado.pasos.length >= 18);

    const dias = resultado.pasos.map((paso) => paso.dia);
    assert.deepEqual([...dias].sort((a, b) => a - b), dias, "los pasos no están en orden");

    const actores = new Set(resultado.pasos.map((paso) => paso.actor));
    for (const actor of ["comprador", "agente", "banco", "notaria", "cbr"]) {
      assert.ok(actores.has(actor as never), `falta el actor ${actor}`);
    }

    const titulos = resultado.pasos.map((paso) => paso.titulo).join(" | ");
    assert.match(titulos, /Califica el lead/);
    assert.match(titulos, /certificados vencidos/i);
    assert.match(titulos, /Dominio e hipoteca inscritos/);
    assert.match(titulos, /Venta cerrada/);
  });
});

describe("coherencia de la conversación simulada", () => {
  let resultado: ResultadoSimulacion;

  before(async () => {
    await tiendaMemoria.reiniciar({ proyectos: 8, leads: 2, semilla: 4242 });
    resultado = await simularVenta();
  });

  it("los mensajes van en orden y ninguno se adelanta al que responde", async () => {
    const mensajes = (await tiendaMemoria.listarMensajes(resultado.resumen.leadId)).sort(
      (uno, otro) => uno.enviadoEn.localeCompare(otro.enviadoEn) || uno.id.localeCompare(otro.id),
    );

    // El defecto que esto cubre: la confirmación del comprador aparecía antes
    // del mensaje del agente que estaba confirmando.
    const confirmacion = mensajes.findIndex(
      (mensaje) => mensaje.direccion === "entrante" && /confirmo/i.test(mensaje.cuerpo),
    );
    const propuesta = mensajes.findIndex(
      (mensaje) => mensaje.direccion === "saliente" && /acomoda visitar/i.test(mensaje.cuerpo),
    );
    assert.ok(propuesta >= 0, "el agente no propuso horarios");
    assert.ok(confirmacion > propuesta, "la confirmación quedó antes de la propuesta");

    const tiempos = mensajes.map((mensaje) => new Date(mensaje.enviadoEn).getTime());
    assert.deepEqual([...tiempos].sort((a, b) => a - b), tiempos);
  });

  it("los horarios propuestos caen cerca de la conversación, no de hoy", async () => {
    const oportunidad = await tiendaMemoria.oportunidadDeLead(resultado.resumen.leadId);
    const propuestos = oportunidad?.calificacion?.horariosPropuestos ?? [];
    assert.ok(propuestos.length > 0);

    const consulta = new Date(resultado.pasos[0].fecha).getTime();
    for (const horario of propuestos) {
      const diferencia = new Date(horario).getTime() - consulta;
      assert.ok(diferencia > 0, "propuso un horario anterior a la consulta");
      // Dentro de las dos semanas siguientes: antes proponía visitas de hoy
      // en una conversación de hace cuatro meses.
      assert.ok(
        diferencia < 14 * 24 * 3600_000,
        `propuso una visita ${Math.round(diferencia / 86400000)} días después de la consulta`,
      );
    }
  });

  it("avisa cuando una recomendación queda sobre lo que el comprador puede pagar", async () => {
    const oportunidad = await tiendaMemoria.oportunidadDeLead(resultado.resumen.leadId);
    const techo = oportunidad?.calificacion?.presupuestoUfEstimado ?? 0;
    // El mensaje menciona solo las dos primeras recomendaciones, para no
    // saturar: la advertencia se exige sobre esas.
    const sobreElTecho = (oportunidad?.calificacion?.recomendaciones ?? [])
      .slice(0, 2)
      .filter((item) => (item.precioUf ?? 0) > techo);

    if (sobreElTecho.length === 0) return; // en esta corrida todo cabía

    const mensajes = await tiendaMemoria.listarMensajes(resultado.resumen.leadId);
    const respuesta = mensajes.find(
      (mensaje) => mensaje.direccion === "saliente" && /te calzan/i.test(mensaje.cuerpo),
    );
    assert.match(
      respuesta?.cuerpo ?? "",
      /sobre tu tope/i,
      "recomendó algo sobre el techo sin decirlo",
    );
  });
});
