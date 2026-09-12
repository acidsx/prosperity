/**
 * Devolución de estado a JetBrokers: no reenviar lo mismo, respetar el
 * límite de diez por hora y dejar pendiente lo que no alcanzó.
 */

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { clientesRecibidos, crearMock } from "../mock/servidor";
import { crearNegocio, cumplirHito, marcarCaido } from "../src/lib/cierre/negocio";
import { tiendaMemoria } from "../src/lib/datos/memoria";
import { nuevoLead } from "../src/lib/dominio/fabricas";
import type { Calificacion, Oportunidad } from "../src/lib/dominio/tipos";
import { LIMITE_POR_HORA_ESTANDAR } from "../src/lib/jetbrokers/cliente";
import { reintentarPendientes, sincronizarCliente } from "../src/lib/jetbrokers/sincronizacion";

const PUERTO = 4060;
const mock = crearMock(PUERTO);

function calificacion(cambios: Partial<Calificacion> = {}): Calificacion {
  return {
    puntaje: 84,
    temperatura: "caliente",
    presupuestoUfEstimado: 3399,
    pieUfEstimado: 700,
    perfil: {
      rentaClp: 2_400_000,
      rentaVariableClp: null,
      tipoRenta: "fixed",
      tienePareja: null,
      rentaParejaClp: null,
      rentaParejaVariableClp: null,
      tipoRentaPareja: null,
      capacidadAhorroClp: null,
      ahorroClp: 28_000_000,
      tieneCuentaBancaria: null,
      tieneDicom: false,
      creditosHipotecarios: null,
      dividendosMensualesClp: null,
      creditosConsumo: null,
      cuotasConsumoMensualesClp: null,
      paraInvertir: null,
      paraVivir: true,
    },
    comunasInteres: ["Ñuñoa"],
    urgencia: "alta",
    recomendaciones: [],
    objeciones: [],
    riesgos: [],
    razonamiento: "Buen calce",
    estadoSugerido: "scheduled",
    siguienteAccion: "responder_y_agendar",
    mensajeRespuesta: "Hola Camila",
    horariosPropuestos: [],
    tags: ["preaprobado"],
    motor: "heuristica",
    calificadoEn: new Date().toISOString(),
    ...cambios,
  };
}

function oportunidad(leadId: string): Oportunidad {
  const ahora = new Date().toISOString();
  return {
    id: `opo_${leadId}`,
    leadId,
    proyectoId: "cpmoqN5r",
    modelo: "A8",
    estado: "scheduled",
    calificacion: calificacion(),
    valorUf: 3200,
    comisionUf: 320,
    motivoPerdida: null,
    sincronizadoEn: null,
    huellaSincronizacion: null,
    sincronizacion: "pendiente",
    detalleSincronizacion: null,
    creadaEn: ahora,
    actualizadaEn: ahora,
  };
}

/** Deja un lead calificado y listo para sincronizar. */
async function escenario(leadId = "lead_sinc"): Promise<string> {
  await tiendaMemoria.reiniciar({ proyectos: 3, leads: 1, semilla: 7 });
  mock.reiniciarLimite();

  await tiendaMemoria.crearLead(
    nuevoLead({
      id: leadId,
      nombre: "Camila Fuentes",
      email: `${leadId}@gmail.com`,
      telefono: "+56912345678",
      canal: "portal_inmobiliario",
    }),
  );
  await tiendaMemoria.guardarOportunidad(oportunidad(leadId));
  return leadId;
}

describe("sincronización con JetBrokers", () => {
  const previo: Record<string, string | undefined> = {};

  before(async () => {
    await mock.escuchar();
    for (const clave of [
      "JETBROKERS_ORG_ID",
      "JETBROKERS_BASE_URL",
      "JETBROKERS_ESCRITURA",
      "JETBROKERS_IP_WHITELIST",
    ]) {
      previo[clave] = process.env[clave];
    }
    process.env.JETBROKERS_ORG_ID = "91CerSOi";
    process.env.JETBROKERS_BASE_URL = mock.url;
    process.env.JETBROKERS_ESCRITURA = "true";
    process.env.JETBROKERS_IP_WHITELIST = "false";
  });

  after(async () => {
    await mock.cerrar();
    for (const [clave, valor] of Object.entries(previo)) {
      if (valor === undefined) delete process.env[clave];
      else process.env[clave] = valor;
    }
  });

  beforeEach(async () => {
    // Cada prueba estrena cliente: la ventana de envíos vive en la instancia.
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("prosperity.jetbrokers")];
  });

  it("envía el cliente la primera vez", async () => {
    const leadId = await escenario();
    const resultado = await sincronizarCliente(leadId);

    assert.equal(resultado.estado, "enviado");
    assert.equal(clientesRecibidos.length, 1);

    const enviado = clientesRecibidos[0] as Record<string, unknown>;
    assert.equal(enviado.fullName, "Camila Fuentes");
    assert.equal(enviado.status, "scheduled");
    assert.equal(enviado.salary, 2_400_000);

    const guardada = await tiendaMemoria.oportunidadDeLead(leadId);
    assert.equal(guardada?.sincronizacion, "enviado");
    assert.ok(guardada?.huellaSincronizacion, "no quedó registrada la huella");
  });

  it("no reenvía un payload idéntico: gastaría uno de los diez envíos", async () => {
    const leadId = await escenario();
    await sincronizarCliente(leadId);
    assert.equal(clientesRecibidos.length, 1);

    const repetido = await sincronizarCliente(leadId);
    assert.equal(repetido.estado, "sin_cambios");
    assert.equal(clientesRecibidos.length, 1, "se reenvió algo que el CRM ya tenía");
  });

  it("reenvía si se fuerza, aunque no haya cambios", async () => {
    const leadId = await escenario();
    await sincronizarCliente(leadId);
    const forzado = await sincronizarCliente(leadId, { forzar: true });

    assert.equal(forzado.estado, "enviado");
    assert.equal(clientesRecibidos.length, 2);
  });

  it("la etapa del cierre manda sobre el estado del pipeline", async () => {
    const leadId = await escenario();
    await sincronizarCliente(leadId);

    let negocio = crearNegocio({
      leadId,
      proyectoId: "cpmoqN5r",
      precioUf: 3200,
      compradores: [{ nombre: "Camila Fuentes", rut: null, email: null, telefono: null, estadoCivil: null }],
    });
    negocio = cumplirHito(negocio, "reserva_firmada");
    await tiendaMemoria.guardarNegocio(negocio);

    const resultado = await sincronizarCliente(leadId);
    assert.equal(resultado.estado, "enviado");
    assert.equal(
      (clientesRecibidos[clientesRecibidos.length - 1] as Record<string, unknown>).status,
      "closing",
    );

    // Y al caerse, el CRM tiene que enterarse.
    await tiendaMemoria.guardarNegocio(marcarCaido(negocio, "Crédito rechazado"));
    await sincronizarCliente(leadId);
    assert.equal(
      (clientesRecibidos[clientesRecibidos.length - 1] as Record<string, unknown>).status,
      "dropped",
    );
  });

  it("al agotarse el cupo deja la sincronización pendiente, no falla", async () => {
    const leadId = await escenario();

    // Se consumen los diez envíos de la hora con otros leads.
    for (let i = 0; i < LIMITE_POR_HORA_ESTANDAR; i++) {
      const otro = `lead_relleno_${i}`;
      await tiendaMemoria.crearLead(
        nuevoLead({ id: otro, nombre: `Comprador ${i}`, email: `c${i}@gmail.com` }),
      );
      await tiendaMemoria.guardarOportunidad(oportunidad(otro));
      await sincronizarCliente(otro);
    }
    assert.equal(clientesRecibidos.length, LIMITE_POR_HORA_ESTANDAR);

    const sinCupo = await sincronizarCliente(leadId);
    assert.equal(sinCupo.estado, "sin_cupo");
    // Y no se intentó igual: el mock no recibió nada más.
    assert.equal(clientesRecibidos.length, LIMITE_POR_HORA_ESTANDAR);

    const guardada = await tiendaMemoria.oportunidadDeLead(leadId);
    assert.equal(guardada?.sincronizacion, "pendiente");
    assert.match(guardada?.detalleSincronizacion ?? "", /cupo/i);
  });

  it("el reintento se detiene apenas se acaba el cupo: es por IP, no por lead", async () => {
    await escenario();

    for (let i = 0; i < LIMITE_POR_HORA_ESTANDAR; i++) {
      const otro = `lead_relleno_${i}`;
      await tiendaMemoria.crearLead(
        nuevoLead({ id: otro, nombre: `Comprador ${i}`, email: `c${i}@gmail.com` }),
      );
      await tiendaMemoria.guardarOportunidad(oportunidad(otro));
      await sincronizarCliente(otro);
    }

    // Tres pendientes esperando cupo.
    for (let i = 0; i < 3; i++) {
      const pendiente = `lead_pendiente_${i}`;
      await tiendaMemoria.crearLead(
        nuevoLead({ id: pendiente, nombre: `Pendiente ${i}`, email: `p${i}@gmail.com` }),
      );
      await tiendaMemoria.guardarOportunidad({
        ...oportunidad(pendiente),
        sincronizacion: "pendiente",
      });
    }

    const recibidosAntes = clientesRecibidos.length;
    const resultado = await reintentarPendientes();

    assert.equal(resultado.enviados, 0);
    assert.equal(resultado.sinCupo, 1, "debería cortar al primer rechazo, no insistir con cada lead");
    assert.equal(clientesRecibidos.length, recibidosAntes);
  });

  it("sin escritura habilitada no sale nada y la huella no se guarda", async () => {
    const leadId = await escenario();
    process.env.JETBROKERS_ESCRITURA = "false";
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("prosperity.jetbrokers")];

    try {
      const resultado = await sincronizarCliente(leadId);
      assert.equal(resultado.estado, "simulado");
      assert.equal(clientesRecibidos.length, 0);

      const guardada = await tiendaMemoria.oportunidadDeLead(leadId);
      // Sin huella: el CRM no tiene estos datos, hay que reintentar después.
      assert.equal(guardada?.huellaSincronizacion, null);
      assert.equal(guardada?.sincronizacion, "simulado");
    } finally {
      process.env.JETBROKERS_ESCRITURA = "true";
    }
  });

  it("sin organizationId no hace nada", async () => {
    const leadId = await escenario();
    const org = process.env.JETBROKERS_ORG_ID;
    delete process.env.JETBROKERS_ORG_ID;
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("prosperity.jetbrokers")];

    try {
      const resultado = await sincronizarCliente(leadId);
      assert.equal(resultado.estado, "sin_configurar");
    } finally {
      process.env.JETBROKERS_ORG_ID = org;
    }
  });
});
