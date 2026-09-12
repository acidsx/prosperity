/**
 * Pruebas del agente conversacional y del flujo de documentos, contra la
 * tienda en memoria y sin credenciales: el camino que va a correr el primer
 * día, antes de conectar WhatsApp y Resend.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { procesarEntrante } from "../src/lib/agente/conversacion";
import { intencionDeBoton, intencionHeuristica } from "../src/lib/agente/intencion";
import { tiendaMemoria } from "../src/lib/datos/memoria";
import { clasificarAdjunto, documentosPara } from "../src/lib/documentos/catalogo";
import { correoSolicitud, crearSolicitud, registrarRecepcion } from "../src/lib/documentos/solicitud";
import { nuevaVisita } from "../src/lib/dominio/fabricas";
import { bandejaSimulada, limpiarBandejaSimulada } from "../src/lib/mensajeria/simulado";
import type { Entrante } from "../src/lib/mensajeria/tipos";
import type { Lead } from "../src/lib/dominio/tipos";

function entrante(cambios: Partial<Entrante> = {}): Entrante {
  return {
    canal: "whatsapp",
    idProveedor: `wamid.${Math.random().toString(36).slice(2)}`,
    de: "56912345678",
    nombreRemitente: null,
    recibidoEn: new Date().toISOString(),
    texto: "hola",
    asunto: null,
    token: null,
    adjuntos: [],
    ...cambios,
  };
}

/** Deja un lead con teléfono conocido y una visita propuesta. */
async function escenario(): Promise<Lead> {
  await tiendaMemoria.reiniciar({ proyectos: 6, leads: 2, semilla: 99 });
  limpiarBandejaSimulada();

  const leads = await tiendaMemoria.listarLeads();
  const lead = leads[0];
  await tiendaMemoria.actualizarLead(lead.id, {
    telefono: "+56912345678",
    email: "camila@gmail.com",
    ultimoEntranteEn: new Date().toISOString(),
  });

  const proyectos = await tiendaMemoria.listarProyectos();
  const inicio = new Date(Date.now() + 36 * 3600_000);
  await tiendaMemoria.guardarVisita(
    nuevaVisita({
      leadId: lead.id,
      proyectoId: proyectos[0].id,
      inicio: inicio.toISOString(),
      fin: new Date(inicio.getTime() + 45 * 60_000).toISOString(),
      notas: "Propuesta de la prueba",
    }),
  );

  return (await tiendaMemoria.obtenerLead(lead.id))!;
}

describe("intención", () => {
  it("el botón de una plantilla no se interpreta, se lee", () => {
    assert.equal(intencionDeBoton("confirmar_visita"), "confirma_visita");
    assert.equal(intencionDeBoton("reagendar_visita"), "reagendar");
    assert.equal(intencionDeBoton("cancelar_visita"), "cancelar");
    assert.equal(intencionDeBoton("otro_boton"), null);
    assert.equal(intencionDeBoton(null), null);
  });

  it("resuelve las respuestas cortas sin modelo", () => {
    assert.equal(intencionHeuristica("sí").intencion, "confirma_visita");
    assert.equal(intencionHeuristica("dale, confirmo").intencion, "confirma_visita");
    assert.equal(intencionHeuristica("no puedo ese día, otro horario?").intencion, "reagendar");
    assert.equal(intencionHeuristica("ya no me interesa, cancelo").intencion, "cancelar");
    assert.equal(intencionHeuristica("qué documentos necesito?").intencion, "consulta_documentos");
    assert.equal(intencionHeuristica("cuánto vale el 2D?").intencion, "pregunta_precio");
    assert.equal(intencionHeuristica("prefiero hablar con una persona").intencion, "pide_humano");
    assert.equal(intencionHeuristica("hola").intencion, "saludo");
  });

  it("rescata la preferencia de horario del texto", () => {
    const lectura = intencionHeuristica("puede ser el sábado en la mañana?");
    assert.ok(lectura.preferenciaHorario?.includes("bado"));
  });
});

describe("documentos", () => {
  it("pide papeles distintos a un dependiente y a un independiente", () => {
    const dependiente = documentosPara({ independiente: false, compraEnPareja: false }).map((d) => d.id);
    assert.ok(dependiente.includes("liquidaciones_sueldo"));
    assert.ok(dependiente.includes("certificado_afp"));
    assert.ok(!dependiente.includes("carpeta_tributaria"));

    const independiente = documentosPara({ independiente: true, compraEnPareja: false }).map((d) => d.id);
    assert.ok(independiente.includes("carpeta_tributaria"));
    assert.ok(!independiente.includes("liquidaciones_sueldo"));

    const enPareja = documentosPara({ independiente: false, compraEnPareja: true }).map((d) => d.id);
    assert.ok(enPareja.includes("certificado_matrimonio"));
  });

  it("clasifica los adjuntos por el nombre del archivo", () => {
    assert.equal(clasificarAdjunto("liquidacion-agosto.pdf", "application/pdf"), "liquidaciones_sueldo");
    assert.equal(clasificarAdjunto("Certificado AFP Habitat.pdf", "application/pdf"), "certificado_afp");
    assert.equal(clasificarAdjunto("cartola-banco-chile.pdf", "application/pdf"), "cartola_ahorro");
    assert.equal(clasificarAdjunto("carpeta_tributaria_sii.pdf", "application/pdf"), "carpeta_tributaria");
  });

  it("no adivina cuando el nombre no dice nada, ni acepta archivos que no son documentos", () => {
    // Preferimos que lo revise una persona antes que marcar por recibido algo
    // que no llegó.
    assert.equal(clasificarAdjunto("documento1.pdf", "application/pdf"), null);
    assert.equal(clasificarAdjunto("IMG_4821.jpg", "image/jpeg"), null);
    assert.equal(clasificarAdjunto(null, "application/pdf"), null);
    assert.equal(clasificarAdjunto("instalador.exe", "application/x-msdownload"), null);
    // "cedula" y "rut" son pistas del mismo documento: no hay ambigüedad real.
    assert.equal(clasificarAdjunto("cedula-rut.pdf", "application/pdf"), "cedula_identidad");
  });

  it("registra la recepción parcial y después la completa", () => {
    const lead = { id: "lead_001", perfil: { tipoRenta: "fixed", tienePareja: false } } as never as Lead;
    const solicitud = crearSolicitud(lead);

    const parcial = registrarRecepcion(
      solicitud,
      [{ idAdjunto: "a1", nombre: "liquidaciones-junio.pdf", mime: "application/pdf", tamano: 1000 }],
      "email_1",
      clasificarAdjunto,
    );
    assert.deepEqual(parcial.reconocidos, ["liquidaciones_sueldo"]);
    assert.equal(parcial.solicitud.estado, "parcial");
    assert.ok(parcial.faltantes.length > 0);

    // Solo metadatos: nada del contenido del archivo queda guardado.
    const registro = parcial.solicitud.documentos.find((d) => d.documento === "liquidaciones_sueldo")!;
    assert.equal(registro.archivo?.idCorreo, "email_1");
    assert.equal(registro.archivo?.nombre, "liquidaciones-junio.pdf");
    assert.deepEqual(Object.keys(registro.archivo!).sort(), ["idAdjunto", "idCorreo", "mime", "nombre"]);

    const completa = registrarRecepcion(
      parcial.solicitud,
      [
        { idAdjunto: "a2", nombre: "certificado-afp.pdf", mime: "application/pdf", tamano: 1000 },
        { idAdjunto: "a3", nombre: "cartola-ahorro.pdf", mime: "application/pdf", tamano: 1000 },
        { idAdjunto: "a4", nombre: "cedula.jpg", mime: "image/jpeg", tamano: 1000 },
      ],
      "email_2",
      clasificarAdjunto,
    );
    assert.equal(completa.solicitud.estado, "completa");
    assert.deepEqual(completa.faltantes, []);
  });

  it("separa los adjuntos que no pudo identificar", () => {
    const lead = { id: "lead_001", perfil: { tipoRenta: "fixed", tienePareja: false } } as never as Lead;
    const recepcion = registrarRecepcion(
      crearSolicitud(lead),
      [{ idAdjunto: "a1", nombre: "scan001.pdf", mime: "application/pdf", tamano: 1 }],
      "email_1",
      clasificarAdjunto,
    );
    assert.equal(recepcion.reconocidos.length, 0);
    assert.equal(recepcion.sinClasificar.length, 1);
    assert.equal(recepcion.solicitud.estado, "pendiente");
  });

  it("el correo informa finalidad, plazo y derechos", () => {
    const lead = {
      id: "lead_001",
      nombre: "Camila Fuentes",
      perfil: { tipoRenta: "fixed", tienePareja: false },
    } as never as Lead;
    const solicitud = crearSolicitud(lead);
    const correo = correoSolicitud(lead, solicitud, { firma: "Andrés", proyecto: "Mirador Alto" });

    assert.ok(correo.asunto.includes("Mirador Alto"));
    assert.ok(correo.texto.includes("Camila"));
    // Lo que exige informar la Ley 21.719.
    assert.ok(/solo para gestionar tu preaprobaci/i.test(correo.texto), "falta la finalidad");
    assert.ok(/conservamos hasta el/i.test(correo.texto), "falta el plazo de conservación");
    assert.ok(/acceder a tus datos, corregirlos o eliminarlos/i.test(correo.texto), "faltan los derechos");
    // Y el motivo de cada documento, que es lo que baja la desconfianza.
    assert.ok(correo.texto.includes("Para qué:"));
    assert.ok(correo.html.includes("Sobre tus datos"));
  });
});

describe("procesar un mensaje entrante", () => {
  beforeEach(async () => {
    await escenario();
  });

  it("descarta el mismo mensaje dos veces: los webhooks se reintentan", async () => {
    const mensaje = entrante({ texto: "hola" });
    const primero = await procesarEntrante(mensaje);
    assert.notEqual(primero.intencion, "duplicado");

    const repetido = await procesarEntrante(mensaje);
    assert.equal(repetido.intencion, "duplicado");
    assert.equal(repetido.respondio, false);
  });

  it("confirma la visita propuesta cuando el comprador dice que sí", async () => {
    const resultado = await procesarEntrante(
      entrante({ texto: "sí, confirmo", token: "confirmar_visita" }),
    );
    assert.equal(resultado.intencion, "confirma_visita");
    assert.equal(resultado.accion, "visita confirmada");

    const visitas = await tiendaMemoria.listarVisitas();
    const confirmada = visitas.find((visita) => visita.estado === "confirmada");
    assert.ok(confirmada, "la visita no quedó confirmada");
    assert.ok(confirmada!.confirmadaEn);

    const oportunidad = await tiendaMemoria.oportunidadDeLead(confirmada!.leadId);
    assert.equal(oportunidad?.estado, "scheduled");

    // Y salió la respuesta, aunque sea a la bandeja simulada.
    assert.ok(bandejaSimulada().some((envio) => envio.canal === "whatsapp"));
  });

  it("reagenda y propone horarios nuevos", async () => {
    const resultado = await procesarEntrante(
      entrante({ texto: "no puedo ese día", token: "reagendar_visita" }),
    );
    assert.equal(resultado.intencion, "reagendar");

    const visitas = await tiendaMemoria.listarVisitas();
    const propuesta = visitas.find((visita) => visita.estado === "propuesta");
    assert.ok(propuesta);
    assert.equal(propuesta!.confirmadaEn, null);
    assert.ok(propuesta!.notas?.includes("Reagendada"));

    const oportunidad = await tiendaMemoria.oportunidadDeLead(propuesta!.leadId);
    assert.equal(oportunidad?.estado, "reschedule");
  });

  it("cancela la visita si el comprador se baja", async () => {
    const resultado = await procesarEntrante(
      entrante({ texto: "ya no puedo, cancelo", token: "cancelar_visita" }),
    );
    assert.equal(resultado.intencion, "cancelar");
    const visitas = await tiendaMemoria.listarVisitas();
    assert.ok(visitas.some((visita) => visita.estado === "cancelada"));
  });

  it("registra la baja y deja de escribir", async () => {
    const resultado = await procesarEntrante(entrante({ texto: "BAJA, no me escriban más" }));
    assert.equal(resultado.intencion, "opt_out");

    const leads = await tiendaMemoria.listarLeads();
    const lead = leads.find((item) => item.optOut);
    assert.ok(lead, "no quedó marcado el opt-out");
    assert.ok(lead!.optOutEn);

    // El acuse de la baja sale igual; lo que viene después, no.
    limpiarBandejaSimulada();
    await procesarEntrante(entrante({ texto: "hola, alguna novedad?" }));
    assert.equal(bandejaSimulada().length, 0, "se le escribió a alguien que pidió la baja");
  });

  it("escala a una persona cuando hay que negociar precio", async () => {
    const resultado = await procesarEntrante(entrante({ texto: "me pueden hacer un descuento?" }));
    assert.equal(resultado.intencion, "escalado");
    assert.ok(resultado.accion.includes("negociación de precio"));

    const leads = await tiendaMemoria.listarLeads();
    assert.ok(leads.some((lead) => lead.enManosDeHumano));
  });

  it("no vuelve a responder una conversación que tomó una persona", async () => {
    await procesarEntrante(entrante({ texto: "quiero hablar con un ejecutivo" }));
    limpiarBandejaSimulada();

    const despues = await procesarEntrante(entrante({ texto: "sigo esperando" }));
    assert.equal(despues.respondio, false);
    assert.equal(despues.accion, "la conversación la lleva una persona");
    assert.equal(bandejaSimulada().length, 0);
  });

  it("un desconocido que escribe se convierte en lead y se califica", async () => {
    const resultado = await procesarEntrante(
      entrante({
        de: "56987654321",
        nombreRemitente: "Ignacio Vergara",
        texto: "Hola, vi el proyecto y gano $2.800.000 líquidos, tengo $35.000.000 de pie. ¿Se puede visitar?",
      }),
    );

    const lead = await tiendaMemoria.buscarLeadPorContacto({ telefono: "56987654321" });
    assert.ok(lead, "no se creó el lead");
    assert.equal(lead!.nombre, "Ignacio Vergara");
    assert.ok(resultado.accion.includes("calificado"));

    const oportunidad = await tiendaMemoria.oportunidadDeLead(lead!.id);
    assert.ok(oportunidad?.calificacion, "el lead nuevo no quedó calificado");
  });

  it("registra los documentos que llegan adjuntos", async () => {
    const leads = await tiendaMemoria.listarLeads();
    const lead = leads[0];
    const solicitud = crearSolicitud(lead);
    await tiendaMemoria.guardarSolicitud(solicitud);

    const resultado = await procesarEntrante(
      entrante({
        canal: "email",
        de: "camila@gmail.com",
        texto: "Ahí van los papeles",
        token: solicitud.token,
        asunto: "Re: Documentos para tu preaprobación",
        adjuntos: [
          { idAdjunto: "a1", nombre: "liquidaciones-agosto.pdf", mime: "application/pdf", tamano: 2048 },
          { idAdjunto: "a2", nombre: "cartola-ahorro.pdf", mime: "application/pdf", tamano: 4096 },
        ],
      }),
    );

    assert.equal(resultado.intencion, "documentos");
    const actualizada = await tiendaMemoria.solicitudDeLead(lead.id);
    assert.equal(actualizada?.estado, "parcial");
    assert.ok(
      actualizada?.documentos.some(
        (pedido) => pedido.documento === "liquidaciones_sueldo" && pedido.recibidoEn !== null,
      ),
    );
  });

  it("avisa de los adjuntos que no pudo identificar", async () => {
    const leads = await tiendaMemoria.listarLeads();
    await tiendaMemoria.guardarSolicitud(crearSolicitud(leads[0]));

    const resultado = await procesarEntrante(
      entrante({
        canal: "email",
        de: "camila@gmail.com",
        texto: "adjunto",
        adjuntos: [{ idAdjunto: "a9", nombre: "scan_0001.pdf", mime: "application/pdf", tamano: 10 }],
      }),
    );
    assert.ok(resultado.avisos.some((aviso) => aviso.includes("sin clasificar")));
  });
});

describe("el aviso de escalamiento alcanza a salir", () => {
  beforeEach(async () => {
    await escenario();
  });

  it("avisa al comprador antes de marcar la conversación como tomada", async () => {
    // Si se marca primero, el propio freno de "la lleva una persona" bloquea
    // el aviso y el comprador queda sin respuesta.
    limpiarBandejaSimulada();
    const resultado = await procesarEntrante(entrante({ texto: "me hacen un descuento?" }));

    assert.equal(resultado.intencion, "escalado");
    assert.equal(resultado.respondio, true, "el comprador no recibió aviso del escalamiento");
    assert.equal(bandejaSimulada().length, 1);
    assert.ok(bandejaSimulada()[0].salida.tipo === "texto");

    const leads = await tiendaMemoria.listarLeads();
    assert.ok(leads.some((lead) => lead.enManosDeHumano));
  });

  it("también avisa cuando el comprador pide hablar con una persona", async () => {
    limpiarBandejaSimulada();
    const resultado = await procesarEntrante(entrante({ texto: "prefiero hablar con una persona" }));
    assert.equal(resultado.respondio, true);
    assert.ok(bandejaSimulada().length >= 1);
  });
});
