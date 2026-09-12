/**
 * Reglas y utilidades propias del mercado chileno: UF, comunas, RUT,
 * crédito hipotecario y horarios de visita.
 */

/** Valor de la UF usado cuando no hay red o mindicador.cl no responde. */
export const UF_FALLBACK_CLP = 40_000;

export const ZONA_HORARIA = "America/Santiago";

let cacheUf: { valor: number; expira: number } | null = null;

/**
 * Valor de la UF del día desde mindicador.cl (API pública del Banco Central).
 * Cachea por 6 horas y cae al valor de respaldo si la llamada falla: el
 * simulador nunca debe quedarse pegado por una dependencia externa.
 */
export async function valorUf(): Promise<{ valor: number; fuente: "mindicador" | "fallback" }> {
  if (cacheUf && cacheUf.expira > Date.now()) {
    return { valor: cacheUf.valor, fuente: "mindicador" };
  }
  try {
    const respuesta = await fetch("https://mindicador.cl/api/uf", {
      signal: AbortSignal.timeout(4000),
    });
    if (!respuesta.ok) throw new Error(`mindicador respondió ${respuesta.status}`);
    const datos = (await respuesta.json()) as { serie?: Array<{ valor?: number }> };
    const valor = datos.serie?.[0]?.valor;
    if (typeof valor !== "number" || !Number.isFinite(valor)) {
      throw new Error("mindicador no devolvió un valor de UF utilizable");
    }
    cacheUf = { valor, expira: Date.now() + 6 * 60 * 60 * 1000 };
    return { valor, fuente: "mindicador" };
  } catch {
    return { valor: UF_FALLBACK_CLP, fuente: "fallback" };
  }
}

export function ufAClp(uf: number, valorUfClp: number): number {
  return Math.round(uf * valorUfClp);
}

export function formatearClp(monto: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(monto);
}

/** Porcentaje con coma decimal, como se escribe en Chile. */
export function formatearPorcentaje(valor: number, decimales = 2): string {
  return `${valor.toLocaleString("es-CL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimales,
  })}%`;
}

export function formatearUf(uf: number): string {
  return `UF ${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(Math.round(uf))}`;
}

export function formatearFecha(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: ZONA_HORARIA,
  }).format(new Date(iso));
}

/** Dígito verificador de un RUT chileno (módulo 11). */
export function digitoVerificador(cuerpo: number): string {
  let suma = 0;
  let multiplicador = 2;
  for (const caracter of String(cuerpo).split("").reverse()) {
    suma += Number(caracter) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return "0";
  if (resto === 10) return "K";
  return String(resto);
}

export function formatearRut(cuerpo: number): string {
  const conPuntos = new Intl.NumberFormat("es-CL").format(cuerpo);
  return `${conPuntos}-${digitoVerificador(cuerpo)}`;
}

export function rutEsValido(rut: string): boolean {
  const limpio = rut.replace(/[.\s]/g, "").toUpperCase();
  const partes = limpio.split("-");
  if (partes.length !== 2) return false;
  const [cuerpo, dv] = partes;
  if (!/^\d{7,8}$/.test(cuerpo)) return false;
  return digitoVerificador(Number(cuerpo)) === dv;
}

/** Comisión del corredor: 2% + IVA (19%) sobre el precio de venta. */
export const TASA_COMISION = 0.02;
export const IVA = 0.19;

export function comisionUf(precioUf: number): number {
  return Math.round(precioUf * TASA_COMISION * (1 + IVA) * 100) / 100;
}

/** Pie mínimo habitual de la banca chilena para vivienda: 20% del precio. */
export const PIE_MINIMO = 0.2;

/**
 * Dividendo mensual estimado en UF para un crédito hipotecario.
 * Los créditos en Chile se pactan en UF a tasa anual fija.
 */
export function dividendoUf(precioUf: number, pieUf: number, tasaAnual = 0.045, anos = 25): number {
  const capital = Math.max(precioUf - pieUf, 0);
  if (capital === 0) return 0;
  const tasaMensual = tasaAnual / 12;
  const cuotas = anos * 12;
  const factor = Math.pow(1 + tasaMensual, cuotas);
  return Math.round(((capital * tasaMensual * factor) / (factor - 1)) * 100) / 100;
}

/**
 * La banca exige que el dividendo no supere ~25% de la renta líquida.
 * Devuelve el precio máximo en UF que un comprador podría financiar.
 */
export function precioMaximoFinanciable(rentaLiquidaClp: number, pieUf: number, valorUfClp: number): number {
  const dividendoMaximoUf = (rentaLiquidaClp * 0.25) / valorUfClp;
  const tasaMensual = 0.045 / 12;
  const cuotas = 25 * 12;
  const factor = Math.pow(1 + tasaMensual, cuotas);
  const capitalMaximo = (dividendoMaximoUf * (factor - 1)) / (tasaMensual * factor);
  return Math.round(capitalMaximo + pieUf);
}

export interface Comuna {
  nombre: string;
  region: string;
  /** Valor de referencia del m² útil en UF. */
  ufPorM2: number;
  segmento: "premium" | "medio_alto" | "medio" | "emergente";
}

/**
 * Comunas con precios de referencia por m² en UF. Valores aproximados de
 * mercado, suficientes para simular un inventario realista.
 */
export const COMUNAS: Comuna[] = [
  { nombre: "Vitacura", region: "Metropolitana", ufPorM2: 115, segmento: "premium" },
  { nombre: "Lo Barnechea", region: "Metropolitana", ufPorM2: 105, segmento: "premium" },
  { nombre: "Las Condes", region: "Metropolitana", ufPorM2: 100, segmento: "premium" },
  { nombre: "Providencia", region: "Metropolitana", ufPorM2: 92, segmento: "medio_alto" },
  { nombre: "La Reina", region: "Metropolitana", ufPorM2: 85, segmento: "medio_alto" },
  { nombre: "Ñuñoa", region: "Metropolitana", ufPorM2: 80, segmento: "medio_alto" },
  { nombre: "Huechuraba", region: "Metropolitana", ufPorM2: 68, segmento: "medio" },
  { nombre: "San Miguel", region: "Metropolitana", ufPorM2: 64, segmento: "medio" },
  { nombre: "Santiago Centro", region: "Metropolitana", ufPorM2: 62, segmento: "medio" },
  { nombre: "Macul", region: "Metropolitana", ufPorM2: 60, segmento: "medio" },
  { nombre: "Peñalolén", region: "Metropolitana", ufPorM2: 58, segmento: "medio" },
  { nombre: "La Florida", region: "Metropolitana", ufPorM2: 56, segmento: "medio" },
  { nombre: "Maipú", region: "Metropolitana", ufPorM2: 52, segmento: "emergente" },
  { nombre: "Puente Alto", region: "Metropolitana", ufPorM2: 48, segmento: "emergente" },
  { nombre: "Colina", region: "Metropolitana", ufPorM2: 58, segmento: "medio_alto" },
  { nombre: "Viña del Mar", region: "Valparaíso", ufPorM2: 70, segmento: "medio_alto" },
  { nombre: "Concón", region: "Valparaíso", ufPorM2: 72, segmento: "medio_alto" },
  { nombre: "Valparaíso", region: "Valparaíso", ufPorM2: 50, segmento: "medio" },
  { nombre: "Concepción", region: "Biobío", ufPorM2: 52, segmento: "medio" },
  { nombre: "La Serena", region: "Coquimbo", ufPorM2: 54, segmento: "medio" },
  { nombre: "Puerto Varas", region: "Los Lagos", ufPorM2: 66, segmento: "medio_alto" },
];

export function buscarComuna(nombre: string): Comuna | undefined {
  const normalizar = (texto: string) =>
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
  return COMUNAS.find((comuna) => normalizar(comuna.nombre) === normalizar(nombre));
}

/** Tope de precio del subsidio DS19 (vivienda integrada), en UF. */
export const TOPE_SUBSIDIO_UF = 2200;

/** Offset de Chile en minutos para un instante dado (maneja el cambio de hora). */
function offsetMinutosChile(fecha: Date): number {
  const formato = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA_HORARIA,
    timeZoneName: "longOffset",
  });
  const nombre = formato.formatToParts(fecha).find((parte) => parte.type === "timeZoneName")?.value;
  const coincidencia = nombre?.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!coincidencia) return 0;
  const signo = coincidencia[1] === "-" ? -1 : 1;
  return signo * (Number(coincidencia[2]) * 60 + Number(coincidencia[3]));
}

/**
 * Instante UTC que corresponde a una hora de pared chilena.
 *
 * Sin esto, un bloque creado con la hora local del servidor (UTC en
 * producción) se muestra corrido tres o cuatro horas en Chile.
 */
export function instanteEnChile(
  anio: number,
  mes: number,
  dia: number,
  hora: number,
  minuto = 0,
): Date {
  const tentativo = Date.UTC(anio, mes, dia, hora, minuto);
  // Dos pasadas: la primera puede caer del lado equivocado de un cambio de hora.
  let instante = tentativo - offsetMinutosChile(new Date(tentativo)) * 60_000;
  instante = tentativo - offsetMinutosChile(new Date(instante)) * 60_000;
  return new Date(instante);
}

/** Año, mes (0-11) y día tal como se ven en Chile en ese instante. */
export function fechaEnChile(fecha: Date): { anio: number; mes: number; dia: number } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_HORARIA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(fecha);
  const [anio, mes, dia] = partes.split("-").map(Number);
  return { anio, mes: mes - 1, dia };
}

/**
 * Bloques de visita disponibles en horario de Chile: días hábiles y sábado
 * por la mañana, que es como opera un corredor acá. Domingo no se muestra.
 */
export function bloquesDisponibles(desde: Date, cantidad: number): Array<{ inicio: Date; fin: Date }> {
  const bloques: Array<{ inicio: Date; fin: Date }> = [];
  const hoy = fechaEnChile(desde);

  for (let salto = 1; salto <= 21 && bloques.length < cantidad; salto++) {
    // Fecha calendario pura: se avanza sobre el día chileno, no sobre UTC.
    const dia = new Date(Date.UTC(hoy.anio, hoy.mes, hoy.dia + salto));
    if (dia.getUTCDay() === 0) continue;

    const horas = dia.getUTCDay() === 6 ? [10, 12] : [11, 16, 18];
    for (const hora of horas) {
      if (bloques.length >= cantidad) break;
      const inicio = instanteEnChile(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), hora);
      if (inicio <= desde) continue;
      bloques.push({ inicio, fin: new Date(inicio.getTime() + 45 * 60_000) });
    }
  }

  return bloques;
}

/**
 * Normaliza un teléfono chileno a E.164 sin el signo +, que es el formato
 * que espera WhatsApp ("56912345678").
 *
 * Acepta lo que realmente escribe la gente: "+56 9 1234 5678", "09 1234 5678",
 * "912345678", "56912345678".
 */
export function normalizarTelefono(entrada: string | null | undefined): string | null {
  if (!entrada) return null;
  let digitos = entrada.replace(/\D/g, "");
  if (digitos === "") return null;

  // Prefijo de discado nacional: 09 1234 5678.
  if (digitos.startsWith("0") && digitos.length === 10) digitos = digitos.slice(1);

  // Ya viene con código de país.
  if (digitos.startsWith("56") && (digitos.length === 11 || digitos.length === 10)) {
    return digitos;
  }

  // Celular sin código de país: 9 + 8 dígitos.
  if (digitos.length === 9 && digitos.startsWith("9")) return `56${digitos}`;

  // Fijo de Santiago sin código de país: 2 + 8 dígitos.
  if (digitos.length === 9 && digitos.startsWith("2")) return `56${digitos}`;

  // Algo fuera de forma: se devuelve tal cual para no perder el dato.
  return digitos;
}

export function mismoTelefono(uno: string | null, otro: string | null): boolean {
  const a = normalizarTelefono(uno);
  const b = normalizarTelefono(otro);
  return a !== null && b !== null && a === b;
}

/** Compara correos ignorando mayúsculas y espacios. */
export function mismoCorreo(uno: string | null, otro: string | null): boolean {
  if (!uno || !otro) return false;
  return uno.trim().toLowerCase() === otro.trim().toLowerCase();
}

/**
 * Extrae la dirección de un encabezado "Nombre <correo@dominio>".
 */
export function correoDesdeEncabezado(encabezado: string): string | null {
  const conNombre = encabezado.match(/<([^>]+)>/);
  const direccion = (conNombre ? conNombre[1] : encabezado).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(direccion) ? direccion : null;
}

/**
 * Token de un alias con subdirección: "documentos+abc123@dominio" -> "abc123".
 * Sirve para calzar una respuesta aunque llegue desde otra casilla.
 */
export function tokenDeAlias(direccion: string): string | null {
  const coincidencia = direccion.match(/\+([^@]+)@/);
  return coincidencia ? coincidencia[1] : null;
}
