/**
 * Pruebas del cliente de JetBrokers contra el mock local.
 *
 * El API real no se toca: el mock replica el contrato del documento.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { crearMock, clientesRecibidos } from "../mock/servidor";
import { ErrorLimiteAlcanzado, JetBrokers } from "../src/lib/jetbrokers/cliente";
import { conDetalle, desdeResumen } from "../src/lib/jetbrokers/mapeo";
import { normalizarTags, validarCliente } from "../src/lib/jetbrokers/validacion";

const PUERTO = 4011;
const mock = crearMock(PUERTO);

function cliente(opciones: { escritura?: boolean } = {}) {
  return new JetBrokers({
    organizationId: "91CerSOi",
    baseUrl: mock.url,
    permitirEscritura: opciones.escritura ?? false,
  });
}

describe("cliente JetBrokers", () => {
  before(async () => {
    await mock.escuchar();
  });

  after(async () => {
    await mock.cerrar();
  });

  it("busca proyectos y los normaliza al modelo interno", async () => {
    const api = cliente();
    const resumenes = await api.buscarProyectos();
    assert.ok(resumenes.length >= 2);

    const mirador = resumenes.find((resumen) => resumen.id === "cpmoqN5r");
    assert.ok(mirador, "falta el proyecto de ejemplo del documento");
    const proyecto = desdeResumen(mirador);
    assert.equal(proyecto.id, "cpmoqN5r");
    assert.equal(proyecto.comuna, "La Reina");
    // bestPrice y reservaCLP llegan como string y deben quedar numéricos.
    assert.equal(proyecto.precioDesdeUf, 3066.32);
    assert.equal(proyecto.reservaClp, 1_200_000);
    assert.deepEqual(proyecto.tags, ["Bono pie", "Subsidio"]);
  });

  it("aplica los filtros del buscador", async () => {
    const api = cliente();
    const soloNunoa = await api.buscarProyectos({ locality: "Ñuñoa" });
    assert.equal(soloNunoa.length, 1);
    assert.equal(soloNunoa[0].name, "Parque Ñuñoa");

    const baratos = await api.buscarProyectos({ bestPriceTo: 2500 });
    assert.ok(baratos.length > 0);
    for (const proyecto of baratos) {
      assert.ok(Number(proyecto.bestPrice) <= 2500, `${proyecto.name} quedó sobre el filtro`);
    }
    assert.ok(baratos.some((proyecto) => proyecto.id === "fudT9zPw"));
  });

  it("completa el proyecto con el detalle", async () => {
    const api = cliente();
    const [resumen] = await api.buscarProyectos({ locality: "La Reina" });
    const detalle = await api.detalleProyecto(resumen.id);
    const proyecto = conDetalle(desdeResumen(resumen), detalle);

    assert.equal(proyecto.modelos.length, 4);
    assert.equal(proyecto.precioDesdeUf, 2094.74);
    assert.equal(proyecto.precioHastaUf, 10043.32);
    // fee llega como "10.00" y es el porcentaje de comisión del broker.
    assert.equal(proyecto.feePorcentaje, 10);
    assert.equal(proyecto.brokerEmail, "sarai@greatsantiagobrokers.com");
    assert.ok(proyecto.beneficios.includes("mall"));
  });

  it("no llama al API cuando la escritura está deshabilitada", async () => {
    mock.reiniciarLimite();
    const api = cliente();
    const resultado = await api.crearCliente({ fullName: "Camila Fuentes", salary: 2_400_000 });

    assert.equal(resultado.enviado, false);
    assert.equal(clientesRecibidos.length, 0);
    assert.ok(resultado.avisos.some((aviso) => aviso.includes("Simulación")));
  });

  it("crea el cliente cuando la escritura está habilitada", async () => {
    mock.reiniciarLimite();
    const api = cliente({ escritura: true });
    const resultado = await api.crearCliente({
      fullName: "Matías Contreras",
      email: "matias@gmail.com",
      salary: 2_400_000,
      savingsBalance: 28_000_000,
      hasDicom: false,
      status: "scheduled",
      tags: "preaprobado,inversion",
    });

    assert.equal(resultado.enviado, true);
    assert.equal(clientesRecibidos.length, 1);

    const recibido = clientesRecibidos[0] as Record<string, unknown>;
    // Los montos deben viajar como número: la API descarta los strings.
    assert.equal(typeof recibido.salary, "number");
    assert.equal(recibido.savingsBalance, 28_000_000);
    assert.equal(recibido.status, "scheduled");
  });

  it("respeta el límite de 10 clientes por hora", async () => {
    mock.reiniciarLimite();
    const api = cliente({ escritura: true });

    for (let i = 0; i < 10; i++) {
      await api.crearCliente({ fullName: `Comprador ${i}` });
    }
    assert.equal(api.cuposRestantes(), 0);

    await assert.rejects(
      () => api.crearCliente({ fullName: "Uno de más" }),
      (error: unknown) => error instanceof ErrorLimiteAlcanzado,
    );
    // El cliente frena antes de llamar: el mock no recibió el número 11.
    assert.equal(clientesRecibidos.length, 10);
  });

  it("descarga archivos y arma su URL pública", async () => {
    const api = cliente();
    assert.equal(
      api.urlArchivo("m8sTzD4t", 800, 600),
      `${mock.url}/api/gallery/download/91CerSOi/m8sTzD4t/800/600`,
    );
    const archivo = await api.descargarArchivo("m8sTzD4t");
    assert.equal(archivo.mime, "application/pdf");
    assert.ok(archivo.contenido.byteLength > 0);
  });

  it("lee el video de la sala de reuniones", async () => {
    const api = cliente();
    const video = await api.videoSalaReuniones();
    assert.match(video ?? "", /^https:\/\//);
  });
});

describe("validación del payload de cliente", () => {
  it("recorta los campos que exceden el largo máximo", () => {
    const { payload, avisos } = validarCliente({
      fullName: "Javiera Soto",
      comments: "x".repeat(700),
    });
    assert.equal(payload.comments?.length, 500);
    assert.ok(avisos.some((aviso) => aviso.includes("comments")));
  });

  it("convierte números enviados como texto y descarta los que no lo son", () => {
    const { payload, avisos } = validarCliente({
      fullName: "Diego Pizarro",
      salary: "1800000" as unknown as number,
      savingsBalance: "no sé" as unknown as number,
    });
    assert.equal(payload.salary, 1_800_000);
    assert.equal(payload.savingsBalance, undefined);
    assert.ok(avisos.some((aviso) => aviso.includes("savingsBalance")));
  });

  it("descarta valores fuera de los enums aceptados", () => {
    const { payload, avisos } = validarCliente({
      fullName: "Antonia Riquelme",
      status: "vendido" as never,
      sex: "otro" as never,
      civilStatus: "married",
    });
    assert.equal(payload.status, undefined);
    assert.equal(payload.sex, undefined);
    assert.equal(payload.civilStatus, "married");
    assert.equal(avisos.length, 2);
  });

  it("valida el formato de dateOfBirth", () => {
    const bueno = validarCliente({ fullName: "A", dateOfBirth: "1990-05-12" });
    assert.equal(bueno.payload.dateOfBirth, "1990-05-12");

    const malo = validarCliente({ fullName: "A", dateOfBirth: "12/05/1990" });
    assert.equal(malo.payload.dateOfBirth, undefined);
  });

  it("rechaza tags con espacios o coma final", () => {
    const { valor, descartados } = normalizarTags(["preaprobado", "bono pie", "inversion", ""]);
    assert.equal(valor, "preaprobado,inversion");
    assert.deepEqual(descartados, ["bono pie"]);
  });

  it("exige fullName", () => {
    assert.throws(() => validarCliente({ fullName: "  " }));
  });
});

describe("superficie de los modelos", () => {
  it("usa la superficie total cuando el interior llega en cero", async () => {
    const { superficieUtil } = await import("../src/lib/jetbrokers/mapeo");
    // El modelo A8 del ejemplo oficial trae surfaceInterior "0.00".
    assert.equal(
      superficieUtil({ surfaceInterior: "0.00", surfaceTotal: "50.34" } as never),
      50.34,
    );
    assert.equal(
      superficieUtil({ surfaceInterior: "155.44", surfaceTotal: "164.09" } as never),
      155.44,
    );
    assert.equal(superficieUtil({ surfaceInterior: "0.00", surfaceTotal: "0.00" } as never), null);
  });
});
