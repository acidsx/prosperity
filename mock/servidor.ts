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
  {
    id: "kR7mzQ2x",
    name: "Altos del Valle",
    slug: "kR7mzQ2x-altos-del-valle",
    cover: null,
    locality: "Las Condes",
    developer: "Inmobiliaria Almagro",
    dateOfDelivery: "Diciembre",
    yearOfDelivery: 2027,
    reservaCLP: "1000000",
    bestPrice: "6480.00",
    stage: "green",
    mode: "new",
    scope: "market",
    tags: ["UF Congelada", "Bono pie 10"],
  },
  {
    id: "b4TnwL9c",
    name: "Distrito Central",
    slug: "b4TnwL9c-distrito-central",
    cover: null,
    locality: "Santiago Centro",
    developer: "Fundamenta",
    dateOfDelivery: "Marzo",
    yearOfDelivery: 2026,
    reservaCLP: "200000",
    bestPrice: "1740.00",
    stage: "deliveryReady",
    mode: "new",
    scope: "market",
    tags: ["Subsidio", "Pie cero", "Airbnb"],
  },
  {
    id: "hY3pvD6k",
    name: "Portal del Sol",
    slug: "hY3pvD6k-portal-del-sol",
    cover: null,
    locality: "Maipú",
    developer: "Socovesa",
    dateOfDelivery: "mediados",
    yearOfDelivery: 2027,
    reservaCLP: "300000",
    bestPrice: "2150.00",
    stage: "white",
    mode: "new",
    scope: "private",
    tags: ["Subsidio", "Bono pie 5", "Crédito hipotecario"],
  },
  {
    id: "qW8jsF1n",
    name: "Terrazas del Parque",
    slug: "qW8jsF1n-terrazas-del-parque",
    cover: null,
    locality: "Providencia",
    developer: "Grupo Patio Vivienda",
    dateOfDelivery: "Septiembre",
    yearOfDelivery: 2026,
    reservaCLP: "800000",
    bestPrice: "4320.00",
    stage: "deliveryReady",
    mode: "used",
    scope: "market",
    tags: ["Arriendo garantizado", "DFL2", "Amoblado"],
  },
  {
    id: "zC5gbR4v",
    name: "Vista Bahía",
    slug: "zC5gbR4v-vista-bahia",
    cover: null,
    locality: "Viña del Mar",
    developer: "Constructora Andes",
    dateOfDelivery: "Junio",
    yearOfDelivery: 2028,
    reservaCLP: "500000",
    bestPrice: "3150.00",
    stage: "green",
    mode: "new",
    scope: "market",
    tags: ["Airbnb", "Arriendo asegurado"],
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
  kR7mzQ2x: {
    name: "Altos del Valle",
    slug: "kR7mzQ2x-altos-del-valle",
    address: "Av. Apoquindo 6400, Las Condes",
    locality: "Las Condes",
    perks: ["metro", "gimnasio", "conserjeria"],
    perksNearby: ["mall", "clinica"],
    perksCommonAreas: ["piscina", "quincho"],
    dateOfDelivery: "Diciembre",
    yearOfDelivery: 2027,
    stage: "green",
    description: "Torre de 22 pisos frente a la línea 1, entrega diciembre 2027",
    apartmentFrom: 6480,
    apartmentTo: 12400,
    developerName: "Inmobiliaria Almagro",
    models: [
      { name: "T1", facing: "north", rooms: 1, bathrooms: 1, blueprintId: null, surfaceTotal: "46.00", surfaceInterior: "42.00", surfaceTerrace: "4.00", surfaceLogia: "0.00", surfaceGarden: "0.00", discountRateMin: "1.00", discountRateMax: "2.00", priceBase: 6600, priceFinal: 6480 },
      { name: "T3", facing: "northEast", rooms: 3, bathrooms: 2, blueprintId: null, surfaceTotal: "98.00", surfaceInterior: "88.00", surfaceTerrace: "10.00", surfaceLogia: "0.00", surfaceGarden: "0.00", discountRateMin: "1.00", discountRateMax: "2.00", priceBase: 12400, priceFinal: 12400 },
    ],
    files: [],
    reserveCLP: "1000000",
    fee: "3.00",
    mode: "new",
    scope: "market",
  },
  b4TnwL9c: {
    name: "Distrito Central",
    slug: "b4TnwL9c-distrito-central",
    address: "Av. Matta 1200, Santiago",
    locality: "Santiago Centro",
    perks: ["metro", "ciclovia"],
    perksNearby: ["supermercado", "universidad"],
    perksCommonAreas: ["cowork", "lavanderia"],
    dateOfDelivery: "Marzo",
    yearOfDelivery: 2026,
    stage: "deliveryReady",
    description: "Entrega inmediata, apto subsidio DS19, a dos cuadras del metro",
    apartmentFrom: 1740,
    apartmentTo: 2980,
    developerName: "Fundamenta",
    models: [
      { name: "E1", facing: "east", rooms: 1, bathrooms: 1, blueprintId: null, surfaceTotal: "31.00", surfaceInterior: "28.00", surfaceTerrace: "3.00", surfaceLogia: "0.00", surfaceGarden: "0.00", discountRateMin: "1.00", discountRateMax: "1.50", priceBase: 1800, priceFinal: 1740 },
      { name: "E2", facing: "west", rooms: 2, bathrooms: 1, blueprintId: null, surfaceTotal: "48.00", surfaceInterior: "44.00", surfaceTerrace: "4.00", surfaceLogia: "0.00", surfaceGarden: "0.00", discountRateMin: "1.00", discountRateMax: "1.50", priceBase: 2380, priceFinal: 2380 },
      { name: "E3", facing: "north", rooms: 3, bathrooms: 2, blueprintId: null, surfaceTotal: "62.00", surfaceInterior: "57.00", surfaceTerrace: "5.00", surfaceLogia: "0.00", surfaceGarden: "0.00", discountRateMin: "1.00", discountRateMax: "1.50", priceBase: 2980, priceFinal: 2980 },
    ],
    files: [],
    reserveCLP: "200000",
    fee: "5.50",
    mode: "new",
    scope: "market",
  },
  hY3pvD6k: {
    name: "Portal del Sol",
    slug: "hY3pvD6k-portal-del-sol",
    address: "Av. Pajaritos 3900, Maipú",
    locality: "Maipú",
    perks: ["estacionamiento", "areasverdes"],
    perksNearby: ["colegio", "supermercado"],
    perksCommonAreas: ["plaza", "juegos"],
    dateOfDelivery: "mediados",
    yearOfDelivery: 2027,
    stage: "white",
    description: "Proyecto en blanco para primera vivienda, apto subsidio",
    apartmentFrom: 2150,
    apartmentTo: 3400,
    developerName: "Socovesa",
    models: [
      { name: "P2", facing: "north", rooms: 2, bathrooms: 1, blueprintId: null, surfaceTotal: "54.00", surfaceInterior: "50.00", surfaceTerrace: "4.00", surfaceLogia: "0.00", surfaceGarden: "0.00", discountRateMin: "1.00", discountRateMax: "1.50", priceBase: 2200, priceFinal: 2150 },
      { name: "P3", facing: "south", rooms: 3, bathrooms: 2, blueprintId: null, surfaceTotal: "72.00", surfaceInterior: "66.00", surfaceTerrace: "6.00", surfaceLogia: "0.00", surfaceGarden: "0.00", discountRateMin: "1.00", discountRateMax: "1.50", priceBase: 3400, priceFinal: 3400 },
    ],
    files: [],
    reserveCLP: "300000",
    fee: "6.00",
    mode: "new",
    scope: "private",
  },
  qW8jsF1n: {
    name: "Terrazas del Parque",
    slug: "qW8jsF1n-terrazas-del-parque",
    address: "Av. Pedro de Valdivia 2100, Providencia",
    locality: "Providencia",
    perks: ["metro", "amoblado"],
    perksNearby: ["parque", "restaurantes"],
    perksCommonAreas: ["terraza", "gimnasio"],
    dateOfDelivery: "Septiembre",
    yearOfDelivery: 2026,
    stage: "deliveryReady",
    description: "Segunda mano remodelado, con arrendatario y renta garantizada",
    apartmentFrom: 4320,
    apartmentTo: 7100,
    developerName: "Grupo Patio Vivienda",
    models: [
      { name: "R2", facing: "northWest", rooms: 2, bathrooms: 2, blueprintId: null, surfaceTotal: "68.00", surfaceInterior: "62.00", surfaceTerrace: "6.00", surfaceLogia: "0.00", surfaceGarden: "0.00", discountRateMin: "1.00", discountRateMax: "1.50", priceBase: 4400, priceFinal: 4320 },
      { name: "R4", facing: "north", rooms: 4, bathrooms: 3, blueprintId: null, surfaceTotal: "112.00", surfaceInterior: "104.00", surfaceTerrace: "8.00", surfaceLogia: "0.00", surfaceGarden: "0.00", discountRateMin: "1.00", discountRateMax: "1.50", priceBase: 7100, priceFinal: 7100 },
    ],
    files: [],
    reserveCLP: "800000",
    fee: "4.00",
    mode: "used",
    scope: "market",
  },
  zC5gbR4v: {
    name: "Vista Bahía",
    slug: "zC5gbR4v-vista-bahia",
    address: "Av. Perú 500, Viña del Mar",
    locality: "Viña del Mar",
    perks: ["vistamar", "conserjeria"],
    perksNearby: ["playa", "casino"],
    perksCommonAreas: ["piscina", "terraza"],
    dateOfDelivery: "Junio",
    yearOfDelivery: 2028,
    stage: "green",
    description: "Frente al mar, pensado para renta corta",
    apartmentFrom: 3150,
    apartmentTo: 5900,
    developerName: "Constructora Andes",
    models: [
      { name: "V1", facing: "west", rooms: 1, bathrooms: 1, blueprintId: null, surfaceTotal: "42.00", surfaceInterior: "38.00", surfaceTerrace: "4.00", surfaceLogia: "0.00", surfaceGarden: "0.00", discountRateMin: "1.00", discountRateMax: "2.00", priceBase: 3200, priceFinal: 3150 },
      { name: "V3", facing: "northWest", rooms: 3, bathrooms: 2, blueprintId: null, surfaceTotal: "88.00", surfaceInterior: "80.00", surfaceTerrace: "8.00", surfaceLogia: "0.00", surfaceGarden: "0.00", discountRateMin: "1.00", discountRateMax: "2.00", priceBase: 5900, priceFinal: 5900 },
    ],
    files: [],
    reserveCLP: "500000",
    fee: "4.50",
    mode: "new",
    scope: "market",
  },
};

/** Clientes recibidos, para que las pruebas puedan revisarlos. */
export const clientesRecibidos: unknown[] = [];

const envios: number[] = [];
// 10 por hora como el API real; 900 si la IP está en la whitelist.
const LIMITE_POR_HORA = Number(process.env.LIMITE_MOCK ?? 10);

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
