/**
 * Datos sintéticos para operar sin conexión al CRM.
 *
 * El inventario respeta la forma de un proyecto de JetBrokers (comuna,
 * etapa, modo, alcance, tags, modelos con precio en UF) para que el mismo
 * código sirva con datos reales.
 */

import { COMUNAS } from "@/lib/dominio/chile";
import { PERFIL_VACIO, type CanalLead, type Lead, type Proyecto } from "@/lib/dominio/tipos";
import type { EtapaProyecto, ModeloProyecto, TagProyecto } from "@/lib/jetbrokers/tipos";

/** PRNG mulberry32: misma semilla, mismo escenario. */
export function crearAzar(semilla: number) {
  let estado = semilla >>> 0;
  return function azar(): number {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Azar = () => number;

function elegir<T>(azar: Azar, opciones: readonly T[]): T {
  return opciones[Math.floor(azar() * opciones.length)];
}

function entre(azar: Azar, minimo: number, maximo: number): number {
  return Math.floor(azar() * (maximo - minimo + 1)) + minimo;
}

function fechaRelativa(dias: number): string {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - dias);
  return fecha.toISOString();
}

// Nombres neutros a propósito: la comuna se sortea aparte y un nombre con
// comuna adentro produciría fichas contradictorias.
const NOMBRES_PROYECTO = [
  "Mirador Alto", "Altos del Valle", "Edificio Costanera", "Vista Cordillera", "Portal del Sol",
  "Terrazas del Parque", "Distrito Central", "Altamira", "Vista Bahía", "Puerta del Lago",
  "Los Robles", "Nuevo Horizonte", "Plaza Mayor", "El Bosque", "Alto Real",
  "Costa Azul", "Valle Verde", "Puerta Sur", "La Cima", "Jardines del Este",
];

const DESARROLLADORAS = [
  "Inmobiliaria Aconcagua", "Constructora Andes", "BConstruction", "Grupo Patio Vivienda",
  "Inmobiliaria Almagro", "Socovesa", "Fundamenta", "Echeverría Izquierdo",
];

const TAGS: TagProyecto[] = [
  "Bono pie", "Bono pie 10", "Subsidio", "Pie cero", "UF Congelada", "Tasa Congelada",
  "Arriendo garantizado", "Airbnb", "DFL2", "Amoblado", "Crédito hipotecario", "Devolución IVA",
];

const ETAPAS: EtapaProyecto[] = ["deliveryReady", "green", "privateSale", "white"];

const NOMBRES_PERSONA = [
  "Camila Fuentes", "Matías Contreras", "Javiera Soto", "Sebastián Rojas", "Constanza Muñoz",
  "Ignacio Vergara", "Fernanda Araya", "Diego Pizarro", "Antonia Riquelme", "Vicente Cáceres",
  "Valentina Bravo", "Cristóbal Herrera", "Josefa Tapia", "Benjamín Salinas", "Catalina Navarro",
  "Tomás Espinoza", "Isidora Carrasco", "Felipe Maldonado", "Martina Gallardo", "Joaquín Aravena",
];

const CANALES: CanalLead[] = [
  "portal_inmobiliario", "yapo", "toctoc", "sitio_web", "whatsapp", "referido", "instagram",
  "landing_campana",
];

function modelos(azar: Azar, ufPorM2: number): ModeloProyecto[] {
  const cantidad = entre(azar, 2, 5);
  const resultado: ModeloProyecto[] = [];
  for (let i = 0; i < cantidad; i++) {
    const dormitorios = entre(azar, 1, 4);
    const banos = Math.max(1, Math.min(dormitorios, entre(azar, 1, 3)));
    const interior = entre(azar, 32, 45) + dormitorios * entre(azar, 10, 22);
    const terraza = entre(azar, 0, 14);
    const precio = Math.round((interior + terraza * 0.5) * ufPorM2 * (0.9 + azar() * 0.25) * 100) / 100;
    const descuento = Math.round(azar() * 300) / 100;
    resultado.push({
      name: `${String.fromCharCode(65 + i)}${entre(azar, 1, 9)}`,
      facing: elegir(azar, ["north", "northEast", "east", "south", "west"]),
      rooms: dormitorios,
      bathrooms: banos,
      blueprintId: azar() > 0.5 ? `bp_${Math.floor(azar() * 1e6).toString(36)}` : null,
      surfaceTotal: (interior + terraza).toFixed(2),
      surfaceInterior: interior.toFixed(2),
      surfaceTerrace: terraza.toFixed(2),
      surfaceLogia: "0.00",
      surfaceGarden: "0.00",
      discountRateMin: "1.00",
      discountRateMax: "1.50",
      priceBase: precio,
      priceFinal: Math.round(precio * (1 - descuento / 100) * 100) / 100,
    });
  }
  return resultado;
}

export function generarProyectos(cantidad: number, semilla = 2026): Proyecto[] {
  const azar = crearAzar(semilla);
  const proyectos: Proyecto[] = [];

  for (let i = 0; i < cantidad; i++) {
    const comuna = elegir(azar, COMUNAS);
    const lista = modelos(azar, comuna.ufPorM2);
    const precios = lista.map((modelo) => modelo.priceFinal);
    const nombre = `${NOMBRES_PROYECTO[i % NOMBRES_PROYECTO.length]}${
      i >= NOMBRES_PROYECTO.length ? ` ${Math.floor(i / NOMBRES_PROYECTO.length) + 1}` : ""
    }`;
    const etapa = elegir(azar, ETAPAS);
    const id = `dm${(i + 1).toString(36).padStart(6, "0")}`;

    proyectos.push({
      id,
      nombre,
      slug: `${id}-${nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-")}`,
      comuna: comuna.nombre,
      region: comuna.region,
      direccion: `${elegir(azar, ["Av. Apoquindo", "Av. Irarrázaval", "Av. Vicuña Mackenna", "Los Leones", "Av. Perú"])} ${entre(azar, 100, 9800)}`,
      desarrollador: elegir(azar, DESARROLLADORAS),
      etapa,
      modo: azar() > 0.25 ? "new" : "used",
      alcance: azar() > 0.35 ? "market" : "private",
      precioDesdeUf: Math.min(...precios),
      precioHastaUf: Math.max(...precios),
      reservaClp: elegir(azar, [0, 200_000, 500_000, 1_000_000, 1_200_000]),
      feePorcentaje: Math.round((2 + azar() * 8) * 100) / 100,
      entrega: elegir(azar, ["Marzo", "Junio", "mediados", "Septiembre", "Diciembre"]),
      anoEntrega: entre(azar, 2026, 2029),
      tags: TAGS.filter(() => azar() > 0.78),
      modelos: lista,
      beneficios: ["mall", "supermercado", "parque", "metro", "plaza"].filter(() => azar() > 0.55),
      descripcion: `${etapa === "deliveryReady" ? "Entrega inmediata" : "En construcción"} en ${comuna.nombre}. ${lista.length} tipologías disponibles.`,
      portadaId: null,
      brokerEmail: null,
      brokerNombre: null,
      desdeApi: false,
    });
  }

  return proyectos;
}

/**
 * Consultas entrantes. Cada plantilla trae distinta cantidad de información
 * financiera, que es justamente lo que el agente tiene que extraer.
 */
const PLANTILLAS: Array<(ctx: { comuna: string; presupuesto: number }) => string> = [
  ({ comuna, presupuesto }) =>
    `Hola, vi la publicación y me interesa. Busco en ${comuna} hasta UF ${presupuesto}. Gano líquido $2.400.000 con contrato indefinido y tengo $28.000.000 ahorrados para el pie. ¿Se puede visitar esta semana?`,
  ({ presupuesto }) =>
    `Buenas tardes, tengo el crédito preaprobado por UF ${presupuesto} en el Banco de Chile con 20% de pie. ¿Aceptan ofertas bajo el precio de lista? Es para vivir con mi señora, ella gana $1.500.000 a honorarios.`,
  ({ comuna }) =>
    `Hola! Consulta por el proyecto de ${comuna}. ¿Cuánto son los gastos comunes? Estoy comparando un par de opciones, gano $1.800.000 y tengo un crédito de consumo con cuota de $180.000.`,
  () =>
    `Hola, todavía no parto el trámite del crédito, quería saber primero cuánto me prestarían. Gano líquido $1.200.000 y no tengo ahorros todavía.`,
  ({ comuna }) =>
    `Buenas, ando viendo para inversión en ${comuna}. ¿Cuánto se arrienda hoy en el edificio? Pago al contado si los números dan, tengo $180.000.000 disponibles.`,
  ({ presupuesto }) =>
    `Hola, postulé al subsidio DS19 y tengo hasta UF ${presupuesto}. ¿Este proyecto aplica para subsidio? Gano $900.000 y ahorré $6.000.000.`,
  () => `hola sigue disponible?`,
  ({ comuna }) =>
    `Estimados, estoy vendiendo mi depto en ${comuna} y comprando uno más grande. Necesito que la compra calce con la venta. ¿Manejan ese tipo de operación?`,
  ({ presupuesto }) =>
    `Hola, somos pareja y buscamos primera vivienda hasta UF ${presupuesto}. Entre los dos juntamos $3.200.000 líquidos. ¿Cuánto es el pie y qué necesitamos para reservar?`,
  () =>
    `Buen día, quisiera agendar visita el sábado en la mañana. Vivo en regiones y viajo ese fin de semana. Tengo el crédito aprobado y busco entrega inmediata.`,
  () =>
    `Hola, quiero cotizar pero les cuento de frentón que estuve en Dicom hasta el año pasado. ¿Igual puedo postular a un crédito?`,
  ({ comuna }) =>
    `Buenas! Busco depto de 2D2B en ${comuna} para arrendar en Airbnb. ¿Tienen algo con arriendo garantizado?`,
  ({ comuna, presupuesto }) =>
    `Hola, quiero agendar una visita al proyecto de ${comuna}. Tengo preaprobado UF ${presupuesto} en el Santander y $45.000.000 de pie. ¿Qué horarios tienen esta semana?`,
  ({ presupuesto }) =>
    `Buenas tardes, me gustaría ir a ver el depto. Gano $3.200.000 líquidos a honorarios y tengo $52.000.000 ahorrados. Mi tope es UF ${presupuesto}.`,
  ({ comuna }) =>
    `Hola! Somos matrimonio, buscamos casa en ${comuna} para vivir. Juntos ganamos $4.500.000 y tenemos $70.000.000 de pie. ¿Podemos visitar el sábado?`,
  ({ presupuesto }) =>
    `Estimados, quiero conocer el proyecto. Pago al contado, tengo $210.000.000 disponibles y busco hasta UF ${presupuesto} para inversión.`,
];

export function generarLeads(cantidad: number, proyectos: Proyecto[], semilla = 77): Lead[] {
  const azar = crearAzar(semilla);
  const leads: Lead[] = [];

  for (let i = 0; i < cantidad; i++) {
    const proyecto = proyectos.length > 0 && azar() > 0.15 ? elegir(azar, proyectos) : null;
    const comuna = proyecto?.comuna ?? elegir(azar, COMUNAS).nombre;
    const base = proyecto?.precioDesdeUf ?? entre(azar, 1500, 9000);
    const presupuesto = Math.round((base * (0.8 + azar() * 0.4)) / 50) * 50;
    const nombre = NOMBRES_PERSONA[i % NOMBRES_PERSONA.length];
    const usuario = nombre
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, ".");

    leads.push({
      id: `lead_${String(i + 1).padStart(3, "0")}`,
      nombre,
      email: `${usuario}@${elegir(azar, ["gmail.com", "outlook.cl", "hotmail.com", "uc.cl"])}`,
      telefono: `+569${entre(azar, 10000000, 99999999)}`,
      rut: null,
      canal: elegir(azar, CANALES),
      campana: azar() > 0.6 ? elegir(azar, ["meta-septiembre", "google-search-deptos", "remarketing-uf"]) : null,
      proyectoIdInteres: proyecto?.id ?? null,
      mensajeInicial: elegir(azar, PLANTILLAS)({ comuna, presupuesto }),
      comunasInteres: [comuna, ...(azar() > 0.65 ? [elegir(azar, COMUNAS).nombre] : [])],
      presupuestoUfDeclarado: azar() > 0.4 ? presupuesto : null,
      sexo: null,
      // El perfil financiero parte vacío a propósito: lo llena el agente
      // leyendo el mensaje, igual que haría un ejecutivo.
      perfil: { ...PERFIL_VACIO },
      creadoEn: fechaRelativa(entre(azar, 0, 10)),
    });
  }

  return leads;
}
