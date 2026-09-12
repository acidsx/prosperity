/**
 * Simulación de un inversionista que quiere varios departamentos.
 *
 * Es el opuesto del comprador temeroso: no hay miedo que acompañar, hay una
 * calculadora al otro lado. Persuadir acá no es tranquilizar, es llegar
 * antes que él a los números que lo van a decepcionar.
 *
 * Los tres momentos que la simulación existe para mostrar:
 *
 *  1. **Pide cuatro y le alcanzan dos.** El agente lo dice en el primer
 *     mensaje, antes de mostrarle una sola unidad, porque descubrirlo en la
 *     mesa del banco cuesta tres meses y la relación.
 *  2. **"Se paga solo con el arriendo" es mentira.** Cada departamento le
 *     cuesta plata todos los meses. El agente pone el dividendo contra el
 *     arriendo neto y muestra el número negativo — y después la otra mitad
 *     de la verdad, que es la amortización.
 *  3. **El descuento por volumen no lo da el agente.** Lo aprueba la
 *     inmobiliaria, así que la conversación pasa a una persona.
 *
 * Igual que las otras simulaciones, lo escrito acá son los mensajes del
 * comprador. Las respuestas las produce el código que corre en producción:
 * `planDeCartera` para el plan y `responderObjecion` para cada duda.
 */

import "server-only";

import { planDeCartera, unidadesPedidas } from "@/lib/agente/cartera";
import { procesarEntrante } from "@/lib/agente/conversacion";
import { gestionarLead } from "@/lib/agente/gestor";
import { ETIQUETA_OBJECION, type TipoObjecion } from "@/lib/agente/objeciones";
import { crearNegocio, cumplirHito, sumarDiasHabiles } from "@/lib/cierre/negocio";
import { tienda } from "@/lib/datos";
import { inventario } from "@/lib/datos/inventario";
import { nuevoId } from "@/lib/datos/tienda";
import { formatearUf, valorUf } from "@/lib/dominio/chile";
import { nuevoLead } from "@/lib/dominio/fabricas";
import type { PlanCartera } from "@/lib/dominio/inversion";
import { PERFIL_VACIO, type Lead, type PerfilFinanciero, type Proyecto } from "@/lib/dominio/tipos";
import { despachar } from "@/lib/mensajeria/despachador";
import type { Entrante } from "@/lib/mensajeria/tipos";
import type { Voz } from "@/lib/simulacion/indeciso";
import { fecharMensajesNuevos, restarDiasHabiles } from "@/lib/simulacion/reloj";

export interface TurnoInversionista {
  dia: number;
  fecha: string;
  voz: Voz;
  texto: string;
  canal: "whatsapp" | "email" | "portal" | null;
  objecion: TipoObjecion | null;
  etiquetaObjecion: string | null;
  nota: string | null;
}

export interface ResumenInversionista {
  leadId: string;
  comprador: string;
  proyecto: string | null;
  modelo: string | null;
  precioUnitarioUf: number;
  unidadesPedidas: number;
  unidadesFinanciables: number;
  restriccion: PlanCartera["restriccion"];
  pieRequeridoUf: number;
  pieDisponibleUf: number;
  dividendoTotalClp: number;
  arriendoNetoTotalClp: number;
  flujoMensualTotalClp: number;
  amortizacionTotalClp: number;
  rentabilidadBruta: number;
  rentabilidadNeta: number;
  objeciones: Array<{ tipo: TipoObjecion; etiqueta: string; intentos: number }>;
  mensajesDelAgente: number;
  escalamientos: number;
  negocioIds: string[];
  desenlace: string;
}

export interface ResultadoInversionista {
  turnos: TurnoInversionista[];
  resumen: ResumenInversionista;
}

/** Lo que escribe el inversionista, en días hábiles desde la consulta. */
const GUION: Array<{ dia: number; texto: string; nota?: string }> = [
  {
    dia: 1,
    texto: "¿Cómo que dos? El pie es tan alto, pensé que era 20% como cualquier departamento.",
    nota: "La sorpresa real: en inversión el banco financia menos.",
  },
  {
    dia: 2,
    texto: "Ya. ¿Y cuánta rentabilidad dan estos departamentos?",
    nota: "Se publican dos números y casi siempre se muestra solo el primero.",
  },
  {
    dia: 3,
    texto: "Pero se pagan solos con el arriendo, ¿no? Eso me dijeron en otra corredora.",
    nota: "La frase más repetida del rubro. Y falsa a las tasas de hoy.",
  },
  {
    dia: 4,
    texto: "¿Y si no lo arriendo por unos meses? Ahí me quedo pagando yo.",
  },
  {
    dia: 6,
    texto: "¿Las contribuciones las paga el arrendatario o yo?",
  },
  {
    dia: 8,
    texto: "Si me llevo dos de una vez, ¿me hacen descuento?",
    nota: "Un descuento por volumen lo aprueba la inmobiliaria, no el agente.",
  },
  {
    dia: 11,
    texto: "Estoy comparando esto con meter la plata en un fondo de renta inmobiliaria.",
  },
];

export interface OpcionesInversionista {
  nombre?: string;
  telefono?: string;
  email?: string;
  ejecutivoId?: string | null;
  /** Cuántas unidades pide. El guion está escrito para cuatro. */
  unidades?: number;
}

const PERFIL_INVERSIONISTA: Partial<PerfilFinanciero> = {
  rentaClp: 4_500_000,
  rentaVariableClp: 1_200_000,
  tipoRenta: "fixed",
  ahorroClp: 70_000_000,
  tieneDicom: false,
  creditosHipotecarios: 0,
  dividendosMensualesClp: null,
  paraInvertir: true,
  paraVivir: false,
};

export async function simularInversionista(
  opciones: OpcionesInversionista = {},
): Promise<ResultadoInversionista> {
  const db = tienda();
  const turnos: TurnoInversionista[] = [];

  const ULTIMO_DIA = 15;
  const inicio = restarDiasHabiles(new Date(), ULTIMO_DIA);
  const fechaDe = (dia: number) => sumarDiasHabiles(inicio, dia);

  const uf = await valorUf();

  // La unidad de inversión es la chica: es la que más se arrienda y la que
  // mejor rinde por metro. Se elige la de menor precio con hasta 2D.
  const proyectos = await inventario();
  const elegida = unidadDeInversion(proyectos);
  if (!elegida) throw new Error("No hay inventario para dimensionar una cartera");
  const { proyecto, modelo, precioUf } = elegida;

  const unidadesDeseadas = opciones.unidades ?? 4;
  const nombre = opciones.nombre ?? "Rodrigo Salazar";
  const consulta =
    `Hola. Busco comprar ${unidadesDeseadas} departamentos para arriendo. ` +
    `Gano $4.500.000 líquidos más unos $1.200.000 en bonos, tengo $70.000.000 ahorrados ` +
    `y no tengo créditos hipotecarios. ¿Qué me recomiendan?`;

  const lead: Lead = nuevoLead({
    nombre,
    email: opciones.email ?? "rodrigo.salazar@gmail.com",
    telefono: opciones.telefono ?? "+56 9 7788 1122",
    canal: "portal_inmobiliario",
    proyectoIdInteres: proyecto.id,
    comunasInteres: [proyecto.comuna],
    ejecutivoId: opciones.ejecutivoId ?? null,
    mensajeInicial: consulta,
    perfil: { ...PERFIL_VACIO, ...PERFIL_INVERSIONISTA },
    creadoEn: fechaDe(0).toISOString(),
    ultimoEntranteEn: fechaDe(0).toISOString(),
  });
  await db.crearLead(lead);

  turnos.push({
    dia: 0,
    fecha: fechaDe(0).toISOString(),
    voz: "comprador",
    texto: consulta,
    canal: "portal",
    objecion: null,
    etiquetaObjecion: null,
    nota: `Pide ${unidadesDeseadas} unidades. El agente lee la cantidad del texto: ${unidadesPedidas(consulta) ?? "no declarada"}.`,
  });

  // -------------------------------------------------- calificación estándar
  const marcaConsulta = await db.listarMensajes(lead.id);
  const gestion = await gestionarLead(lead.id, { ahora: fechaDe(0) });
  await volcar(lead.id, marcaConsulta, fechaDe(0), 0, turnos, {
    nota: "La calificación estándar mira una propiedad. Para una cartera la cuenta es otra, y es la que sigue.",
  });

  // ------------------------------------------------------ el plan de cartera
  const perfil = gestion.calificacion.perfil ?? lead.perfil;
  const plan = planDeCartera({
    primerNombre: nombre.split(" ")[0],
    perfil,
    precioUnitarioUf: precioUf,
    unidadesDeseadas,
    valorUfClp: uf.valor,
    proyecto: proyecto.nombre,
    comuna: proyecto.comuna,
    opciones: { gastosComunesClp: 90_000 },
    topeUnaPropiedadUf: gestion.calificacion.presupuestoUfEstimado,
  });

  const marcaPlan = await db.listarMensajes(lead.id);
  await despachar({
    leadId: lead.id,
    canal: "email",
    salida: {
      tipo: "correo",
      asunto: `Tu cartera: ${plan.plan.unidadesFinanciables} de ${unidadesDeseadas} unidades, con los números`,
      html: `<p>${plan.texto.replace(/\n/g, "<br>")}</p>`,
      texto: plan.texto,
    },
    esRespuesta: true,
  });
  await volcar(lead.id, marcaPlan, fechaDe(0), 0, turnos, {
    nota: plan.ajustaExpectativa
      ? "Le ajusta la expectativa antes de mostrarle una sola unidad."
      : "Las unidades que pidió salen.",
  });

  // -------------------------------------------------------- la conversación
  let escalamientos = 0;
  for (const paso of GUION) {
    const marca = await db.listarMensajes(lead.id);
    await procesarEntrante(entrante(lead, paso.texto));
    const nuevos = await fecharMensajesNuevos(lead.id, marca, fechaDe(paso.dia));

    for (const mensaje of nuevos) {
      turnos.push({
        dia: paso.dia,
        fecha: mensaje.enviadoEn,
        voz: mensaje.direccion === "entrante" ? "comprador" : "agente",
        texto: mensaje.cuerpo,
        canal: canalDe(mensaje.canal),
        objecion: (mensaje.objecion as TipoObjecion | null) ?? null,
        etiquetaObjecion: mensaje.objecion
          ? (ETIQUETA_OBJECION[mensaje.objecion as TipoObjecion] ?? null)
          : null,
        nota: mensaje.direccion === "entrante" ? (paso.nota ?? null) : null,
      });
    }

    const actual = await db.obtenerLead(lead.id);
    if (actual?.enManosDeHumano) {
      escalamientos += 1;
      const cuando = new Date(fechaDe(paso.dia).getTime() + 3 * 3600_000);
      turnos.push({
        dia: paso.dia,
        fecha: cuando.toISOString(),
        voz: "ejecutivo",
        texto:
          "Llamada del ejecutivo: consulta el descuento por dos unidades directamente con la inmobiliaria, lo deja por escrito en la reserva y devuelve la conversación al agente.",
        canal: null,
        objecion: null,
        etiquetaObjecion: null,
        nota: "El precio no lo negocia el agente. Por eso la detección de 'descuento' escala sola.",
      });
      await db.actualizarLead(lead.id, { enManosDeHumano: false });
      await db.registrarActividad({
        id: nuevoId("act"),
        leadId: lead.id,
        tipo: "derivado_a_humano",
        detalle: "Descuento por volumen consultado con la inmobiliaria; conversación devuelta al agente",
        autor: "humano",
        ocurridaEn: cuando.toISOString(),
      });
    }
  }

  // ------------------------------------------- decide comprar las que salen
  const negocioIds: string[] = [];
  for (let i = 0; i < plan.plan.unidadesFinanciables; i++) {
    let negocio = crearNegocio({
      id: nuevoId("neg"),
      leadId: lead.id,
      proyectoId: proyecto.id,
      unidad: `Depto ${60 + i * 2}${i === 0 ? "3" : "5"}`,
      modelo: modelo?.name ?? null,
      precioUf,
      reservaClp: proyecto.reservaClp ?? 500_000,
      ejecutivoId: opciones.ejecutivoId ?? null,
      compradores: [
        {
          nombre: lead.nombre,
          rut: "13.876.209-4",
          email: lead.email,
          telefono: lead.telefono,
          estadoCivil: "single",
        },
      ],
      vendedor: {
        nombre: proyecto.desarrollador ?? "Inmobiliaria",
        rut: "76.543.210-9",
        email: null,
        telefono: null,
        estadoCivil: null,
      },
      esCopropiedad: true,
      desde: fechaDe(15),
    });
    negocio = cumplirHito(negocio, "reserva_firmada", { fecha: fechaDe(15).toISOString() });
    await db.guardarNegocio(negocio);
    negocioIds.push(negocio.id);
  }

  turnos.push({
    dia: 15,
    fecha: fechaDe(15).toISOString(),
    voz: "sistema",
    texto: `Reserva ${plan.plan.unidadesFinanciables} de las ${unidadesDeseadas} unidades que pedía, en ${proyecto.nombre}. Quedan ${plan.plan.unidadesFinanciables} cierres abiertos en el CRM, uno por unidad.`,
    canal: null,
    objecion: null,
    etiquetaObjecion: null,
    nota: "Cada unidad es un cierre propio: tiene su propia escritura, su propia inscripción y su propia comisión.",
  });

  // ------------------------------------------------------------------ cierre
  const mensajes = await db.listarMensajes(lead.id);
  const objeciones: ResumenInversionista["objeciones"] = [];
  for (const mensaje of mensajes) {
    if (!mensaje.objecion) continue;
    const tipo = mensaje.objecion as TipoObjecion;
    const existente = objeciones.find((item) => item.tipo === tipo);
    if (existente) existente.intentos += 1;
    else objeciones.push({ tipo, etiqueta: ETIQUETA_OBJECION[tipo] ?? tipo, intentos: 1 });
  }

  const unidad = plan.plan.unidades[0];
  turnos.sort((uno, otro) => uno.fecha.localeCompare(otro.fecha));

  return {
    turnos,
    resumen: {
      leadId: lead.id,
      comprador: nombre,
      proyecto: proyecto.nombre,
      modelo: modelo?.name ?? null,
      precioUnitarioUf: precioUf,
      unidadesPedidas: unidadesDeseadas,
      unidadesFinanciables: plan.plan.unidadesFinanciables,
      restriccion: plan.plan.restriccion,
      pieRequeridoUf: plan.plan.pieRequeridoUf,
      pieDisponibleUf: plan.plan.pieDisponibleUf,
      dividendoTotalClp: plan.plan.dividendoTotalClp,
      arriendoNetoTotalClp: plan.plan.arriendoNetoTotalClp,
      flujoMensualTotalClp: plan.plan.flujoMensualTotalClp,
      amortizacionTotalClp: plan.plan.amortizacionTotalClp,
      rentabilidadBruta: unidad?.rentabilidadBrutaAnual ?? 0,
      rentabilidadNeta: unidad?.rentabilidadNetaAnual ?? 0,
      objeciones,
      mensajesDelAgente: mensajes.filter(
        (mensaje) => mensaje.direccion === "saliente" && mensaje.automatico,
      ).length,
      escalamientos,
      negocioIds,
      desenlace:
        `Reservó ${plan.plan.unidadesFinanciables} de ${unidadesDeseadas}, con el flujo negativo por escrito ` +
        `y sabiendo que el retorno está en la amortización y la plusvalía, no en el arriendo. ` +
        `El pie que le falta para las otras ${unidadesDeseadas - plan.plan.unidadesFinanciables}: ` +
        `${formatearUf(Math.max(unidadesDeseadas - plan.plan.unidadesFinanciables, 0) * precioUf * 0.3)}.`,
    },
  };
}

// ------------------------------------------------------------------ auxiliares

function canalDe(canal: string): "whatsapp" | "email" | "portal" {
  if (canal === "portal") return "portal";
  return canal === "email" ? "email" : "whatsapp";
}

/** La unidad que compra un inversionista: la más chica y la más barata. */
function unidadDeInversion(proyectos: Proyecto[]) {
  let mejor: { proyecto: Proyecto; modelo: Proyecto["modelos"][number]; precioUf: number } | null =
    null;
  for (const proyecto of proyectos) {
    for (const modelo of proyecto.modelos) {
      if (modelo.rooms > 2 || modelo.priceFinal <= 0) continue;
      if (!mejor || modelo.priceFinal < mejor.precioUf) {
        mejor = { proyecto, modelo, precioUf: Math.round(modelo.priceFinal) };
      }
    }
  }
  return mejor;
}

function entrante(lead: Lead, texto: string): Entrante {
  return {
    canal: "whatsapp",
    idProveedor: `sim_${nuevoId("inv")}`,
    de: (lead.telefono ?? "").replace(/\D/g, ""),
    nombreRemitente: lead.nombre,
    recibidoEn: new Date().toISOString(),
    texto,
    asunto: null,
    token: null,
    adjuntos: [],
  };
}

async function volcar(
  leadId: string,
  marca: Array<{ id: string }>,
  cuando: Date,
  dia: number,
  turnos: TurnoInversionista[],
  extra: { nota: string | null },
): Promise<void> {
  const nuevos = await fecharMensajesNuevos(leadId, marca, cuando);
  for (const mensaje of nuevos) {
    turnos.push({
      dia,
      fecha: mensaje.enviadoEn,
      voz: mensaje.direccion === "entrante" ? "comprador" : "agente",
      texto: mensaje.cuerpo,
      canal: canalDe(mensaje.canal),
      objecion: (mensaje.objecion as TipoObjecion | null) ?? null,
      etiquetaObjecion: null,
      nota: extra.nota,
    });
  }
}
