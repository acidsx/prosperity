/**
 * Operación del cierre: crear el negocio, planificar los hitos, cumplirlos y
 * saber qué está atrasado.
 */

import { formatearUf } from "@/lib/dominio/chile";
import {
  ETAPAS_CIERRE,
  PLAN_CIERRE,
  definicionHito,
  precioFinalUf,
  type EtapaCierre,
  type Hito,
  type Negocio,
  type Parte,
  type TipoHito,
} from "@/lib/dominio/cierre";
import {
  documentosDeLaOperacion,
  documentoPropiedad,
  vigenciaDocumento,
  type DocumentoNegocio,
} from "@/lib/documentos/propiedad";

/**
 * Suma días hábiles, saltando sábados y domingos.
 *
 * No considera feriados: el calendario chileno cambia cada año y una tabla
 * desactualizada daría fechas peor que no tenerla. Las fechas son estimaciones
 * para detectar atrasos, no plazos contractuales.
 */
export function sumarDiasHabiles(desde: Date, dias: number): Date {
  const fecha = new Date(desde);
  let restantes = dias;
  while (restantes > 0) {
    fecha.setDate(fecha.getDate() + 1);
    const dia = fecha.getDay();
    if (dia !== 0 && dia !== 6) restantes -= 1;
  }
  return fecha;
}

export interface DatosNegocio {
  leadId: string;
  proyectoId: string | null;
  unidad?: string | null;
  modelo?: string | null;
  precioUf: number;
  descuentoUf?: number;
  reservaClp?: number;
  ejecutivoId?: string | null;
  compradores: Parte[];
  vendedor?: Parte | null;
  comisionUf?: number | null;
  esCopropiedad?: boolean;
  vendedorConHipoteca?: boolean;
  vendedorCasado?: boolean;
  id?: string;
  desde?: Date;
}

export function crearNegocio(datos: DatosNegocio): Negocio {
  const inicio = datos.desde ?? new Date();
  const ahora = inicio.toISOString();

  const hitos: Hito[] = PLAN_CIERRE.map((definicion) => ({
    tipo: definicion.tipo,
    comprometidoPara: sumarDiasHabiles(inicio, definicion.diasEstimados).toISOString(),
    cumplidoEn: null,
    nota: null,
  }));

  const esCopropiedad = datos.esCopropiedad ?? true;
  const documentos: DocumentoNegocio[] = documentosDeLaOperacion({
    esCopropiedad,
    vendedorConHipoteca: datos.vendedorConHipoteca ?? false,
    vendedorCasado: datos.vendedorCasado ?? false,
  }).map((definicion) => ({
    documento: definicion.id,
    emitidoEn: null,
    recibidoEn: null,
    archivo: null,
    nota: null,
  }));

  return {
    id: datos.id ?? `neg_${Math.random().toString(36).slice(2, 10)}`,
    leadId: datos.leadId,
    proyectoId: datos.proyectoId,
    unidad: datos.unidad ?? null,
    modelo: datos.modelo ?? null,
    precioUf: datos.precioUf,
    descuentoUf: datos.descuentoUf ?? 0,
    reservaClp: datos.reservaClp ?? 0,
    ejecutivoId: datos.ejecutivoId ?? null,
    etapa: "reserva",
    compradores: datos.compradores,
    vendedor: datos.vendedor ?? null,
    credito: null,
    firmas: [],
    cbr: null,
    hitos,
    documentos,
    esCopropiedad,
    comisionUf: datos.comisionUf ?? null,
    comisionFacturada: false,
    motivoCaida: null,
    creadoEn: ahora,
    actualizadoEn: ahora,
  };
}

export function hito(negocio: Negocio, tipo: TipoHito): Hito | undefined {
  return negocio.hitos.find((item) => item.tipo === tipo);
}

export function cumplido(negocio: Negocio, tipo: TipoHito): boolean {
  return Boolean(hito(negocio, tipo)?.cumplidoEn);
}

/**
 * Etapa deducida de los hitos cumplidos. La etapa no se declara a mano: se
 * desprende de lo que efectivamente pasó.
 */
export function etapaSegunHitos(negocio: Negocio): EtapaCierre {
  if (negocio.motivoCaida) return "caido";
  if (cumplido(negocio, "factura_comision") && cumplido(negocio, "entrega_propiedad")) {
    return "cerrado";
  }

  // La última etapa con al menos un hito cumplido manda, salvo que la
  // siguiente ya haya empezado.
  let actual: EtapaCierre = "reserva";
  for (const etapa of ETAPAS_CIERRE) {
    const suyos = PLAN_CIERRE.filter((definicion) => definicion.etapa === etapa);
    if (suyos.length === 0) continue;
    if (suyos.some((definicion) => cumplido(negocio, definicion.tipo))) actual = etapa;
  }

  // Si todos los hitos de la etapa actual están cumplidos, la operación pasa a
  // la siguiente: la etapa indica dónde está la pelota hoy, no cuál fue el
  // último hito cumplido. Eso además adelanta las alertas de documentos, que
  // es cuando conviene pedirlos.
  const pendientesDeLaEtapa = PLAN_CIERRE.filter(
    (definicion) =>
      definicion.etapa === actual &&
      definicion.tipo !== "reserva_vence" &&
      definicion.tipo !== "plazo_escritura" &&
      !cumplido(negocio, definicion.tipo),
  );
  if (pendientesDeLaEtapa.length === 0) {
    const indice = ETAPAS_CIERRE.indexOf(actual);
    if (indice >= 0 && indice < ETAPAS_CIERRE.length - 1) return ETAPAS_CIERRE[indice + 1];
  }

  return actual;
}

export function cumplirHito(
  negocio: Negocio,
  tipo: TipoHito,
  opciones: { fecha?: string; nota?: string } = {},
): Negocio {
  const actualizado: Negocio = structuredClone(negocio);
  const registro = actualizado.hitos.find((item) => item.tipo === tipo);
  if (!registro) throw new Error(`El negocio no tiene el hito ${tipo}`);

  registro.cumplidoEn = opciones.fecha ?? new Date().toISOString();
  if (opciones.nota) registro.nota = opciones.nota;

  actualizado.etapa = etapaSegunHitos(actualizado);
  actualizado.actualizadoEn = new Date().toISOString();
  return actualizado;
}

export function marcarCaido(negocio: Negocio, motivo: string): Negocio {
  return {
    ...structuredClone(negocio),
    etapa: "caido",
    motivoCaida: motivo,
    actualizadoEn: new Date().toISOString(),
  };
}

export type GravedadAlerta = "critica" | "alta" | "media";

export interface Alerta {
  negocioId: string;
  gravedad: GravedadAlerta;
  titulo: string;
  detalle: string;
  /** A quién hay que apurar. */
  responsable: string;
  /** Días de atraso, o negativos si aún no vence. */
  dias: number;
}

/**
 * Qué está atrasado o por vencer. Es el corazón del control: un cierre no se
 * cae por falta de trabajo, se cae porque a nadie le avisó que el certificado
 * venció o que el banco lleva tres semanas sin responder.
 */
export function alertasDelNegocio(negocio: Negocio, ahora = new Date()): Alerta[] {
  const alertas: Alerta[] = [];
  if (negocio.etapa === "cerrado" || negocio.etapa === "caido") return alertas;

  for (const registro of negocio.hitos) {
    if (registro.cumplidoEn || !registro.comprometidoPara) continue;
    const definicion = definicionHito(registro.tipo);
    const atraso = Math.floor(
      (ahora.getTime() - new Date(registro.comprometidoPara).getTime()) / 86_400_000,
    );
    if (atraso < 0) continue;

    // El vencimiento de la reserva y el plazo de la promesa tienen
    // consecuencias contractuales: no son un atraso más.
    const esPlazoDuro = registro.tipo === "reserva_vence" || registro.tipo === "plazo_escritura";

    alertas.push({
      negocioId: negocio.id,
      gravedad: esPlazoDuro ? "critica" : atraso >= 7 ? "alta" : "media",
      titulo: esPlazoDuro ? `${definicion.nombre}: plazo cumplido` : `${definicion.nombre} atrasado`,
      detalle: esPlazoDuro
        ? `${definicion.detalle} Hace ${atraso} día(s).`
        : `Comprometido hace ${atraso} día(s). ${definicion.detalle}`,
      responsable: definicion.responsable,
      dias: atraso,
    });
  }

  for (const registro of negocio.documentos) {
    const vigencia = vigenciaDocumento(registro, ahora);
    const definicion = documentoPropiedad(registro.documento);
    if (!definicion) continue;

    if (vigencia.estado === "vencido") {
      alertas.push({
        negocioId: negocio.id,
        gravedad: "critica",
        titulo: `${definicion.nombre} vencido`,
        detalle: `Venció hace ${Math.abs(vigencia.diasRestantes ?? 0)} día(s). Hay que volver a pedirlo: ${definicion.donde}`,
        responsable: definicion.responsable,
        dias: Math.abs(vigencia.diasRestantes ?? 0),
      });
    } else if (vigencia.estado === "por_vencer") {
      alertas.push({
        negocioId: negocio.id,
        gravedad: "alta",
        titulo: `${definicion.nombre} por vencer`,
        detalle: `Quedan ${vigencia.diasRestantes} día(s). Si la escritura no alcanza, hay que pedirlo de nuevo.`,
        responsable: definicion.responsable,
        dias: -(vigencia.diasRestantes ?? 0),
      });
    } else if (vigencia.estado === "sin_recibir" && definicion.obligatorio) {
      // Solo alerta si ya estamos en la etapa que lo exige o después.
      const indiceRequerido = ETAPAS_CIERRE.indexOf(definicion.requeridoEn);
      const indiceActual = ETAPAS_CIERRE.indexOf(negocio.etapa);
      if (indiceActual >= indiceRequerido && indiceRequerido >= 0) {
        alertas.push({
          negocioId: negocio.id,
          gravedad: "alta",
          titulo: `Falta ${definicion.nombre}`,
          detalle: `${definicion.motivo} Se pide en: ${definicion.donde}`,
          responsable: definicion.responsable,
          dias: 0,
        });
      }
    }
  }

  if (negocio.credito?.estado === "rechazada") {
    alertas.push({
      negocioId: negocio.id,
      gravedad: "critica",
      titulo: "Crédito rechazado",
      detalle: `${negocio.credito.banco} rechazó la solicitud. Hay que presentar en otro banco o el negocio se cae.`,
      responsable: "corredora",
      dias: 0,
    });
  }

  // Una tasación bajo el precio significa que el comprador tiene que poner
  // más pie: es el momento de avisar, no cuando falta la plata en la firma.
  const tasacion = negocio.credito?.tasacionUf;
  if (tasacion && tasacion < precioFinalUf(negocio)) {
    const brecha = Math.round((precioFinalUf(negocio) - tasacion) * 100) / 100;
    alertas.push({
      negocioId: negocio.id,
      gravedad: "alta",
      titulo: "Tasación bajo el precio",
      detalle: `El banco tasó en ${formatearUf(tasacion)} y el precio es ${formatearUf(
        precioFinalUf(negocio),
      )}. Faltan ${formatearUf(brecha)} de pie.`,
      responsable: "comprador",
      dias: 0,
    });
  }

  if ((negocio.credito?.reparos.length ?? 0) > 0) {
    alertas.push({
      negocioId: negocio.id,
      gravedad: "alta",
      titulo: "Reparos en el estudio de títulos",
      detalle: negocio.credito!.reparos.join(" · "),
      responsable: "vendedor",
      dias: 0,
    });
  }

  if ((negocio.cbr?.reparos.length ?? 0) > 0) {
    alertas.push({
      negocioId: negocio.id,
      gravedad: "critica",
      titulo: "El Conservador puso reparos",
      detalle: negocio.cbr!.reparos.join(" · "),
      responsable: "notaria",
      dias: 0,
    });
  }

  return alertas.sort((a, b) => {
    const orden = { critica: 0, alta: 1, media: 2 };
    return orden[a.gravedad] - orden[b.gravedad] || b.dias - a.dias;
  });
}

/** Porcentaje de avance, contando solo los hitos que son trabajo. */
export function avance(negocio: Negocio): number {
  const contables = negocio.hitos.filter(
    (item) => item.tipo !== "reserva_vence" && item.tipo !== "plazo_escritura",
  );
  if (contables.length === 0) return 0;
  const listos = contables.filter((item) => item.cumplidoEn).length;
  return Math.round((listos / contables.length) * 100);
}

/** Próximo hito pendiente: lo que hay que empujar hoy. */
export function siguienteHito(negocio: Negocio): { hito: Hito; nombre: string; responsable: string } | null {
  for (const definicion of PLAN_CIERRE) {
    if (definicion.tipo === "reserva_vence" || definicion.tipo === "plazo_escritura") continue;
    const registro = hito(negocio, definicion.tipo);
    if (registro && !registro.cumplidoEn) {
      return { hito: registro, nombre: definicion.nombre, responsable: definicion.responsable };
    }
  }
  return null;
}
