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

import {
  turnoDelCloser,
  fichaDeHechos,
  PROMPTS,
  type Incumplimiento,
  type Intervencion,
  type VersionPrompt,
} from "@/lib/agente/closer";
import { unidadesPedidas } from "@/lib/agente/cartera";
import { extraerPerfilHeuristico } from "@/lib/agente/heuristica";
import { buscarCandidatos } from "@/lib/agente/matching";
import type { ProveedorModelo } from "@/lib/agente/modelo";
import { ETIQUETA_PERFIL, type PerfilProspecto } from "@/lib/agente/persona";
import { tienda } from "@/lib/datos";
import { inventario } from "@/lib/datos/inventario";
import { incentivos } from "@/lib/datos/incentivos";
import { incentivosUtilizables } from "@/lib/dominio/incentivos";
import { bloquesDisponibles, valorUf } from "@/lib/dominio/chile";
import { capacidadCompra } from "@/lib/dominio/financiamiento";
import {
  alternativasDeFinanciamiento,
  mejorAlternativa,
  type TipoAlternativa,
} from "@/lib/dominio/alternativas";
import { nuevoLead, nuevoMensaje } from "@/lib/dominio/fabricas";
import type { Lead, PerfilFinanciero } from "@/lib/dominio/tipos";

export type GuionCloser = "A" | "B" | "C";

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
  version: VersionPrompt;
  nombreVersion: string;
  intervencion: Intervencion;
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
    texto: "hola! vi el reel del depto en su insta 😊 sigue disponible?",
    canal: "whatsapp",
    nota: "Entra por redes, informal y sin decir a qué viene.",
  },
  {
    dia: 0,
    texto:
      "Para vivir yo, sería mi primera compra. Igual me da cosa equivocarme. Gano $1.800.000 líquidos con contrato indefinido y tengo $18.000.000 ahorrados.",
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
    texto:
      "Estimados: tengo capital disponible y estoy evaluando entrar a renta residencial. ¿Qué stock manejan y en qué comunas? Quedo atento.",
    canal: "email",
    nota: "Entra formal y por correo. Misma pregunta de radar, otro resultado.",
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
    texto:
      "¿Y cómo hago para las 4 si el banco me va a evaluar por una? Me hablaron de estructurar varios créditos en paralelo. ¿Ustedes hacen eso?",
    canal: "whatsapp",
    nota: "Acá el v2.5 ofrece la Estructuración Simultánea. Es el turno que estrena esta versión.",
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

/**
 * El cliente problemático: hostil, desconfiado y regateando.
 *
 * No es un caso de borde. Es el que llega después de que dos corredoras le
 * prometieron cosas que no cumplieron, y el que más rápido expone si un
 * agente tiene algo que decir o solo tiene guion.
 */
const GUION_C: PasoGuion[] = [
  {
    dia: 0,
    texto:
      "Buenas. Antes que nada te aviso: ya me mintieron dos corredoras. Si me vas a hablar de oportunidad única cortamos aquí.",
    canal: "whatsapp",
    nota: "Abre a la defensiva y prohíbe explícitamente el gancho de escasez.",
  },
  {
    dia: 0,
    texto:
      "Para vivir. Y otra cosa: quiero descuento. Vi uno parecido 400 UF más barato. Igualan o me voy.",
    canal: "whatsapp",
    nota: "Perfil A, pero negociando precio de entrada.",
  },
  {
    dia: 1,
    texto: "¿Estoy hablando con un bot? Porque si es un bot cierro el chat altiro.",
    canal: "whatsapp",
  },
  {
    dia: 2,
    texto: "Ya. Dame una razón para no irme a la competencia.",
    canal: "whatsapp",
  },
];

/**
 * Guiones extendidos para las versiones con reglas de cadencia.
 *
 * Un prompt que exige mensajes de dos líneas, un beneficio por vez y tres
 * respuestas positivas antes de cerrar no cabe en cuatro turnos: la
 * conversación se corta antes de que la regla alcance a operar. Estos
 * guiones son los mismos prospectos, con las reacciones cortas que en una
 * conversación real de WhatsApp van entremedio.
 */
const GUION_A_CADENCIA: PasoGuion[] = [
  GUION_A[0],
  GUION_A[1],
  {
    dia: 0,
    texto: "Sí, o sea... me gustaría tener algo mío. Llevo 6 años arrendando y siento que tiro la plata.",
    canal: "whatsapp",
    nota: "Respuesta emocional y larga. Acá la regla 4 pide extraer, no vender.",
  },
  GUION_A[2],
  { dia: 1, texto: "Sí, eso me tranquiliza un poco.", canal: "whatsapp" },
  GUION_A[3],
  { dia: 2, texto: "Sí, me suena bien.", canal: "whatsapp", nota: "Tercer sí. Recién acá la regla 5 habilita agendar." },
  GUION_A[4],
];

const GUION_B_CADENCIA: PasoGuion[] = [
  GUION_B[0],
  GUION_B[1],
  { dia: 0, texto: "Correcto.", canal: "whatsapp" },
  GUION_B[2],
  { dia: 1, texto: "Entiendo. Sí, tiene sentido.", canal: "whatsapp" },
  GUION_B[3],
  { dia: 2, texto: "Ya, sí.", canal: "whatsapp", nota: "Tercer sí." },
  GUION_B[4],
];

const GUION_C_CADENCIA: PasoGuion[] = [
  GUION_C[0],
  GUION_C[1],
  {
    dia: 0,
    texto: "Ya. ¿Y por qué debería creerte a ti?",
    canal: "whatsapp",
    nota: "No da ningún sí. La regla 5 bloquea el cierre.",
  },
  GUION_C[2],
  { dia: 1, texto: "Al menos eres honesto.", canal: "whatsapp" },
  GUION_C[3],
];

export interface OpcionesCloser {
  guion: GuionCloser;
  proveedor: ProveedorModelo;
  ejecutivoId?: string | null;
  /** Momento desde el que corre la conversación. Por defecto, el ancla. */
  ahora?: Date;
  /** Versión del prompt con la que se corre. */
  version?: VersionPrompt;
  /** "ninguna" corre el prompt literal y deja pasar lo que salga. */
  intervencion?: Intervencion;
}

export async function simularCloser(opciones: OpcionesCloser): Promise<ResultadoCloser> {
  const db = tienda();
  // Las versiones con reglas de cadencia usan el guion extendido.
  const conCadencia = opciones.version === "v26";
  const guion = conCadencia
    ? opciones.guion === "A"
      ? GUION_A_CADENCIA
      : opciones.guion === "B"
        ? GUION_B_CADENCIA
        : GUION_C_CADENCIA
    : opciones.guion === "A"
      ? GUION_A
      : opciones.guion === "B"
        ? GUION_B
        : GUION_C;
  const turnos: TurnoCloser[] = [];

  const inicio = opciones.ahora ?? ANCLA_GRABACION;
  const fechaDe = (dia: number, minuto = 0) =>
    new Date(inicio.getTime() + dia * 86_400_000 + minuto * 60_000);

  const [proyectos, uf] = await Promise.all([inventario(), valorUf()]);

  const identidades: Record<GuionCloser, { nombre: string; email: string; telefono: string; canal: Lead["canal"] }> = {
    A: { nombre: "Sofía Reyes", email: "sofia.reyes@gmail.com", telefono: "+56 9 5544 3322", canal: "portal_inmobiliario" },
    B: { nombre: "Rodrigo Salazar", email: "rodrigo.salazar@gmail.com", telefono: "+56 9 7788 1122", canal: "portal_inmobiliario" },
    C: { nombre: "Patricio Vergara", email: "p.vergara@outlook.cl", telefono: "+56 9 6611 4477", canal: "whatsapp" },
  };
  const identidad = identidades[opciones.guion];
  const nombre = identidad.nombre;
  const lead: Lead = nuevoLead({
    nombre,
    email: identidad.email,
    telefono: identidad.telefono,
    canal: identidad.canal,
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
    version: opciones.version ?? "v1",
    nombreVersion: PROMPTS[opciones.version ?? "v1"].nombre,
    intervencion: opciones.intervencion ?? "correccion",
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

    // La unidad más barata del inventario marca la brecha que hay que cerrar:
    // sin eso no se puede dimensionar un bono pie ni un pie en cuotas.
    const masBarata = proyectos
      .flatMap((proyecto) => proyecto.modelos.map((modelo) => modelo.priceFinal))
      .filter((precio) => precio > 0)
      .sort((uno, otro) => uno - otro)[0] ?? null;

    // Solo lo vigente y verificado llega al agente. Lo vencido y lo que nadie
    // ha revisado sale como alerta para el equipo, no como argumento de venta.
    const beneficios = incentivosUtilizables(incentivos(), cuandoEntra);

    const alternativas = alternativasDeFinanciamiento({
      perfil: perfilFinanciero,
      capacidadBase: capacidad,
      valorUfClp: uf.valor,
      precioObjetivoUf: masBarata,
      proyectos,
      ahora: cuandoEntra,
      incentivos: beneficios,
    });

    // Si con su capacidad actual no entra nada, se busca de nuevo con el techo
    // que abre la mejor alternativa. Quedarse en "no hay nada en tu rango"
    // teniendo bono pie y pie cero en el inventario es no hacer el trabajo.
    const techoBase = capacidad.precioMaximoUf;
    const laMejor = masBarata ? mejorAlternativa(alternativas, masBarata) : null;
    const techoAmpliado = Math.max(techoBase ?? 0, laMejor?.precioMaximoUf ?? 0);
    const alcanzaSolo = (techoBase ?? 0) >= (masBarata ?? Infinity);

    const candidatos = buscarCandidatos(proyectos, {
      presupuestoUf: techoBase !== null ? Math.max(techoBase, techoAmpliado) : null,
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
      .map((candidato) => {
        const precioUf = Math.round(candidato.precioUf!);
        const entraSolo = techoBase === null || precioUf <= techoBase;
        return {
          proyecto: candidato.proyecto,
          modelo: candidato.modelo,
          precioUf,
          requiereAlternativa: entraSolo
            ? null
            : ((laMejor?.tipo ?? null) as TipoAlternativa | null),
        };
      });

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
      alternativas: alcanzaSolo ? alternativas.slice(0, 2) : alternativas,
      incentivos: beneficios,
      intervencion: opciones.intervencion ?? "correccion",
      ahora: cuandoEntra,
    });

    // ------------------------------------------------------ el modelo
    const { salida, problemas, reintentos } = await turnoDelCloser(opciones.proveedor, {
      ficha,
      historial: [...historial],
      mensajeDelProspecto: paso.texto,
      canal: paso.canal,
      etiqueta: `${opciones.guion}-${indice + 1}`,
      version: opciones.version ?? "v1",
      intervencion: opciones.intervencion ?? "correccion",
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
