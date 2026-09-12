import Link from "next/link";

import { correrSimulacion, ultimaSimulacion } from "@/app/simulacion/acciones";
import { BotonAccion } from "@/componentes/boton-accion";
import { Metrica, Tarjeta, Vacio } from "@/componentes/ui";
import { exigirUsuario } from "@/lib/auth/acceso";
import { formatearUf } from "@/lib/dominio/chile";
import type { Actor } from "@/lib/simulacion/venta";

export const dynamic = "force-dynamic";

const ETIQUETA_ACTOR: Record<Actor, string> = {
  comprador: "Comprador",
  agente: "Agente",
  ejecutivo: "Ejecutivo",
  banco: "Banco",
  notaria: "Notaría",
  cbr: "Conservador",
  sistema: "Sistema",
};

const COLOR_ACTOR: Record<Actor, string> = {
  comprador: "bg-slate-100 text-slate-700",
  agente: "bg-green-100 text-green-900",
  ejecutivo: "bg-blue-100 text-blue-900",
  banco: "bg-indigo-100 text-indigo-900",
  notaria: "bg-amber-100 text-amber-900",
  cbr: "bg-purple-100 text-purple-900",
  sistema: "bg-rose-100 text-rose-900",
};

function fechaCorta(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Santiago",
  }).format(new Date(iso));
}

export default async function Simulacion() {
  await exigirUsuario("/simulacion");
  const resultado = await ultimaSimulacion();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Simulación de una venta</h1>
          <p className="mt-1 text-sm text-[var(--color-tinta-suave)]">
            Recorre el ciclo completo, de la consulta a la entrega. La calificación, la respuesta y
            la confirmación de la visita las hace el agente con el mismo código que corre en
            producción; el banco, la notaría y el Conservador están simulados.
          </p>
        </div>
        <form action={correrSimulacion}>
          <BotonAccion>{resultado ? "Simular otra venta" : "Simular una venta"}</BotonAccion>
        </form>
      </div>

      {!resultado ? (
        <Tarjeta>
          <Vacio mensaje="Todavía no has corrido ninguna simulación." />
        </Tarjeta>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metrica
              etiqueta="Precio de cierre"
              valor={formatearUf(resultado.resumen.precioUf)}
              detalle={`${resultado.resumen.proyecto}${
                resultado.resumen.unidad ? ` · ${resultado.resumen.unidad}` : ""
              }`}
            />
            <Metrica
              etiqueta="Comisión"
              valor={formatearUf(resultado.resumen.comisionUf)}
              detalle={resultado.resumen.comprador}
            />
            <Metrica
              etiqueta="Duración"
              valor={`${resultado.resumen.diasHabiles} días`}
              detalle="hábiles, de la consulta a la comisión"
            />
            <Metrica
              etiqueta="Mensajes del agente"
              valor={String(resultado.resumen.mensajesDelAgente)}
              detalle={`${resultado.resumen.documentosRecibidos} documentos recibidos`}
            />
          </div>

          <div className="flex flex-wrap gap-3 text-sm">
            <Link
              href={`/leads/${resultado.resumen.leadId}`}
              className="rounded-md border border-[var(--color-borde)] bg-white px-3 py-1.5 hover:bg-[var(--color-lienzo)]"
            >
              Ver la conversación
            </Link>
            <Link
              href={`/negocios/${resultado.resumen.negocioId}`}
              className="rounded-md border border-[var(--color-borde)] bg-white px-3 py-1.5 hover:bg-[var(--color-lienzo)]"
            >
              Ver el cierre
            </Link>
          </div>

          <Tarjeta titulo="Lo que pasó, paso a paso">
            <ol className="space-y-3">
              {resultado.pasos.map((paso, indice) => (
                <li key={indice} className="flex gap-3">
                  <div className="w-24 shrink-0 text-right">
                    <p className="text-sm tabular-nums">día {paso.dia}</p>
                    <p className="text-xs text-[var(--color-tinta-suave)]">
                      {fechaCorta(paso.fecha)}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1 border-l border-[var(--color-borde)] pb-1 pl-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLOR_ACTOR[paso.actor]}`}
                      >
                        {ETIQUETA_ACTOR[paso.actor]}
                      </span>
                      <span className="font-medium">{paso.titulo}</span>
                    </div>
                    <p className="text-sm text-[var(--color-tinta-suave)]">{paso.detalle}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Tarjeta>
        </>
      )}
    </div>
  );
}
