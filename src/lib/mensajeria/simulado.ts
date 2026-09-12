/**
 * Proveedor simulado: se usa cuando no hay credenciales todavía.
 *
 * No manda nada, pero deja el mensaje en una bandeja de salida que la
 * aplicación muestra, así se puede revisar exactamente qué habría salido y
 * por qué canal antes de conectar WhatsApp o Resend de verdad.
 */

import type {
  CanalEnvio,
  Destinatario,
  ProveedorMensajeria,
  ResultadoEnvio,
  Salida,
} from "@/lib/mensajeria/tipos";

export interface EnvioSimulado {
  id: string;
  canal: CanalEnvio;
  leadId: string;
  para: string;
  salida: Salida;
  creadoEn: string;
}

const CLAVE = Symbol.for("prosperity.bandejaSimulada");

function bandeja(): EnvioSimulado[] {
  const global = globalThis as unknown as Record<symbol, EnvioSimulado[] | undefined>;
  if (!global[CLAVE]) global[CLAVE] = [];
  return global[CLAVE]!;
}

export function bandejaSimulada(): EnvioSimulado[] {
  return [...bandeja()].reverse();
}

export function limpiarBandejaSimulada(): void {
  bandeja().length = 0;
}

export class ProveedorSimulado implements ProveedorMensajeria {
  readonly simulado = true;

  constructor(readonly canal: CanalEnvio) {}

  async enviar(destinatario: Destinatario, salida: Salida): Promise<ResultadoEnvio> {
    const para =
      this.canal === "whatsapp" ? (destinatario.telefono ?? "sin teléfono") : (destinatario.email ?? "sin correo");

    bandeja().push({
      id: `sim_${bandeja().length + 1}`,
      canal: this.canal,
      leadId: destinatario.leadId,
      para,
      salida,
      creadoEn: new Date().toISOString(),
    });

    return {
      enviado: false,
      idProveedor: null,
      simulado: true,
      motivo: `Sin credenciales de ${this.canal}: el mensaje quedó en la bandeja simulada`,
    };
  }
}
