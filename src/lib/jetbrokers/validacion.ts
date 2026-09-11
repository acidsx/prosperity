/**
 * Saneamiento del payload de cliente antes de enviarlo a JetBrokers.
 *
 * La API es permisiva: si un campo excede el largo lo recorta, y si el tipo
 * es incorrecto lo omite en silencio. Preferimos detectarlo acá para no
 * perder datos sin enterarnos.
 */

import {
  DIGITOS_MAXIMOS,
  ESTADOS_CIVILES,
  ESTADOS_CLIENTE,
  LARGO_MAXIMO,
  SEXOS,
  TIPOS_RENTA,
  type ClienteEntrada,
} from "@/lib/jetbrokers/tipos";

export interface ResultadoValidacion {
  payload: ClienteEntrada;
  /** Campos ajustados o descartados, para dejar rastro en el timeline. */
  avisos: string[];
}

const FORMATOS_FECHA = [
  /^\d{4}-\d{2}-\d{2}$/,
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
];

/**
 * Los tags viajan como una sola string 'tag1,tag2'. La documentación
 * rechaza espacios dentro del tag y la coma final.
 */
export function normalizarTags(tags: string[]): { valor: string; descartados: string[] } {
  const validos: string[] = [];
  const descartados: string[] = [];
  for (const tag of tags) {
    const limpio = tag.trim();
    if (!limpio) continue;
    if (/[\s,]/.test(limpio)) {
      descartados.push(tag);
      continue;
    }
    if (!validos.includes(limpio)) validos.push(limpio);
  }
  return { valor: validos.join(","), descartados };
}

export function validarCliente(entrada: ClienteEntrada): ResultadoValidacion {
  const payload: ClienteEntrada = {} as ClienteEntrada;
  const avisos: string[] = [];

  const nombre = entrada.fullName?.trim();
  if (!nombre) {
    throw new Error("fullName es obligatorio para crear un cliente en JetBrokers");
  }

  for (const [clave, valor] of Object.entries(entrada) as Array<[keyof ClienteEntrada, unknown]>) {
    if (valor === undefined || valor === null || valor === "") continue;

    const largo = LARGO_MAXIMO[clave];
    if (largo !== undefined) {
      if (typeof valor !== "string") {
        avisos.push(`${clave}: se esperaba texto, se omitió`);
        continue;
      }
      let texto = valor.trim();
      if (texto.length > largo) {
        texto = texto.slice(0, largo);
        avisos.push(`${clave}: recortado a ${largo} caracteres`);
      }
      Object.assign(payload, { [clave]: texto });
      continue;
    }

    const digitos = DIGITOS_MAXIMOS[clave];
    if (digitos !== undefined) {
      // La API descarta números enviados como string: los normalizamos acá.
      const numero = typeof valor === "number" ? valor : Number(valor);
      if (!Number.isFinite(numero)) {
        avisos.push(`${clave}: valor no numérico, se omitió`);
        continue;
      }
      const redondeado = Math.round(numero);
      if (String(Math.abs(redondeado)).length > digitos) {
        avisos.push(`${clave}: excede ${digitos} dígitos, se omitió`);
        continue;
      }
      Object.assign(payload, { [clave]: redondeado });
      continue;
    }

    switch (clave) {
      case "status":
        if (!ESTADOS_CLIENTE.includes(valor as never)) {
          avisos.push(`status '${String(valor)}' no está en la lista aceptada, se omitió`);
          continue;
        }
        break;
      case "sex":
        if (!SEXOS.includes(valor as never)) {
          avisos.push(`sex '${String(valor)}' no aceptado, se omitió`);
          continue;
        }
        break;
      case "civilStatus":
        if (!ESTADOS_CIVILES.includes(valor as never)) {
          avisos.push(`civilStatus '${String(valor)}' no aceptado, se omitió`);
          continue;
        }
        break;
      case "salaryType":
      case "partnerSalaryType":
        if (!TIPOS_RENTA.includes(valor as never)) {
          avisos.push(`${clave} '${String(valor)}' no aceptado, se omitió`);
          continue;
        }
        break;
      case "dateOfBirth":
        if (typeof valor !== "string" || !FORMATOS_FECHA.some((formato) => formato.test(valor))) {
          avisos.push("dateOfBirth con formato no aceptado, se omitió");
          continue;
        }
        break;
      case "hasPartner":
      case "hasBankAccount":
      case "hasDicom":
      case "aimToInvest":
      case "aimToLive":
        if (typeof valor !== "boolean") {
          avisos.push(`${clave}: se esperaba booleano, se omitió`);
          continue;
        }
        break;
      default:
        break;
    }

    Object.assign(payload, { [clave]: valor });
  }

  payload.fullName = nombre.slice(0, LARGO_MAXIMO.fullName!);

  if (payload.tags) {
    const { valor, descartados } = normalizarTags(payload.tags.split(","));
    if (descartados.length > 0) {
      avisos.push(`tags descartados por formato: ${descartados.join(", ")}`);
    }
    if (valor) payload.tags = valor;
    else delete payload.tags;
  }

  if (payload.assignedTo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.assignedTo)) {
    avisos.push("assignedTo no parece un email válido, se omitió");
    delete payload.assignedTo;
  }

  return { payload, avisos };
}
