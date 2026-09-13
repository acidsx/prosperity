/**
 * Proveedor del modelo, con grabación.
 *
 * El agente conversacional depende de una llamada a Claude, y eso trae dos
 * problemas prácticos: las pruebas no pueden depender de la red ni de una
 * credencial, y una demostración no debería costar tokens cada vez que se
 * corre.
 *
 * La solución es la de siempre para dependencias externas: una interfaz y
 * dos implementaciones. En vivo llama al modelo; en reproducción devuelve lo
 * que el modelo respondió cuando se grabó. La grabación guarda el prompt
 * completo junto a la respuesta, así que si el prompt cambia, la corrida
 * avisa que la grabación quedó vieja en vez de mentir.
 */

import "server-only";

import { createHash } from "node:crypto";

import { clienteClaude, MODELO } from "@/lib/agente/claude";

export interface PeticionModelo {
  sistema: string;
  mensajes: Array<{ rol: "user" | "assistant"; contenido: string }>;
  /** Esquema JSON que debe cumplir la respuesta, si se pide estructurada. */
  esquema?: unknown;
  maxTokens?: number;
  esfuerzo?: "low" | "medium" | "high";
  /** Etiqueta legible del turno, para leer la grabación. */
  etiqueta: string;
}

export interface RespuestaModelo {
  texto: string;
  /** De dónde salió: sirve para no confundir una demo con una corrida real. */
  origen: "modelo" | "grabacion";
}

export interface ProveedorModelo {
  generar(peticion: PeticionModelo): Promise<RespuestaModelo>;
  readonly enVivo: boolean;
}

/** Huella del prompt: si cambia, la grabación ya no corresponde. */
export function huellaPeticion(peticion: PeticionModelo): string {
  const canonico = JSON.stringify({
    sistema: peticion.sistema,
    mensajes: peticion.mensajes,
    esquema: peticion.esquema ?? null,
  });
  return createHash("sha256").update(canonico).digest("hex").slice(0, 16);
}

/** Llama a Claude de verdad. */
export function proveedorEnVivo(): ProveedorModelo | null {
  const cliente = clienteClaude();
  if (!cliente) return null;

  return {
    enVivo: true,
    async generar(peticion) {
      const respuesta = await cliente.messages.create({
        model: MODELO,
        max_tokens: peticion.maxTokens ?? 4000,
        system: peticion.sistema,
        output_config: { effort: peticion.esfuerzo ?? "medium" },
        messages: peticion.mensajes.map((mensaje) => ({
          role: mensaje.rol,
          content: mensaje.contenido,
        })),
      });

      const texto = respuesta.content
        .filter((bloque): bloque is Extract<typeof bloque, { type: "text" }> => bloque.type === "text")
        .map((bloque) => bloque.text)
        .join("\n")
        .trim();

      if (!texto) throw new Error("El modelo no devolvió texto");
      return { texto, origen: "modelo" };
    },
  };
}

export interface TurnoGrabado {
  etiqueta: string;
  huella: string;
  /** El prompt tal como se envió, para poder auditar la grabación. */
  peticion: PeticionModelo;
  respuesta: string;
}

export interface Grabacion {
  /** Modelo con el que se grabó. */
  modelo: string;
  grabadaEn: string;
  turnos: TurnoGrabado[];
}

export class GrabacionDesactualizada extends Error {
  constructor(
    readonly etiqueta: string,
    readonly esperada: string,
    readonly recibida: string,
  ) {
    super(
      `La grabación del turno "${etiqueta}" no corresponde al prompt actual ` +
        `(grabada ${esperada}, ahora ${recibida}). Vuelve a grabar con ANTHROPIC_API_KEY definida.`,
    );
    this.name = "GrabacionDesactualizada";
  }
}

/**
 * Reproduce una grabación.
 *
 * Los turnos se consumen en orden. Si el prompt de un turno cambió respecto
 * al grabado, falla: es preferible una corrida rota a una demostración que
 * muestra respuestas que ya no corresponden al prompt.
 */
export function proveedorGrabado(grabacion: Grabacion): ProveedorModelo {
  let indice = 0;

  return {
    enVivo: false,
    async generar(peticion) {
      const turno = grabacion.turnos[indice];
      if (!turno) {
        throw new Error(
          `La grabación tiene ${grabacion.turnos.length} turnos y se pidió el ${indice + 1} ("${peticion.etiqueta}"). Vuelve a grabar.`,
        );
      }
      indice += 1;

      const huella = huellaPeticion(peticion);
      if (huella !== turno.huella) {
        throw new GrabacionDesactualizada(peticion.etiqueta, turno.huella, huella);
      }
      return { texto: turno.respuesta, origen: "grabacion" };
    },
  };
}

/**
 * Proveedor que no responde pero anota lo que se le pidió.
 *
 * Sirve para volcar los prompts exactos a un archivo sin gastar tokens:
 * se corre la simulación con este, se revisa lo que iba a salir, y recién
 * ahí se graba en vivo.
 */
export function proveedorQueSoloAnota(destino: PeticionModelo[]): ProveedorModelo {
  return {
    enVivo: false,
    async generar(peticion) {
      destino.push(peticion);
      throw new Error(`__solo_anota__:${peticion.etiqueta}`);
    },
  };
}
