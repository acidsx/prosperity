/** Pruebas del puerto de mensajería: plantillas, frenos, WhatsApp y correo. */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { crearMockWhatsApp, enviados, firmar, webhookEstado, webhookMensaje } from "../mock/whatsapp";
import { nuevoLead, nuevoMensaje } from "../src/lib/dominio/fabricas";
import { normalizarTelefono, tokenDeAlias, correoDesdeEncabezado } from "../src/lib/dominio/chile";
import { textoDesdeHtml, leerWebhookCorreo } from "../src/lib/mensajeria/correo";
import {
  dentroDeVentana24h,
  ejerceDerechos,
  horasRestantesDeVentana,
  motivoDeEscalamiento,
  pideBaja,
  puedeEnviar,
} from "../src/lib/mensajeria/politica";
import { PLANTILLAS, renderizar, validarCatalogo, validarPlantilla } from "../src/lib/mensajeria/plantillas";
import { leerWebhookWhatsApp, WhatsApp } from "../src/lib/mensajeria/whatsapp";
import type { Lead, Mensaje } from "../src/lib/dominio/tipos";

const APP_SECRET = "secreto_de_prueba";
const PUERTO = 4031;
const mock = crearMockWhatsApp(PUERTO);

function lead(cambios: Partial<Lead> = {}): Lead {
  return nuevoLead({
    id: "lead_001",
    nombre: "Camila Fuentes",
    telefono: "+56912345678",
    email: "camila@gmail.com",
    ...cambios,
  });
}

function mensaje(cambios: Partial<Mensaje> = {}): Mensaje {
  return nuevoMensaje({
    leadId: "lead_001",
    direccion: "saliente",
    cuerpo: "hola",
    automatico: true,
    ...cambios,
  });
}

/** Un instante a media mañana en Chile, para que el horario no interfiera. */
function medioDiaEnChile(): Date {
  const fecha = new Date();
  fecha.setUTCHours(15, 0, 0, 0);
  return fecha;
}

describe("normalización de contacto chileno", () => {
  it("lleva los teléfonos a E.164 sin el signo +", () => {
    assert.equal(normalizarTelefono("+56 9 1234 5678"), "56912345678");
    assert.equal(normalizarTelefono("912345678"), "56912345678");
    assert.equal(normalizarTelefono("09 1234 5678"), "56912345678");
    assert.equal(normalizarTelefono("56912345678"), "56912345678");
    assert.equal(normalizarTelefono("(2) 2345 6789"), "56223456789");
    assert.equal(normalizarTelefono(null), null);
    assert.equal(normalizarTelefono(""), null);
  });

  it("extrae la dirección y el token de un encabezado de correo", () => {
    assert.equal(correoDesdeEncabezado("Camila Fuentes <camila@gmail.com>"), "camila@gmail.com");
    assert.equal(correoDesdeEncabezado("  CAMILA@GMAIL.COM "), "camila@gmail.com");
    assert.equal(correoDesdeEncabezado("no es un correo"), null);
    assert.equal(tokenDeAlias("documentos+ab12cd@corredora.cl"), "ab12cd");
    assert.equal(tokenDeAlias("hola@corredora.cl"), null);
  });
});

describe("catálogo de plantillas", () => {
  it("todas las plantillas pasan las reglas de Meta", () => {
    const problemas = validarCatalogo();
    assert.deepEqual(
      problemas,
      [],
      `plantillas que Meta rechazaría: ${problemas.map((p) => `${p.plantilla}: ${p.problema}`).join(" | ")}`,
    );
  });

  it("detecta los errores que hacen que Meta rechace una plantilla", () => {
    const empiezaConVariable = validarPlantilla({
      nombre: "mala_1",
      categoria: "UTILITY",
      idioma: "es",
      cuerpo: "{{1}}, tu visita quedó agendada.",
      variables: ["nombre"],
      ejemplo: ["Camila"],
      proposito: "prueba",
    });
    assert.ok(empiezaConVariable.some((p) => p.problema.includes("empezar con una variable")));

    const variablesSeguidas = validarPlantilla({
      nombre: "mala_2",
      categoria: "UTILITY",
      idioma: "es",
      cuerpo: "Hola {{1}} {{2}}, confirmamos.",
      variables: ["nombre", "apellido"],
      ejemplo: ["Camila", "Fuentes"],
      proposito: "prueba",
    });
    assert.ok(variablesSeguidas.some((p) => p.problema.includes("dos variables seguidas")));

    const numeracionSaltada = validarPlantilla({
      nombre: "mala_3",
      categoria: "UTILITY",
      idioma: "es",
      cuerpo: "Hola {{1}}, tu visita a {{3}} quedó lista.",
      variables: ["nombre", "proyecto"],
      ejemplo: ["Camila", "Mirador Alto"],
      proposito: "prueba",
    });
    assert.ok(numeracionSaltada.some((p) => p.problema.includes("corridos")));

    const nombreInvalido = validarPlantilla({
      nombre: "Confirmacion-Visita",
      categoria: "UTILITY",
      idioma: "es",
      cuerpo: "Hola, tu visita quedó lista.",
      variables: [],
      ejemplo: [],
      proposito: "prueba",
    });
    assert.ok(nombreInvalido.some((p) => p.problema.includes("minúsculas")));

    const botonLargo = validarPlantilla({
      nombre: "mala_4",
      categoria: "UTILITY",
      idioma: "es",
      cuerpo: "Hola, confirma tu visita.",
      variables: [],
      ejemplo: [],
      botones: [{ texto: "Confirmar mi visita de esta semana", id: "x" }],
      proposito: "prueba",
    });
    assert.ok(botonLargo.some((p) => p.problema.includes("20 caracteres")));
  });

  it("rellena las variables para dejar el texto legible", () => {
    const confirmacion = PLANTILLAS.find((item) => item.nombre === "confirmacion_visita")!;
    const texto = renderizar(confirmacion, [
      "Camila",
      "Prosperity Latam",
      "Mirador Alto",
      "sábado 12 a las 10:00",
    ]);
    assert.ok(texto.includes("Camila"));
    assert.ok(texto.includes("Mirador Alto"));
    assert.ok(!texto.includes("{{"));
  });
});

describe("ventana de 24 horas", () => {
  it("está abierta mientras el último mensaje del comprador sea reciente", () => {
    const hace2h = new Date(Date.now() - 2 * 3600_000).toISOString();
    const abierto = lead({ ultimoEntranteEn: hace2h });
    assert.equal(dentroDeVentana24h(abierto), true);
    assert.ok((horasRestantesDeVentana(abierto) ?? 0) > 21);
  });

  it("se cierra a las 24 horas y sin mensajes previos nunca estuvo abierta", () => {
    const hace25h = new Date(Date.now() - 25 * 3600_000).toISOString();
    assert.equal(dentroDeVentana24h(lead({ ultimoEntranteEn: hace25h })), false);
    assert.equal(dentroDeVentana24h(lead({ ultimoEntranteEn: null })), false);
    assert.equal(horasRestantesDeVentana(lead({ ultimoEntranteEn: null })), null);
  });
});

describe("frenos de envío", () => {
  it("no escribe de madrugada, salvo respuesta a algo que acaba de llegar", () => {
    const madrugada = new Date();
    madrugada.setUTCHours(7, 0, 0, 0); // 04:00 en Chile

    const bloqueado = puedeEnviar({ lead: lead(), mensajes: [], ahora: madrugada });
    assert.equal(bloqueado.permitido, false);
    assert.ok(bloqueado.motivo?.includes("horario"));
    assert.ok(bloqueado.reintentarEn instanceof Date);

    const contestando = puedeEnviar({
      lead: lead(),
      mensajes: [],
      ahora: madrugada,
      esRespuesta: true,
    });
    assert.equal(contestando.permitido, true);
  });

  it("respeta el tope diario de mensajes automáticos", () => {
    const ahora = medioDiaEnChile();
    const previos = [1, 2, 3].map((minutos) =>
      mensaje({ enviadoEn: new Date(ahora.getTime() - minutos * 3600_000).toISOString() }),
    );
    const veredicto = puedeEnviar({ lead: lead(), mensajes: previos, ahora });
    assert.equal(veredicto.permitido, false);
    assert.ok(veredicto.motivo?.includes("tope"));
  });

  it("deja de insistir después de varios mensajes sin respuesta", () => {
    const ahora = medioDiaEnChile();
    // Tres salientes seguidos, repartidos en días para no topar el límite diario.
    const previos = [72, 48, 24].map((horas) =>
      mensaje({ enviadoEn: new Date(ahora.getTime() - horas * 3600_000).toISOString() }),
    );
    const veredicto = puedeEnviar({ lead: lead(), mensajes: previos, ahora });
    assert.equal(veredicto.permitido, false);
    assert.ok(veredicto.motivo?.includes("sin respuesta"));
  });

  it("el reloj se reinicia cuando el comprador responde", () => {
    const ahora = medioDiaEnChile();
    const previos = [
      mensaje({ enviadoEn: new Date(ahora.getTime() - 72 * 3600_000).toISOString() }),
      mensaje({ enviadoEn: new Date(ahora.getTime() - 48 * 3600_000).toISOString() }),
      mensaje({
        direccion: "entrante",
        automatico: false,
        enviadoEn: new Date(ahora.getTime() - 30 * 3600_000).toISOString(),
      }),
      mensaje({ enviadoEn: new Date(ahora.getTime() - 25 * 3600_000).toISOString() }),
    ];
    assert.equal(puedeEnviar({ lead: lead(), mensajes: previos, ahora }).permitido, true);
  });

  it("no envía nada a quien pidió la baja ni a conversaciones tomadas por una persona", () => {
    const ahora = medioDiaEnChile();
    const baja = puedeEnviar({ lead: lead({ optOut: true }), mensajes: [], ahora });
    assert.equal(baja.permitido, false);

    const humano = puedeEnviar({ lead: lead({ enManosDeHumano: true }), mensajes: [], ahora });
    assert.equal(humano.permitido, false);
    assert.ok(humano.motivo?.includes("persona"));
  });

  it("espacia los mensajes que envía por iniciativa propia", () => {
    const ahora = medioDiaEnChile();
    const recien = [mensaje({ enviadoEn: new Date(ahora.getTime() - 60_000).toISOString() })];
    const veredicto = puedeEnviar({ lead: lead(), mensajes: recien, ahora });
    assert.equal(veredicto.permitido, false);
    assert.ok(veredicto.motivo?.includes("mínimo"));
  });

  it("pero contestar no espera: el espaciado no debe impedir responder", () => {
    // El caso que apareció en el flujo real: la respuesta de calificación
    // salió hace segundos y el comprador contesta confirmando la visita.
    const ahora = medioDiaEnChile();
    const recien = [mensaje({ enviadoEn: new Date(ahora.getTime() - 30_000).toISOString() })];
    const veredicto = puedeEnviar({ lead: lead(), mensajes: recien, ahora, esRespuesta: true });
    assert.equal(veredicto.permitido, true);
  });

  it("el tope absoluto del día se aplica incluso contestando", () => {
    const ahora = medioDiaEnChile();
    const muchos = Array.from({ length: 12 }, (_, i) =>
      mensaje({ enviadoEn: new Date(ahora.getTime() - (i + 1) * 60_000).toISOString() }),
    );
    const veredicto = puedeEnviar({ lead: lead(), mensajes: muchos, ahora, esRespuesta: true });
    assert.equal(veredicto.permitido, false);
    assert.ok(veredicto.motivo?.includes("absoluto"));
  });
});

describe("opt-out y escalamiento", () => {
  it("reconoce cómo se pide la baja en Chile", () => {
    for (const frase of [
      "BAJA",
      "no me escriban más por favor",
      "déjenme tranquilo",
      "ya no me interesa",
      "quiero darme de baja",
      "stop",
    ]) {
      assert.equal(pideBaja(frase), true, `no detectó: ${frase}`);
    }
    assert.equal(pideBaja("me interesa, cuándo puedo visitar"), false);
    assert.equal(pideBaja("bajaste el precio?"), false);
  });

  it("detecta el ejercicio de derechos sobre los datos en sus conjugaciones", () => {
    for (const frase of [
      "quiero que eliminen mis datos",
      "elimina mis datos por favor",
      "bórrenme los datos",
      "qué datos tienen de mí?",
      "ejerzo mi derecho a supresión",
      "esto infringe la ley 21.719",
    ]) {
      assert.equal(ejerceDerechos(frase), true, `no detectó: ${frase}`);
    }
    assert.equal(ejerceDerechos("me gusta el depto"), false);
    assert.equal(ejerceDerechos("me pasas los datos del proyecto?"), false);
  });

  it("escala precio, reclamos y pedidos de hablar con una persona", () => {
    assert.equal(motivoDeEscalamiento("me pueden hacer un descuento?"), "negociación de precio");
    assert.equal(motivoDeEscalamiento("voy a poner un reclamo en el Sernac"), "reclamo o asunto legal");
    assert.equal(
      motivoDeEscalamiento("prefiero hablar con una persona"),
      "pidió hablar con una persona",
    );
    assert.equal(motivoDeEscalamiento("eres un bot?"), "preguntó si es un bot");
    assert.equal(
      motivoDeEscalamiento("quiero eliminar mis datos"),
      "ejercicio de derechos sobre sus datos",
    );
    assert.equal(motivoDeEscalamiento("cuándo puedo visitar?"), null);
  });
});

describe("WhatsApp Cloud API", () => {
  before(async () => {
    await mock.escuchar();
  });

  after(async () => {
    await mock.cerrar();
  });

  function cliente(envio = true) {
    return new WhatsApp({
      token: "token_de_prueba",
      phoneNumberId: mock.phoneNumberId,
      appSecret: APP_SECRET,
      verifyToken: "verificame",
      baseUrl: mock.url,
      version: "v23.0",
      permitirEnvio: envio,
    });
  }

  it("envía texto y devuelve el id del mensaje", async () => {
    mock.limpiar();
    const resultado = await cliente().enviar(
      { leadId: "lead_001", nombre: "Camila", telefono: "+56912345678", email: null },
      { tipo: "texto", cuerpo: "Hola Camila" },
    );
    assert.equal(resultado.enviado, true);
    assert.match(resultado.idProveedor ?? "", /^wamid\./);
    assert.equal(enviados[0].to, "56912345678");
    assert.equal(enviados[0].texto, "Hola Camila");
  });

  it("envía plantillas con sus variables en orden", async () => {
    mock.limpiar();
    await cliente().enviar(
      { leadId: "lead_001", nombre: "Camila", telefono: "+56912345678", email: null },
      {
        tipo: "plantilla",
        plantilla: "confirmacion_visita",
        variables: ["Camila", "Prosperity", "Mirador Alto", "sábado 10:00"],
        vistaPrevia: "…",
      },
    );
    assert.equal(enviados[0].type, "template");
    assert.equal(enviados[0].plantilla, "confirmacion_visita");
    assert.deepEqual(enviados[0].variables, ["Camila", "Prosperity", "Mirador Alto", "sábado 10:00"]);
  });

  it("rechaza una plantilla con la cantidad de variables equivocada", async () => {
    await assert.rejects(() =>
      cliente().enviar(
        { leadId: "lead_001", nombre: "Camila", telefono: "+56912345678", email: null },
        { tipo: "plantilla", plantilla: "confirmacion_visita", variables: ["Camila"], vistaPrevia: "…" },
      ),
    );
  });

  it("no sale a la red cuando el envío no está habilitado", async () => {
    mock.limpiar();
    const resultado = await cliente(false).enviar(
      { leadId: "lead_001", nombre: "Camila", telefono: "+56912345678", email: null },
      { tipo: "texto", cuerpo: "Hola" },
    );
    assert.equal(resultado.enviado, false);
    assert.equal(resultado.simulado, true);
    assert.equal(enviados.length, 0);
  });

  it("no envía si el lead no tiene teléfono", async () => {
    const resultado = await cliente().enviar(
      { leadId: "lead_001", nombre: "Camila", telefono: null, email: "camila@gmail.com" },
      { tipo: "texto", cuerpo: "Hola" },
    );
    assert.equal(resultado.enviado, false);
    assert.ok(resultado.motivo?.includes("teléfono"));
  });

  it("responde el desafío de verificación solo con el token correcto", () => {
    const api = cliente();
    const parametros = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "verificame",
      "hub.challenge": "1234567890",
    });
    assert.equal(api.verificarSuscripcion(parametros), "1234567890");

    parametros.set("hub.verify_token", "otro");
    assert.equal(api.verificarSuscripcion(parametros), null);
  });

  it("verifica la firma del webhook y rechaza cuerpos alterados", () => {
    const api = cliente();
    const cuerpo = JSON.stringify(webhookMensaje({ de: "56912345678", texto: "hola" }));
    assert.equal(api.firmaValida(cuerpo, firmar(cuerpo, APP_SECRET)), true);
    assert.equal(api.firmaValida(`${cuerpo} `, firmar(cuerpo, APP_SECRET)), false);
    assert.equal(api.firmaValida(cuerpo, firmar(cuerpo, "otro_secreto")), false);
    assert.equal(api.firmaValida(cuerpo, null), false);
  });
});

describe("lectura del webhook de WhatsApp", () => {
  it("normaliza un mensaje de texto", () => {
    const { mensajes } = leerWebhookWhatsApp(
      webhookMensaje({ de: "56912345678", texto: "Sí, confirmo", nombre: "Camila Fuentes" }),
    );
    assert.equal(mensajes.length, 1);
    assert.equal(mensajes[0].de, "56912345678");
    assert.equal(mensajes[0].texto, "Sí, confirmo");
    assert.equal(mensajes[0].nombreRemitente, "Camila Fuentes");
    assert.equal(mensajes[0].canal, "whatsapp");
  });

  it("rescata el identificador del botón, no solo su texto", () => {
    const { mensajes } = leerWebhookWhatsApp(
      webhookMensaje({
        de: "56912345678",
        boton: { id: "confirmar_visita", texto: "Confirmar" },
      }),
    );
    assert.equal(mensajes[0].token, "confirmar_visita");
    assert.equal(mensajes[0].texto, "Confirmar");
  });

  it("registra los documentos adjuntos", () => {
    const { mensajes } = leerWebhookWhatsApp(
      webhookMensaje({
        de: "56912345678",
        texto: "acá van",
        documento: { id: "media_1", nombre: "liquidacion-agosto.pdf", mime: "application/pdf" },
      }),
    );
    assert.equal(mensajes[0].adjuntos.length, 1);
    assert.equal(mensajes[0].adjuntos[0].nombre, "liquidacion-agosto.pdf");
    assert.equal(mensajes[0].adjuntos[0].mime, "application/pdf");
  });

  it("traduce los estados de entrega y su motivo de falla", () => {
    const { estados } = leerWebhookWhatsApp(
      webhookEstado({ idMensaje: "wamid.abc", estado: "read", destinatario: "56912345678" }),
    );
    assert.equal(estados[0].estado, "leido");

    const fallido = leerWebhookWhatsApp(
      webhookEstado({ idMensaje: "wamid.abc", estado: "failed", destinatario: "56912345678" }),
    );
    assert.equal(fallido.estados[0].estado, "fallido");
    assert.equal(fallido.estados[0].detalle, "Re-engagement message");
  });

  it("no se cae con un webhook vacío o de otro tipo", () => {
    assert.deepEqual(leerWebhookWhatsApp({}), { mensajes: [], estados: [] });
    assert.deepEqual(leerWebhookWhatsApp({ entry: [{ changes: [{ value: {} }] }] }), {
      mensajes: [],
      estados: [],
    });
  });
});

describe("correo", () => {
  it("reconoce los eventos del webhook de Resend", () => {
    assert.deepEqual(
      leerWebhookCorreo({ type: "email.received", created_at: "2026-09-12T12:00:00Z", data: { email_id: "e1" } }),
      { tipo: "recibido", emailId: "e1", ocurridoEn: "2026-09-12T12:00:00Z" },
    );
    assert.equal(leerWebhookCorreo({ type: "email.bounced", data: { email_id: "e2" } }).tipo, "rebotado");
    assert.equal(leerWebhookCorreo({ type: "contact.created" }).tipo, "otro");
  });

  it("saca texto legible de un correo que solo trae HTML", () => {
    const texto = textoDesdeHtml(
      "<style>p{color:red}</style><p>Hola Camila</p><p>Adjunto las <b>liquidaciones</b>.</p><br>Saludos",
    );
    assert.ok(!texto.includes("<"));
    assert.ok(!texto.includes("color:red"));
    assert.ok(texto.includes("Hola Camila"));
    assert.ok(texto.includes("liquidaciones"));
  });
});
