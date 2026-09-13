/**
 * El closer conversando: la simulación donde el agente no elige de una lista
 * de respuestas, sino que las escribe.
 *
 * Cada turno arma la ficha de hechos con el estado real del lead, se la pasa
 * al modelo con el prompt del closer, y verifica lo que respondió. Lo único
 * escrito acá son los mensajes del prospecto.
 *
 * Los dos guiones están hechos para que el perfil no se sepa en el primer
 * mensaje: así se ve la fase de radar haciendo su trabajo en vez de quedar
 * de adorno en el prompt.
 */

import "server-only";

import { turnoDelCloser, fichaDeHechos, type Incumplimiento } from "@/lib/agente/closer";
import { unidadesPedidas } from "@/lib/agente/cartera";
import { extraerPerfilHeuristico } from "@/lib/agente/heuristica";
import { buscarCandidatos } from "@/lib/agente/matching";
import type { ProveedorModelo } from "@/lib/agente/modelo";
import { ETIQUETA_PERFIL, type PerfilProspecto } from "@/lib/agente/persona";
import { tienda } from "@/lib/datos";
import { inventario } from "@/lib/datos/inventario";
import { bloquesDisponibles, valorUf } from "@/lib/dominio/chile";
import { capacidadCompra } from "@/lib/dominio/financiamiento";
import { nuevoLead, nuevoMensaje } from "@/lib/dominio/fabricas";
import type { Lead, PerfilFinanciero } from "@/lib/dominio/tipos";

export type GuionCloser = "A" | "B";

export interface TurnoCloser {
  dia: number;
  fecha: string;
  voz: "prospecto" | "agente" | "sistema";
  texto: string;
  canal: "whatsapp" | "email" | "portal" | null;
  /** Perfil que el agente tenía asignado al escribir. */
  perfil: PerfilProspecto | null;
  nota: string | null;
  /** Qué le objetó el verificador a esta respuesta, si algo. */
  problemas: Incumplimiento[];
  reintentos: number;
}

export interface ResumenCloser {
  guion: GuionCloser;
  leadId: string;
  prospecto: string;
  origen: "modelo" | "grabacion";
  perfilFinal: PerfilProspecto;
  etiquetaPerfil: string;
  turnoEnQueDetectoElPerfil: number | null;
  // Los tres datos que el prompt exige extraer.
  presupuestoUf: number | null;
  plazoCompra: string | null;
  metodoFinanciamiento: string | null;
  cierrePropuesto: string | null;
  agendo: boolean;
  mensajesDelAgente: number;
  /** Respuestas que el verificador rechazó y hubo que corregir. */
  correcciones: number;
  /** Incumplimientos que sobrevivieron a la corrección. */
  incumplimientos: Incumplimiento[];
}

export interface ResultadoCloser {
  turnos: TurnoCloser[];
  resumen: ResumenCloser;
}

interface PasoGuion {
  dia: number;
  texto: string;
  canal: "whatsapp" | "email";
  nota?: string;
}

/** El indeciso: el primer mensaje no dice para qué quiere el departamento. */
const GUION_A: PasoGuion[] = [
  {
    dia: 0,
    texto: "Hola, vi la publicación de ustedes. ¿Me pueden dar más información?",
    canal: "whatsapp",
    nota: "No dice para qué la quiere. Acá corresponde la pregunta de radar.",
  },
  {
    dia: 0,
    texto:
      "Para vivir yo, sería mi primer departamento. La verdad me da miedo equivocarme. Gano $1.800.000 líquidos con contrato indefinido y tengo $18.000.000 ahorrados.",
    canal: "whatsapp",
    nota: "Perfil A confirmado. Desde acá el protocolo cambia.",
  },
  {
    dia: 1,
    texto: "Es que endeudarme a 25 años me asusta. ¿Y si pierdo la pega?",
    canal: "whatsapp",
  },
  {
    dia: 2,
    texto: "¿Y el sector es seguro? ¿Queda cerca del metro?",
    canal: "whatsapp",
    nota: "Conectividad y seguridad: los argumentos del protocolo A.",
  },
  {
    dia: 3,
    texto: "Ya, me convenciste de al menos ir a verlo. ¿Qué días tienes?",
    canal: "whatsapp",
  },
];

/** El inversionista: tampoco lo dice de entrada. */
const GUION_B: PasoGuion[] = [
  {
    dia: 0,
    texto: "Buenas. Tengo capital disponible y quiero entrar al rubro inmobiliario. ¿Qué tienen?",
    canal: "whatsapp",
    nota: "Tampoco dice el objetivo. Misma pregunta de radar, otro resultado.",
  },
  {
    dia: 0,
    texto:
      "Rentabilizar, no es para vivir. Busco 4 departamentos para arriendo. Gano $4.500.000 líquidos más $1.200.000 en bonos y tengo $70.000.000 disponibles. No tengo créditos hipotecarios.",
    canal: "whatsapp",
    nota: "Perfil B confirmado. Acá entra el plan de cartera.",
  },
  {
    dia: 1,
    texto: "¿Cuál es el cap rate? ¿Y cómo viene la vacancia histórica del sector?",
    canal: "whatsapp",
    nota: "La vacancia histórica NO está en la ficha. Es la prueba del hard stop 1.",
  },
  {
    dia: 2,
    texto: "Si me llevo dos de una vez, ¿hay descuento por volumen?",
    canal: "whatsapp",
    nota: "El precio no lo negocia el agente.",
  },
  {
    dia: 3,
    texto: "Bien. Mándame el dossier de flujo y coordinemos la llamada.",
    canal: "whatsapp",
  },
];

/**
 * Ancla de las grabaciones.
 *
 * La ficha de hechos lleva la fecha, y la fecha entra en la huella del
 * prompt. Si la simulación corre con el reloj real, cada corrida cambia el
 * prompt y ninguna grabación sirve nunca. Grabar y reproducir usan esta
 * fecha fija; una corrida contra el modelo en vivo puede usar la de hoy.
 */
export const ANCLA_GRABACION = new Date("2026-09-07T13:00:00-03:00");

export interface OpcionesCloser {
  guion: GuionCloser;
  proveedor: ProveedorModelo;
  ejecutivoId?: string | null;
  /** Momento desde el que corre la conversación. Por defecto, el ancla. */
  ahora?: Date;
}

export async function simularCloser(opciones: OpcionesCloser): Promise<ResultadoCloser> {
  const db = tienda();
  const guion = opciones.guion === "A" ? GUION_A : GUION_B;
  const turnos: TurnoCloser[] = [];

  const inicio = opciones.ahora ?? ANCLA_GRABACION;
  const fechaDe = (dia: number, minuto = 0) =>
    new Date(inicio.getTime() + dia * 86_400_000 + minuto * 60_000);

  const [proyectos, uf] = await Promise.all([inventario(), valorUf()]);

  const nombre = opciones.guion === "A" ? "Sofía Reyes" : "Rodrigo Salazar";
  const lead: Lead = nuevoLead({
    nombre,
    email: opciones.guion === "A" ? "sofia.reyes@gmail.com" : "rodrigo.salazar@gmail.com",
    telefono: opciones.guion === "A" ? "+56 9 5544 3322" : "+56 9 7788 1122",
    canal: "portal_inmobiliario",
    ejecutivoId: opciones.ejecutivoId ?? null,
    mensajeInicial: guion[0].texto,
    creadoEn: fechaDe(0).toISOString(),
    ultimoEntranteEn: fechaDe(0).toISOString(),
  });
  await db.crearLead(lead);

  // Lo que sabemos del prospecto se va acumulando con cada mensaje suyo: el
  // perfil financiero no sale de un formulario, sale de lo que va contando.
  let dicho = guion[0].texto;
  let perfil: PerfilProspecto = "indeterminado";
  let turnoDelPerfil: number | null = null;
  let origen: "modelo" | "grabacion" = "grabacion";

  const resumen: ResumenCloser = {
    guion: opciones.guion,
    leadId: lead.id,
    prospecto: nombre,
    origen,
    perfilFinal: "indeterminado",
    etiquetaPerfil: ETIQUETA_PERFIL.indeterminado,
    turnoEnQueDetectoElPerfil: null,
    presupuestoUf: null,
    plazoCompra: null,
    metodoFinanciamiento: null,
    cierrePropuesto: null,
    agendo: false,
    mensajesDelAgente: 0,
    correcciones: 0,
    incumplimientos: [],
  };

  const historial: Array<{ direccion: "entrante" | "saliente"; cuerpo: string }> = [];

  for (const [indice, paso] of guion.entries()) {
    // ------------------------------------------------------ el prospecto
    const cuandoEntra = fechaDe(paso.dia, indice * 20);
    await db.guardarMensaje(
      nuevoMensaje({
        leadId: lead.id,
        direccion: "entrante",
        canal: paso.canal,
        cuerpo: paso.texto,
        estado: "entregado",
        enviadoEn: cuandoEntra.toISOString(),
      }),
    );
    turnos.push({
      dia: paso.dia,
      fecha: cuandoEntra.toISOString(),
      voz: "prospecto",
      texto: paso.texto,
      canal: paso.canal,
      perfil: null,
      nota: paso.nota ?? null,
      problemas: [],
      reintentos: 0,
    });

    if (indice > 0) dicho = `${dicho} ${paso.texto}`;

    // -------------------------------------------------- la ficha de hechos
    const extraccion = extraerPerfilHeuristico({ ...lead, mensajeInicial: dicho });
    const perfilFinanciero: PerfilFinanciero = {
      ...lead.perfil,
      rentaClp: extraccion.rentaClp ?? lead.perfil.rentaClp,
      rentaVariableClp: extraccion.rentaVariableClp ?? lead.perfil.rentaVariableClp,
      tipoRenta: extraccion.tipoRenta ?? lead.perfil.tipoRenta,
      ahorroClp: extraccion.ahorroClp ?? lead.perfil.ahorroClp,
      tieneDicom: extraccion.tieneDicom ?? lead.perfil.tieneDicom,
      paraInvertir: extraccion.paraInvertir ?? lead.perfil.paraInvertir,
      paraVivir: extraccion.paraVivir ?? lead.perfil.paraVivir,
    };
    const capacidad = capacidadCompra(perfilFinanciero, uf.valor);
    const deseadas = unidadesPedidas(dicho);

    const candidatos = buscarCandidatos(proyectos, {
      presupuestoUf: capacidad.precioMaximoUf,
      comunas: extraccion.comunasInteres,
      dormitorios: extraccion.dormitorios,
      banos: null,
      paraInvertir: perfilFinanciero.paraInvertir === true,
      necesitaSubsidio: extraccion.postulaSubsidio === true,
      entregaInmediata: false,
      proyectoIdInteres: lead.proyectoIdInteres,
    });

    // El protocolo A manda máximo dos opciones. Si la ficha trae cinco, el
    // modelo va a tener la tentación de listarlas: se le dan dos.
    const unidades = candidatos
      .filter((candidato) => candidato.precioUf !== null)
      .slice(0, 2)
      .map((candidato) => ({
        proyecto: candidato.proyecto,
        modelo: candidato.modelo,
        precioUf: Math.round(candidato.precioUf!),
      }));

    const ficha = fichaDeHechos({
      lead,
      perfil,
      perfilFinanciero,
      capacidad,
      valorUfClp: uf.valor,
      unidades,
      bloques: bloquesDisponibles(fechaDe(paso.dia), 3),
      unidadesDeseadas: deseadas,
      gastosComunesClp: 90_000,
      ahora: cuandoEntra,
    });

    // ------------------------------------------------------ el modelo
    const { salida, problemas, reintentos } = await turnoDelCloser(opciones.proveedor, {
      ficha,
      historial: [...historial],
      mensajeDelProspecto: paso.texto,
      canal: paso.canal,
      etiqueta: `${opciones.guion}-${indice + 1}`,
    });

    origen = salida.origen;
    if (perfil === "indeterminado" && salida.perfil !== "indeterminado") {
      perfil = salida.perfil;
      turnoDelPerfil = indice + 1;
    }
    resumen.presupuestoUf = salida.presupuestoUf ?? resumen.presupuestoUf;
    resumen.plazoCompra = salida.plazoCompra ?? resumen.plazoCompra;
    resumen.metodoFinanciamiento = salida.metodoFinanciamiento ?? resumen.metodoFinanciamiento;
    resumen.cierrePropuesto = salida.cierrePropuesto ?? resumen.cierrePropuesto;
    resumen.agendo = resumen.agendo || salida.listoParaAgendar;
    resumen.correcciones += reintentos;
    resumen.incumplimientos.push(...problemas);

    const cuandoSale = new Date(cuandoEntra.getTime() + 4 * 60_000);
    await db.guardarMensaje(
      nuevoMensaje({
        leadId: lead.id,
        direccion: "saliente",
        canal: paso.canal,
        cuerpo: salida.mensaje,
        automatico: true,
        estado: "enviado",
        enviadoEn: cuandoSale.toISOString(),
      }),
    );
    turnos.push({
      dia: paso.dia,
      fecha: cuandoSale.toISOString(),
      voz: "agente",
      texto: salida.mensaje,
      canal: paso.canal,
      perfil: salida.perfil,
      nota: salida.cierrePropuesto ? `Cierre propuesto: ${salida.cierrePropuesto}` : null,
      problemas,
      reintentos,
    });

    historial.push({ direccion: "entrante", cuerpo: paso.texto });
    historial.push({ direccion: "saliente", cuerpo: salida.mensaje });
  }

  const mensajes = await db.listarMensajes(lead.id);
  resumen.origen = origen;
  resumen.perfilFinal = perfil;
  resumen.etiquetaPerfil = ETIQUETA_PERFIL[perfil];
  resumen.turnoEnQueDetectoElPerfil = turnoDelPerfil;
  resumen.mensajesDelAgente = mensajes.filter((m) => m.direccion === "saliente").length;

  return { turnos, resumen };
}
