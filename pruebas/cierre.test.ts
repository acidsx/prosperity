/** Pruebas del cierre de venta: hitos, vigencias, alertas y control de gestión. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { claveCorrecta, hashDeClave, problemaDeClave } from "../src/lib/auth/clave";
import { crearToken, leerToken } from "../src/lib/auth/sesion";
import { puede } from "../src/lib/auth/tipos";
import { auditoriaDelAgente, metricasPorEjecutivo, minutosPrimeraRespuesta } from "../src/lib/cierre/gestion";
import {
  alertasDelNegocio,
  avance,
  crearNegocio,
  cumplirHito,
  etapaSegunHitos,
  marcarCaido,
  siguienteHito,
  sumarDiasHabiles,
} from "../src/lib/cierre/negocio";
import { nuevoLead, nuevoMensaje } from "../src/lib/dominio/fabricas";
import type { Negocio, Parte } from "../src/lib/dominio/cierre";
import {
  documentosDeLaOperacion,
  vigenciaDocumento,
  type DocumentoNegocio,
} from "../src/lib/documentos/propiedad";

const COMPRADOR: Parte = {
  nombre: "Camila Fuentes",
  rut: "12.345.678-5",
  email: "camila@gmail.com",
  telefono: "+56912345678",
  estadoCivil: "single",
};

function negocio(cambios: Partial<Parameters<typeof crearNegocio>[0]> = {}): Negocio {
  return crearNegocio({
    leadId: "lead_001",
    proyectoId: "proj_1",
    precioUf: 4000,
    compradores: [COMPRADOR],
    comisionUf: 95.2,
    ...cambios,
  });
}

function hace(dias: number): Date {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - dias);
  return fecha;
}

describe("días hábiles", () => {
  it("salta sábados y domingos", () => {
    // Viernes 11 de septiembre de 2026 + 1 hábil = lunes 14.
    const viernes = new Date("2026-09-11T12:00:00Z");
    assert.equal(sumarDiasHabiles(viernes, 1).getUTCDate(), 14);
    assert.equal(sumarDiasHabiles(viernes, 5).getUTCDate(), 18);
  });

  it("no mueve la fecha con cero días", () => {
    const lunes = new Date("2026-09-14T12:00:00Z");
    assert.equal(sumarDiasHabiles(lunes, 0).getTime(), lunes.getTime());
  });
});

describe("plan del cierre", () => {
  it("parte en reserva con todos los hitos planificados", () => {
    const operacion = negocio();
    assert.equal(operacion.etapa, "reserva");
    assert.equal(avance(operacion), 0);
    assert.ok(operacion.hitos.length > 15);
    assert.ok(operacion.hitos.every((hito) => hito.comprometidoPara && !hito.cumplidoEn));
  });

  it("la etapa se deduce de los hitos y apunta a dónde está la pelota", () => {
    let operacion = negocio();
    assert.equal(etapaSegunHitos(operacion), "reserva");

    // Con la reserva firmada, el trabajo de esa etapa está hecho: lo que
    // corresponde ahora es el banco, aunque todavía no se haya ingresado.
    operacion = cumplirHito(operacion, "reserva_firmada");
    assert.equal(etapaSegunHitos(operacion), "evaluacion_bancaria");

    operacion = cumplirHito(operacion, "credito_ingresado");
    assert.equal(operacion.etapa, "evaluacion_bancaria");

    for (const tipo of ["tasacion", "estudio_titulos", "credito_aprobado"] as const) {
      operacion = cumplirHito(operacion, tipo);
    }
    assert.equal(operacion.etapa, "promesa");
  });

  it("el siguiente hito es el primero pendiente que sea trabajo", () => {
    let operacion = negocio();
    assert.equal(siguienteHito(operacion)?.hito.tipo, "reserva_firmada");

    operacion = cumplirHito(operacion, "reserva_firmada");
    // El vencimiento de la reserva es un plazo, no una tarea: se salta.
    assert.equal(siguienteHito(operacion)?.hito.tipo, "credito_ingresado");
  });

  it("un negocio caído no vuelve a avanzar", () => {
    const caido = marcarCaido(negocio(), "El banco rechazó el crédito");
    assert.equal(caido.etapa, "caido");
    assert.equal(etapaSegunHitos(caido), "caido");
    assert.deepEqual(alertasDelNegocio(caido), []);
  });

  it("el avance no cuenta los plazos como trabajo hecho", () => {
    let operacion = negocio();
    const total = operacion.hitos.filter(
      (hito) => hito.tipo !== "reserva_vence" && hito.tipo !== "plazo_escritura",
    ).length;
    operacion = cumplirHito(operacion, "reserva_firmada");
    assert.equal(avance(operacion), Math.round((1 / total) * 100));
  });
});

describe("vigencia de los certificados", () => {
  function registro(cambios: Partial<DocumentoNegocio> = {}): DocumentoNegocio {
    return { documento: "dominio_vigente", emitidoEn: null, recibidoEn: null, archivo: null, nota: null, ...cambios };
  }

  it("cuenta desde la emisión, no desde que lo recibimos", () => {
    // El dominio vigente dura 30 días. Emitido hace 25, recibido ayer:
    // le quedan 5, no 29.
    const vigencia = vigenciaDocumento(
      registro({ emitidoEn: hace(25).toISOString(), recibidoEn: hace(1).toISOString() }),
      new Date(),
    );
    assert.equal(vigencia.estado, "por_vencer");
    assert.ok((vigencia.diasRestantes ?? 0) <= 5);
  });

  it("marca vencido lo que pasó su plazo", () => {
    const vigencia = vigenciaDocumento(
      registro({ emitidoEn: hace(45).toISOString(), recibidoEn: hace(44).toISOString() }),
    );
    assert.equal(vigencia.estado, "vencido");
    assert.ok((vigencia.diasRestantes ?? 0) < 0);
  });

  it("los documentos sin vencimiento no caducan", () => {
    const vigencia = vigenciaDocumento(
      registro({ documento: "recepcion_final", recibidoEn: hace(400).toISOString() }),
    );
    assert.equal(vigencia.estado, "sin_vencimiento");
  });

  it("lo no recibido no es lo mismo que lo vencido", () => {
    assert.equal(vigenciaDocumento(registro()).estado, "sin_recibir");
  });

  it("pide distintos certificados según el tipo de operación", () => {
    const departamento = documentosDeLaOperacion({
      esCopropiedad: true,
      vendedorConHipoteca: false,
      vendedorCasado: false,
    }).map((documento) => documento.id);
    assert.ok(departamento.includes("deuda_gastos_comunes"));
    assert.ok(!departamento.includes("certificado_deuda_hipotecaria"));

    const casa = documentosDeLaOperacion({
      esCopropiedad: false,
      vendedorConHipoteca: true,
      vendedorCasado: true,
    }).map((documento) => documento.id);
    assert.ok(!casa.includes("deuda_gastos_comunes"));
    assert.ok(casa.includes("certificado_deuda_hipotecaria"));
    assert.ok(casa.includes("certificado_matrimonio_vendedor"));
  });
});

describe("alertas", () => {
  it("avisa de los hitos atrasados", () => {
    // Un negocio abierto hace 40 días sin ningún hito cumplido.
    const operacion = negocio({ desde: hace(40) });
    const alertas = alertasDelNegocio(operacion);
    assert.ok(alertas.length > 0);
    assert.ok(alertas.some((alerta) => alerta.titulo.includes("Reserva firmada")));
  });

  it("trata el vencimiento de la reserva como crítico, no como un atraso más", () => {
    const operacion = negocio({ desde: hace(60) });
    const critica = alertasDelNegocio(operacion).find((alerta) =>
      alerta.titulo.includes("Vencimiento de la reserva"),
    );
    assert.ok(critica);
    assert.equal(critica!.gravedad, "critica");
  });

  it("avisa cuando la tasación queda bajo el precio", () => {
    const operacion = negocio();
    operacion.credito = {
      banco: "BCI",
      ejecutivoBanco: null,
      contactoBanco: null,
      estado: "en_estudio_titulos",
      montoUf: 3200,
      tasaAnual: 4.5,
      plazoAnos: 25,
      tasacionUf: 3700,
      reparos: [],
      actualizadaEn: new Date().toISOString(),
    };
    const alerta = alertasDelNegocio(operacion).find((item) =>
      item.titulo.includes("Tasación bajo el precio"),
    );
    assert.ok(alerta, "no avisó de la brecha de tasación");
    // UF 4.000 de precio contra UF 3.700 de tasación: faltan UF 300 de pie.
    assert.ok(alerta!.detalle.includes("300"), alerta!.detalle);
    assert.equal(alerta!.responsable, "comprador");
  });

  it("avisa del crédito rechazado y de los reparos del Conservador", () => {
    const operacion = negocio();
    operacion.credito = {
      banco: "Santander",
      ejecutivoBanco: null,
      contactoBanco: null,
      estado: "rechazada",
      montoUf: null,
      tasaAnual: null,
      plazoAnos: null,
      tasacionUf: null,
      reparos: [],
      actualizadaEn: new Date().toISOString(),
    };
    operacion.cbr = {
      conservador: "CBR Santiago",
      ingresadaEn: hace(10).toISOString(),
      numeroIngreso: "12345",
      inscritaEn: null,
      fojas: null,
      numero: null,
      ano: null,
      reparos: ["Falta certificado de número municipal"],
    };

    const alertas = alertasDelNegocio(operacion);
    assert.ok(alertas.some((alerta) => alerta.titulo === "Crédito rechazado"));
    assert.ok(alertas.some((alerta) => alerta.titulo.includes("Conservador puso reparos")));
    assert.equal(alertas[0].gravedad, "critica");
  });

  it("un certificado vencido frena la escritura y sale como crítico", () => {
    const operacion = negocio();
    const dominio = operacion.documentos.find((item) => item.documento === "dominio_vigente")!;
    dominio.emitidoEn = hace(50).toISOString();
    dominio.recibidoEn = hace(49).toISOString();

    const alerta = alertasDelNegocio(operacion).find((item) =>
      item.titulo.includes("dominio vigente"),
    );
    assert.ok(alerta);
    assert.equal(alerta!.gravedad, "critica");
    assert.ok(alerta!.detalle.includes("Conservador"));
  });

  it("no reclama documentos de etapas que todavía no llegan", () => {
    // Recién en reserva: el certificado de no expropiación se pide al escriturar.
    const operacion = negocio();
    const alertas = alertasDelNegocio(operacion);
    assert.ok(!alertas.some((alerta) => alerta.titulo.includes("no expropiación")));
  });
});

describe("claves y sesión", () => {
  it("verifica la clave correcta y rechaza la incorrecta", async () => {
    const { hash, salt } = await hashDeClave("Clave-de-prueba-2026");
    assert.equal(await claveCorrecta("Clave-de-prueba-2026", hash, salt), true);
    assert.equal(await claveCorrecta("otra-clave-cualquiera", hash, salt), false);
  });

  it("dos usuarios con la misma clave tienen hashes distintos", async () => {
    const uno = await hashDeClave("Misma-clave-123");
    const otro = await hashDeClave("Misma-clave-123");
    assert.notEqual(uno.hash, otro.hash);
    assert.notEqual(uno.salt, otro.salt);
  });

  it("exige claves mínimamente razonables", () => {
    assert.ok(problemaDeClave("corta1"));
    assert.ok(problemaDeClave("solamenteletras"));
    assert.equal(problemaDeClave("clavelarga2026"), null);
  });

  it("la sesión firmada no se puede alterar", () => {
    const token = crearToken("usr_1", "ejecutivo");
    const sesion = leerToken(token);
    assert.equal(sesion?.uid, "usr_1");
    assert.equal(sesion?.rol, "ejecutivo");

    // Cambiar el rol en la carga invalida la firma.
    const [carga] = token.split(".");
    const adulterada = Buffer.from(
      JSON.stringify({ uid: "usr_1", rol: "admin", exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString("base64url");
    assert.equal(leerToken(`${adulterada}.${token.split(".")[1]}`), null);
    assert.equal(leerToken(`${carga}.firmafalsa`), null);
    assert.equal(leerToken(undefined), null);
  });

  it("los permisos distinguen ejecutivo de jefatura", () => {
    assert.equal(puede("ejecutivo", "ver_toda_la_cartera"), false);
    assert.equal(puede("ejecutivo", "editar_cierre"), true);
    assert.equal(puede("jefe_comercial", "ver_toda_la_cartera"), true);
    assert.equal(puede("jefe_comercial", "gestionar_usuarios"), false);
    assert.equal(puede("admin", "gestionar_usuarios"), true);
    assert.equal(puede("operaciones", "ver_control_de_gestion"), false);
  });
});

describe("control de gestión", () => {
  it("mide el tiempo hasta la primera respuesta", () => {
    const lead = nuevoLead({ id: "lead_1", nombre: "Camila" });
    const base = new Date("2026-09-10T14:00:00Z");
    const mensajes = [
      nuevoMensaje({
        id: "m1",
        leadId: "lead_1",
        direccion: "entrante",
        cuerpo: "hola",
        enviadoEn: base.toISOString(),
      }),
      nuevoMensaje({
        id: "m2",
        leadId: "lead_1",
        direccion: "saliente",
        cuerpo: "hola!",
        enviadoEn: new Date(base.getTime() + 25 * 60_000).toISOString(),
      }),
    ];
    assert.equal(minutosPrimeraRespuesta(lead, mensajes), 25);
  });

  it("cuenta como sin responder al lead que nunca recibió salida", () => {
    const lead = nuevoLead({ id: "lead_2", nombre: "Diego" });
    const mensajes = [
      nuevoMensaje({ id: "m3", leadId: "lead_2", direccion: "entrante", cuerpo: "hola" }),
    ];
    assert.equal(minutosPrimeraRespuesta(lead, mensajes), null);
  });

  it("agrupa la cartera por ejecutivo", () => {
    const usuarios = [
      { id: "usr_1", nombre: "Paula", email: "p@c.cl", rol: "ejecutivo" as const, activo: true, creadoEn: "", ultimoIngresoEn: null },
      { id: "usr_2", nombre: "Rodrigo", email: "r@c.cl", rol: "ejecutivo" as const, activo: true, creadoEn: "", ultimoIngresoEn: null },
    ];
    const leads = [
      nuevoLead({ id: "lead_1", nombre: "A", ejecutivoId: "usr_1" }),
      nuevoLead({ id: "lead_2", nombre: "B", ejecutivoId: "usr_1" }),
      nuevoLead({ id: "lead_3", nombre: "C", ejecutivoId: "usr_2" }),
    ];
    const negocios = [
      negocio({ leadId: "lead_1", ejecutivoId: "usr_1", precioUf: 4000, comisionUf: 95 }),
    ];

    const filas = metricasPorEjecutivo({
      usuarios,
      leads,
      oportunidades: [],
      mensajes: [],
      visitas: [],
      negocios,
    });

    const paula = filas.find((fila) => fila.ejecutivo?.id === "usr_1")!;
    assert.equal(paula.leads, 2);
    assert.equal(paula.negociosActivos, 1);
    assert.equal(paula.pipelineUf, 4000);

    const rodrigo = filas.find((fila) => fila.ejecutivo?.id === "usr_2")!;
    assert.equal(rodrigo.leads, 1);
    assert.equal(rodrigo.pipelineUf, 0);
  });

  it("resume lo que hizo el agente y por qué se detuvo", () => {
    const auditoria = auditoriaDelAgente(
      [],
      [],
      [
        { id: "a1", leadId: "l1", tipo: "envio_bloqueado", detalle: "Fuera del horario de contacto (9:00 a 21:00)", autor: "agente", ocurridaEn: "" },
        { id: "a2", leadId: "l2", tipo: "envio_bloqueado", detalle: "Fuera del horario de contacto (9:00 a 21:00)", autor: "agente", ocurridaEn: "" },
        { id: "a3", leadId: "l3", tipo: "derivado_a_humano", detalle: "Escalado por negociación de precio", autor: "agente", ocurridaEn: "" },
        { id: "a4", leadId: "l4", tipo: "opt_out", detalle: "Pidió la baja", autor: "agente", ocurridaEn: "" },
      ],
    );

    assert.equal(auditoria.enviosBloqueados, 2);
    assert.equal(auditoria.escalamientos, 1);
    assert.equal(auditoria.bajas, 1);
    assert.equal(auditoria.motivosDeFreno[0].motivo, "Fuera del horario de contacto");
    assert.equal(auditoria.motivosDeFreno[0].veces, 2);
  });
});
