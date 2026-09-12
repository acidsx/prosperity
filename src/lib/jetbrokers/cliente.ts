/**
 * Cliente HTTP del API de JetBrokers.
 *
 * Cubre los cinco endpoints documentados:
 *   POST /api/gallery/customer/{org}          crear cliente en el CRM
 *   POST /api/gallery/projects                buscador de proyectos
 *   GET  /api/gallery/details/{org}/{id}[/{userId}]  detalle de proyecto
 *   GET  /api/gallery/download/{org}/{fileId}[/{w}/{h}]  archivos
 *   GET  /api/v1/jetbrokers/meeting-room-video/{org}     video sala de reuniones
 */

import { validarCliente } from "@/lib/jetbrokers/validacion";
import type {
  BusquedaProyectos,
  ClienteEntrada,
  ProyectoDetalle,
  ProyectoResumen,
} from "@/lib/jetbrokers/tipos";

export const BASE_POR_DEFECTO = "https://api.jetbrokers.io";

/**
 * El POST de clientes está limitado a 10 peticiones por hora y por IP
 * (900 si la IP está en la whitelist de JetBrokers).
 */
export const LIMITE_POR_HORA_ESTANDAR = 10;
export const LIMITE_POR_HORA_WHITELIST = 900;

export class ErrorJetBrokers extends Error {
  constructor(
    mensaje: string,
    readonly estado: number | null,
    readonly cuerpo?: string,
  ) {
    super(mensaje);
    this.name = "ErrorJetBrokers";
  }
}

export class ErrorLimiteAlcanzado extends ErrorJetBrokers {
  constructor(
    readonly esperaMs: number,
    limite: number,
  ) {
    super(
      `Se alcanzó el límite de ${limite} clientes por hora. Próximo envío disponible en ${Math.ceil(
        esperaMs / 60000,
      )} min.`,
      429,
    );
    this.name = "ErrorLimiteAlcanzado";
  }
}

/** Ventana deslizante de una hora, igual a la que aplica JetBrokers. */
class VentanaDeEnvios {
  private marcas: number[] = [];

  constructor(private readonly limite: number) {}

  private purgar(ahora: number) {
    const hace1h = ahora - 60 * 60 * 1000;
    this.marcas = this.marcas.filter((marca) => marca > hace1h);
  }

  disponibles(ahora = Date.now()): number {
    this.purgar(ahora);
    return Math.max(this.limite - this.marcas.length, 0);
  }

  /** Milisegundos hasta que se libere un cupo, 0 si hay cupo ahora. */
  esperaMs(ahora = Date.now()): number {
    this.purgar(ahora);
    if (this.marcas.length < this.limite) return 0;
    return this.marcas[0] + 60 * 60 * 1000 - ahora;
  }

  registrar(ahora = Date.now()) {
    this.marcas.push(ahora);
  }
}

export interface OpcionesCliente {
  organizationId: string;
  baseUrl?: string;
  /** Sin esto, los POST de cliente se simulan y no salen a la red. */
  permitirEscritura?: boolean;
  /** true si la IP de salida está en la whitelist de JetBrokers. */
  ipEnWhitelist?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ResultadoCrearCliente {
  /** false cuando corrió en simulación por no tener escritura habilitada. */
  enviado: boolean;
  payload: ClienteEntrada;
  avisos: string[];
  cuposRestantes: number;
}

export class JetBrokers {
  private readonly base: string;
  private readonly ventana: VentanaDeEnvios;
  private readonly fetchImpl: typeof fetch;
  readonly organizationId: string;
  readonly permitirEscritura: boolean;
  private readonly timeoutMs: number;

  constructor(opciones: OpcionesCliente) {
    if (!opciones.organizationId) {
      throw new Error("Falta el organizationId de JetBrokers");
    }
    this.organizationId = opciones.organizationId;
    this.base = (opciones.baseUrl ?? BASE_POR_DEFECTO).replace(/\/$/, "");
    this.permitirEscritura = opciones.permitirEscritura ?? false;
    this.timeoutMs = opciones.timeoutMs ?? 15000;
    this.fetchImpl = opciones.fetchImpl ?? fetch;
    this.ventana = new VentanaDeEnvios(
      opciones.ipEnWhitelist ? LIMITE_POR_HORA_WHITELIST : LIMITE_POR_HORA_ESTANDAR,
    );
  }

  private async pedir(ruta: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.base}${ruta}`;
    let respuesta: Response;
    try {
      respuesta = await this.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      throw new ErrorJetBrokers(`No se pudo conectar con JetBrokers (${ruta}): ${detalle}`, null);
    }
    if (!respuesta.ok) {
      const cuerpo = await respuesta.text().catch(() => "");
      throw new ErrorJetBrokers(
        `JetBrokers respondió ${respuesta.status} en ${ruta}`,
        respuesta.status,
        cuerpo.slice(0, 500),
      );
    }
    return respuesta;
  }

  /**
   * Crea un cliente en el CRM. El endpoint no devuelve cuerpo: el éxito se
   * confirma solo por el código HTTP.
   *
   * email, mobile y taxId son únicos. Si el cliente ya existe, la API no
   * falla: anota los valores recibidos en el timeline de ese cliente.
   */
  async crearCliente(entrada: ClienteEntrada): Promise<ResultadoCrearCliente> {
    const { payload, avisos } = validarCliente(entrada);

    if (!this.permitirEscritura) {
      return {
        enviado: false,
        payload,
        avisos: [...avisos, "Simulación: JETBROKERS_ESCRITURA no está habilitado, no se llamó al API"],
        cuposRestantes: this.ventana.disponibles(),
      };
    }

    const espera = this.ventana.esperaMs();
    if (espera > 0) {
      throw new ErrorLimiteAlcanzado(espera, this.ventana.disponibles() + 1);
    }

    await this.pedir(`/api/gallery/customer/${this.organizationId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    this.ventana.registrar();
    return { enviado: true, payload, avisos, cuposRestantes: this.ventana.disponibles() };
  }

  /** Cupos de creación de clientes que quedan en la ventana de una hora. */
  cuposRestantes(): number {
    return this.ventana.disponibles();
  }

  async buscarProyectos(filtros: BusquedaProyectos = {}): Promise<ProyectoResumen[]> {
    const respuesta = await this.pedir("/api/gallery/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: this.organizationId, ...filtros }),
    });
    const datos = await respuesta.json();
    return Array.isArray(datos) ? (datos as ProyectoResumen[]) : [];
  }

  /**
   * Detalle completo de un proyecto. Si se pasa userId y ese usuario tiene
   * rol de broker, vienen sus datos de contacto en vez de los de la
   * organización.
   */
  async detalleProyecto(proyectoId: string, userId?: string): Promise<ProyectoDetalle> {
    const sufijo = userId ? `/${userId}` : "";
    const respuesta = await this.pedir(
      `/api/gallery/details/${this.organizationId}/${proyectoId}${sufijo}`,
    );
    return (await respuesta.json()) as ProyectoDetalle;
  }

  /** URL pública de un archivo (brochure, render, plano). */
  urlArchivo(fileId: string, ancho?: number, alto?: number): string {
    const dimensiones = ancho && alto ? `/${ancho}/${alto}` : "";
    return `${this.base}/api/gallery/download/${this.organizationId}/${fileId}${dimensiones}`;
  }

  async descargarArchivo(
    fileId: string,
    dimensiones?: { ancho: number; alto: number },
  ): Promise<{ contenido: ArrayBuffer; mime: string }> {
    const ruta = dimensiones
      ? `/api/gallery/download/${this.organizationId}/${fileId}/${dimensiones.ancho}/${dimensiones.alto}`
      : `/api/gallery/download/${this.organizationId}/${fileId}`;
    const respuesta = await this.pedir(ruta);
    return {
      contenido: await respuesta.arrayBuffer(),
      mime: respuesta.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  async videoSalaReuniones(): Promise<string | null> {
    const respuesta = await this.pedir(
      `/api/v1/jetbrokers/meeting-room-video/${this.organizationId}`,
    );
    const datos = (await respuesta.json()) as { video?: string };
    return datos.video ?? null;
  }
}

/** Construye el cliente desde variables de entorno. */
const CLIENTE_COMPARTIDO = Symbol.for("prosperity.jetbrokers");

/**
 * Cliente compartido del proceso.
 *
 * Tiene que ser uno solo: la ventana que cuenta los envíos de la última hora
 * vive dentro de la instancia, así que devolver una nueva en cada llamada
 * reiniciaría el contador y el límite no frenaría nada.
 */
export function jetBrokersDesdeEntorno(): JetBrokers | null {
  const organizationId = process.env.JETBROKERS_ORG_ID;
  if (!organizationId) return null;

  const global = globalThis as unknown as Record<symbol, { clave: string; cliente: JetBrokers } | undefined>;
  const clave = [
    organizationId,
    process.env.JETBROKERS_BASE_URL ?? "",
    process.env.JETBROKERS_ESCRITURA ?? "",
    process.env.JETBROKERS_IP_WHITELIST ?? "",
  ].join("|");

  const guardado = global[CLIENTE_COMPARTIDO];
  if (guardado && guardado.clave === clave) return guardado.cliente;

  const cliente = new JetBrokers({
    organizationId,
    baseUrl: process.env.JETBROKERS_BASE_URL,
    permitirEscritura: process.env.JETBROKERS_ESCRITURA === "true",
    ipEnWhitelist: process.env.JETBROKERS_IP_WHITELIST === "true",
  });
  global[CLIENTE_COMPARTIDO] = { clave, cliente };
  return cliente;
}
