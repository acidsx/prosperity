/**
 * Mock del API de JetBrokers para pruebas locales.
 *
 * Replica el contrato del documento oficial: mismas rutas, mismos nombres de
 * campo y el ejemplo "Mirador Alto" tal como aparece en la página 4.
 * Permite ejercitar el cliente sin tocar el CRM real.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const ORG = "91CerSOi";

const PROYECTOS = [
  {
    id: "cpmoqN5r",
    name: "Mirador Alto",
    slug: "cpmoqN5r-mirador-alto",
    cover: null,
    locality: "La Reina",
    developer: "BConstruction",
    dateOfDelivery: "Marzo",
    yearOfDelivery: 2021,
    reservaCLP: "1200000",
    bestPrice: "3066.32",
    stage: "privateSale",
    mode: "new",
    scope: "market",
    tags: ["Bono pie", "Subsidio"],
  },
  {
    id: "fudT9zPw",
    name: "Parque Ñuñoa",
    slug: "fudT9zPw-parque-nunoa",
    cover: null,
    locality: "Ñuñoa",
    developer: "Inmobiliaria Aconcagua",
    dateOfDelivery: "mediados",
    yearOfDelivery: 2026,
    reservaCLP: "500000",
    bestPrice: "2088.00",
    stage: "green",
    mode: "used",
    scope: "private",
    tags: ["Airbnb", "DFL2"],
  },
];

const DETALLES: Record<string, unknown> = {
  cpmoqN5r: {
    name: "Mirador Alto",
    slug: "cpmoqN5r-mirador-alto",
    address: "La reina, santiago",
    locality: "La Reina",
    perks: ["ceramico", "centrocomercial", "mall", "negocios", "ubicacion"],
    perksNearby: ["mall", "supermercado", "jumbo", "lider"],
    perksCommonAreas: ["plaza", "parque"],
    dateOfDelivery: "Marzo",
    yearOfDelivery: 2021,
    stage: "privateSale",
    description: "Excelente ambiente, muy divertido y novedoso",
    gpsLat: "-33.44276369",
    gpsLon: "-70.53990223",
    allowTransfer: "no",
    buildingPermit: "yes",
    buildingPermitNumber: "33229073",
    coverId: "7L1fgS5A",
    developerName: "BConstruction",
    developerCoverId: "wn8apfmB",
    parkingFrom: "666.00",
    parkingTo: "890.00",
    storeFrom: "589.00",
    storeTo: "789.00",
    apartmentFrom: 2094.74,
    apartmentTo: 10043.32,
    brokerName: "Sarai Arquero",
    brokerEmail: "sarai@greatsantiagobrokers.com",
    brokerPhone: "555666777",
    brokerAvatarId: "E2TrmQ1y",
    organizationName: "Great Santiago Brokers",
    organizationEmail: "hello@greatsantiagobrokers.com",
    organizationPhone: "56917272828",
    organizationWeb: "www.greatsantiagobrokers.com",
    organizationPrimaryColor: "FF0000",
    buildingCompany: "B Construction",
    models: [
      { name: "A8", facing: "northEast", rooms: 2, bathrooms: 2, blueprintId: null, surfaceTotal: "50.34", surfaceInterior: "0.00", surfaceTerrace: "0.00", surfaceLogia: "0.00", surfaceGarden: "0.00", discountRateMin: "1.00", discountRateMax: "1.50", priceBase: 3200, priceFinal: 3200 },
      { name: "A7", facing: "northEast", rooms: 2, bathrooms: 1, blueprintId: null, surfaceTotal: "44.14", surfaceInterior: "0.00", surfaceTerrace: "0.00", surfaceLogia: "0.00", surfaceGarden: "0.00", discountRateMin: "1.00", discountRateMax: "1.50", priceBase: 3066.32, priceFinal: 3066.32 },
      { name: "SUPER Suit", facing: "northEast", rooms: 4, bathrooms: 4, blueprintId: "EQEhvywy", surfaceTotal: "164.09", surfaceInterior: "155.44", surfaceTerrace: "8.99", surfaceLogia: "0.00", surfaceGarden: "0.00", discountRateMin: "1.00", discountRateMax: "1.50", priceBase: 3450, priceFinal: 3450 },
      { name: "Suit triple", facing: "northEast", rooms: 3, bathrooms: 3, blueprintId: "Pb3JGmJ0", surfaceTotal: "123.99", surfaceInterior: "117.87", surfaceTerrace: "4.67", surfaceLogia: "0.00", surfaceGarden: "0.00", discountRateMin: "1.00", discountRateMax: "1.50", priceBase: 5540.04, priceFinal: 5471.71 },
    ],
    files: [
      { id: "m8sTzD4t", type: "projectBrochure", mime: "application/msword", details: null },
      { id: "Sd4FtrvO", type: "projectRender", mime: "application/vnd.ms-excel", details: null },
      { id: "Ea9Fd38Z", type: "projectBlueprint", mime: "application/pdf", details: null },
    ],
    apartmentCount: 72,
    storeCount: 72,
    parkingCount: 72,
    elevatorsCount: 3,
    apartmentsByFloor: 6,
    projectDeveloperSummary: "La mejor inmobiliaria del mundo!",
    floors: 12,
    reserveCLP: "1200000",
    reserveTarget: "broker",
    fee: "10.00",
    installmentsPreEntrega: 60,
    installmentsPostEntrega: 1,
    payMethodPreEntrega: "TARJETA/TOKU",
    payMethodPostEntrega: "GETNET",
    reserveName: "Reservasbconstruction",
    reserveTaxId: "98.345.432-1",
    reserveAccountType: "Corriente",
    reserveAccountNumber: "0099820128-3",
    reserveBank: "BCI",
    mode: "new",
    scope: "market",
  },
  fudT9zPw: {
    name: "Parque Ñuñoa",
    slug: "fudT9zPw-parque-nunoa",
    address: "Av. Irarrázaval 3400, Ñuñoa",
    locality: "Ñuñoa",
    perks: ["metro", "parque"],
    perksNearby: ["supermercado"],
    perksCommonAreas: ["quincho"],
    dateOfDelivery: "mediados",
    yearOfDelivery: 2026,
    stage: "green",
    description: "Proyecto en verde a pasos de Plaza Ñuñoa",
    apartmentFrom: 2088,
    apartmentTo: 4200,
    developerName: "Inmobiliaria Aconcagua",
    models: [
      { name: "B1", facing: "north", rooms: 1, bathrooms: 1, blueprintId: null, surfaceTotal: "38.00", surfaceInterior: "34.00", surfaceTerrace: "4.00", surfaceLogia: "0.00", surfaceGarden: "0.00", discountRateMin: "1.00", discountRateMax: "1.50", priceBase: 2088, priceFinal: 2088 },
      { name: "B3", facing: "east", rooms: 3, bathrooms: 2, blueprintId: null, surfaceTotal: "78.00", surfaceInterior: "70.00", surfaceTerrace: "8.00", surfaceLogia: "0.00", surfaceGarden: "0.00", discountRateMin: "1.00", discountRateMax: "1.50", priceBase: 4200, priceFinal: 4116 },
    ],
    files: [],
    reserveCLP: "500000",
    fee: "4.50",
    mode: "used",
    scope: "private",
  },
};

/** Clientes recibidos, para que las pruebas puedan revisarlos. */
export const clientesRecibidos: unknown[] = [];

const envios: number[] = [];
const LIMITE_POR_HORA = 10;

function json(respuesta: ServerResponse, estado: number, cuerpo: unknown) {
  const texto = JSON.stringify(cuerpo);
  respuesta.writeHead(estado, { "Content-Type": "application/json" });
  respuesta.end(texto);
}

async function leerCuerpo(peticion: IncomingMessage): Promise<Record<string, unknown>> {
  const trozos: Buffer[] = [];
  for await (const trozo of peticion) trozos.push(trozo as Buffer);
  if (trozos.length === 0) return {};
  return JSON.parse(Buffer.concat(trozos).toString("utf8"));
}

export function crearMock(puerto = 4010) {
  const servidor = createServer(async (peticion, respuesta) => {
    const url = new URL(peticion.url ?? "/", `http://localhost:${puerto}`);
    const partes = url.pathname.split("/").filter(Boolean);

    try {
      // POST /api/gallery/customer/{org}
      if (peticion.method === "POST" && partes[2] === "customer") {
        if (partes[3] !== ORG) return json(respuesta, 404, { error: "organización desconocida" });
        if (peticion.headers["content-type"] !== "application/json") {
          return json(respuesta, 415, { error: "Content-Type debe ser application/json" });
        }

        const ahora = Date.now();
        while (envios.length > 0 && envios[0] < ahora - 3600_000) envios.shift();
        if (envios.length >= LIMITE_POR_HORA) {
          return json(respuesta, 429, { error: "too many requests" });
        }

        const cuerpo = await leerCuerpo(peticion);
        if (!cuerpo.fullName) return json(respuesta, 422, { error: "fullName es obligatorio" });

        envios.push(ahora);
        clientesRecibidos.push(cuerpo);
        respuesta.writeHead(200, { "Content-Type": "application/json" });
        return respuesta.end();
      }

      // POST /api/gallery/projects
      if (peticion.method === "POST" && partes[2] === "projects") {
        const filtros = await leerCuerpo(peticion);
        if (filtros.organizationId !== ORG) {
          return json(respuesta, 404, { error: "organización desconocida" });
        }
        let resultado = PROYECTOS;
        if (typeof filtros.locality === "string") {
          resultado = resultado.filter((proyecto) => proyecto.locality === filtros.locality);
        }
        if (typeof filtros.mode === "string") {
          resultado = resultado.filter((proyecto) => proyecto.mode === filtros.mode);
        }
        if (typeof filtros.bestPriceTo === "number") {
          resultado = resultado.filter((proyecto) => Number(proyecto.bestPrice) <= (filtros.bestPriceTo as number));
        }
        return json(respuesta, 200, resultado);
      }

      // GET /api/gallery/details/{org}/{projectId}[/{userId}]
      if (peticion.method === "GET" && partes[2] === "details") {
        const detalle = DETALLES[partes[4] ?? ""];
        if (!detalle) return json(respuesta, 404, { error: "proyecto no encontrado" });
        return json(respuesta, 200, detalle);
      }

      // GET /api/gallery/download/{org}/{fileId}[/{w}/{h}]
      if (peticion.method === "GET" && partes[2] === "download") {
        respuesta.writeHead(200, { "Content-Type": "application/pdf" });
        return respuesta.end(Buffer.from("%PDF-1.4 mock"));
      }

      // GET /api/v1/jetbrokers/meeting-room-video/{org}
      if (peticion.method === "GET" && partes[3] === "meeting-room-video") {
        return json(respuesta, 200, { video: "https://video.jetbrokers.io/sala/91CerSOi.mp4" });
      }

      json(respuesta, 404, { error: "ruta no encontrada" });
    } catch (error) {
      json(respuesta, 500, { error: error instanceof Error ? error.message : "error" });
    }
  });

  return {
    servidor,
    url: `http://localhost:${puerto}`,
    escuchar: () =>
      new Promise<void>((resolver) => servidor.listen(puerto, "127.0.0.1", () => resolver())),
    cerrar: () => new Promise<void>((resolver) => servidor.close(() => resolver())),
    reiniciarLimite: () => {
      envios.length = 0;
      clientesRecibidos.length = 0;
    },
  };
}

if (process.argv[1]?.endsWith("servidor.ts")) {
  const mock = crearMock(Number(process.env.PUERTO_MOCK ?? 4010));
  mock.escuchar().then(() => console.log(`Mock de JetBrokers escuchando en ${mock.url}`));
}
