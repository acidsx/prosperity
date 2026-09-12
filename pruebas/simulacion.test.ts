/**
 * La simulación recorre el código real, así que sirve además como prueba de
 * integración de todo el recorrido: si algo se rompe en el camino, acá se ve.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { avance, alertasDelNegocio } from "../src/lib/cierre/negocio";
import { tiendaMemoria } from "../src/lib/datos/memoria";
import { PLAN_CIERRE } from "../src/lib/dominio/cierre";
import {
  simularCompradorIndeciso,
  type ResultadoIndeciso,
} from "../src/lib/simulacion/indeciso";
import {
  simularInversionista,
  type ResultadoInversionista,
} from "../src/lib/simulacion/inversionista";
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

describe("el comprador indeciso y temeroso", () => {
  let resultado: ResultadoIndeciso;

  before(async () => {
    await tiendaMemoria.reiniciar({ proyectos: 8, leads: 2, semilla: 1979 });
    resultado = await simularCompradorIndeciso();
  });

  it("todas las respuestas del agente salen del código, no del guion", async () => {
    const mensajes = await tiendaMemoria.listarMensajes(resultado.resumen.leadId);
    const salientes = mensajes.filter((mensaje) => mensaje.direccion === "saliente");
    assert.ok(salientes.length >= 10, "el agente contestó muy poco para esta conversación");
    assert.equal(resultado.resumen.mensajesDelAgente, salientes.filter((m) => m.automatico).length);
  });

  it("aparecen las dudas de un comprador temeroso y cada una queda registrada", () => {
    const tipos = resultado.resumen.objeciones.map((objecion) => objecion.tipo);
    for (const esperada of [
      "no_sabe_que_quiere",
      "miedo_deuda",
      "miedo_cesantia",
      "precio_alto",
      "pie_insuficiente",
      "comparando",
      "desconfianza",
      "esperar_mejor_momento",
      "prefiere_pensarlo",
    ]) {
      assert.ok(tipos.includes(esperada as never), `no se trató la objeción ${esperada}`);
    }
  });

  it("no insiste más de tres veces con la misma objeción, y la tercera es para parar", () => {
    const miedo = resultado.resumen.objeciones.find((objecion) => objecion.tipo === "miedo_deuda");
    assert.equal(miedo?.intentos, 3, "el guion insiste tres veces con el miedo a la deuda");
    assert.equal(resultado.resumen.seDetuvo, true, "el agente no se detuvo");

    const ultima = resultado.turnos
      .filter((turno) => turno.objecion === "miedo_deuda" && turno.voz === "agente")
      .at(-1);
    assert.match(ultima?.texto ?? "", /no quiero seguir insistiendo/i);
  });

  it("la desconfianza la toma una persona del equipo", () => {
    assert.ok(resultado.resumen.escalamientos >= 1);
    assert.ok(
      resultado.turnos.some((turno) => turno.voz === "ejecutivo"),
      "nadie del equipo entró a la conversación",
    );
  });

  it("nunca inventa escasez, urgencia ni promete el crédito", () => {
    const delAgente = resultado.turnos
      .filter((turno) => turno.voz === "agente")
      .map((turno) => turno.texto)
      .join("\n");

    assert.doesNotMatch(delAgente, /queda (solo|solamente) un|[úu]ltima unidad|hay otro interesado/i);
    assert.doesNotMatch(delAgente, /sube el precio ma[ñn]ana|oferta por hoy|aprovecha ahora/i);
    assert.doesNotMatch(delAgente, /te (lo )?van a aprobar|cr[ée]dito asegurado/i);
  });

  it("cuando la unidad queda sobre lo que le prestan, se lo dice", () => {
    const caro = resultado.turnos.find(
      (turno) => turno.voz === "agente" && turno.objecion === "precio_alto",
    );
    assert.ok(caro, "no respondió la objeción de precio");
    assert.match(caro!.texto, /Tienes raz[óo]n|dentro de lo que financia/i);
  });

  it("la conversación va en orden y no tiene mensajes del futuro", () => {
    const fechas = resultado.turnos.map((turno) => new Date(turno.fecha).getTime());
    assert.deepEqual([...fechas].sort((a, b) => a - b), fechas, "los turnos no están en orden");

    const ahora = Date.now();
    assert.ok(
      fechas.every((fecha) => fecha <= ahora),
      "hay turnos con fecha futura",
    );
  });

  it("termina en un paso de bajo compromiso, no en una reserva forzada", async () => {
    const solicitud = await tiendaMemoria.solicitudDeLead(resultado.resumen.leadId);
    assert.ok(solicitud, "no llegó a pedir los documentos de la preaprobación");
    assert.match(resultado.resumen.desenlace, /sin compromiso/i);

    // Nadie reservó nada: era un comprador que todavía está decidiendo.
    const negocios = await tiendaMemoria.listarNegocios();
    assert.equal(
      negocios.filter((negocio) => negocio.leadId === resultado.resumen.leadId).length,
      0,
    );
  });
});

describe("el inversionista que quiere varios departamentos", () => {
  let resultado: ResultadoInversionista;

  before(async () => {
    await tiendaMemoria.reiniciar({ proyectos: 8, leads: 2, semilla: 3117 });
    resultado = await simularInversionista();
  });

  it("le ajusta la expectativa: pide más de lo que le alcanza", () => {
    assert.equal(resultado.resumen.unidadesPedidas, 4);
    assert.ok(
      resultado.resumen.unidadesFinanciables < resultado.resumen.unidadesPedidas,
      "con este perfil no debería alcanzarle para las cuatro",
    );
    assert.notEqual(resultado.resumen.restriccion, "ninguna");

    // Y se lo dice en el primer mensaje, no después de tres visitas.
    const plan = resultado.turnos.find(
      (turno) => turno.voz === "agente" && /los números dan para/.test(turno.texto),
    );
    assert.ok(plan, "no mandó el plan de cartera");
    assert.equal(plan!.dia, 0);
  });

  it("no reserva más pie ni más dividendo del que tiene", () => {
    assert.ok(resultado.resumen.pieRequeridoUf <= resultado.resumen.pieDisponibleUf);
    assert.ok(resultado.resumen.dividendoTotalClp > 0);
  });

  it("dice que el arriendo no paga el dividendo, y lo cuantifica", () => {
    assert.ok(resultado.resumen.flujoMensualTotalClp < 0, "el escenario dejó de tener flujo negativo");

    const respuesta = resultado.turnos.find((turno) => turno.objecion === "se_paga_solo");
    assert.ok(respuesta, "no respondió la objeción de que se paga solo");
    assert.match(respuesta!.texto, /^No, /);
    assert.match(respuesta!.texto, /de tu bolsillo cada mes/i);
  });

  it("muestra la amortización además del flujo: el retorno no es solo caja", () => {
    assert.ok(resultado.resumen.amortizacionTotalClp > 0);
    const delAgente = resultado.turnos.filter((turno) => turno.voz === "agente");
    assert.ok(
      delAgente.some((turno) => /capital que pasa a ser tuyo/i.test(turno.texto)),
      "nunca explicó que parte del dividendo es patrimonio",
    );
  });

  it("publica la rentabilidad neta, no solo la bruta", () => {
    assert.ok(resultado.resumen.rentabilidadNeta > 0);
    assert.ok(resultado.resumen.rentabilidadNeta < resultado.resumen.rentabilidadBruta);

    const respuesta = resultado.turnos.find((turno) => turno.objecion === "rentabilidad");
    assert.ok(respuesta);
    assert.match(respuesta!.texto, /Neta:/);
  });

  it("el descuento por volumen lo toma una persona, no el agente", () => {
    assert.ok(resultado.resumen.escalamientos >= 1, "no escaló la negociación de precio");
    assert.ok(resultado.turnos.some((turno) => turno.voz === "ejecutivo"));

    const delAgente = resultado.turnos
      .filter((turno) => turno.voz === "agente")
      .map((turno) => turno.texto)
      .join("\n");
    assert.doesNotMatch(delAgente, /te hago un descuento|te dejo (en|a) UF|te rebajo/i);
  });

  it("nunca promete arriendo asegurado ni retorno garantizado", () => {
    const delAgente = resultado.turnos
      .filter((turno) => turno.voz === "agente")
      .map((turno) => turno.texto)
      .join("\n");

    assert.doesNotMatch(
      delAgente,
      /rentabilidad (asegurada|garantizada)|arriendo garantizado|retorno seguro|se arrienda solo/i,
    );
    assert.doesNotMatch(delAgente, /se pagan? sol[oa]s? con el arriendo/i);
  });

  it("abre un cierre por unidad: cada una escritura e inscribe por separado", async () => {
    assert.equal(resultado.resumen.negocioIds.length, resultado.resumen.unidadesFinanciables);

    const negocios = await tiendaMemoria.listarNegocios();
    const suyos = negocios.filter((negocio) => negocio.leadId === resultado.resumen.leadId);
    assert.equal(suyos.length, resultado.resumen.unidadesFinanciables);
    assert.ok(suyos.every((negocio) => negocio.etapa !== "cerrado"));

    // Unidades distintas: no son el mismo departamento duplicado.
    const unidades = new Set(suyos.map((negocio) => negocio.unidad));
    assert.equal(unidades.size, suyos.length);
  });

  it("la conversación va en orden y sin mensajes del futuro", () => {
    const fechas = resultado.turnos.map((turno) => new Date(turno.fecha).getTime());
    assert.deepEqual([...fechas].sort((a, b) => a - b), fechas);
    assert.ok(fechas.every((fecha) => fecha <= Date.now()));
  });
});
