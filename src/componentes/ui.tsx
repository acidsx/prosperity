import type { ReactNode } from "react";

import { ETIQUETA_ESTADO, type EstadoCliente } from "@/lib/jetbrokers/tipos";

export function Tarjeta({
  titulo,
  accion,
  children,
}: {
  titulo?: string;
  accion?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--color-borde)] bg-white">
      {(titulo || accion) && (
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-borde)] px-4 py-3">
          {titulo && <h2 className="text-sm font-semibold">{titulo}</h2>}
          {accion}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Metrica({
  etiqueta,
  valor,
  detalle,
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-borde)] bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--color-tinta-suave)]">{etiqueta}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{valor}</p>
      {detalle && <p className="mt-1 text-xs text-[var(--color-tinta-suave)]">{detalle}</p>}
    </div>
  );
}

const COLOR_ESTADO: Record<EstadoCliente, string> = {
  new: "bg-slate-100 text-slate-700",
  callAgain: "bg-amber-100 text-amber-800",
  noResponse: "bg-slate-100 text-slate-600",
  furtherOn: "bg-blue-100 text-blue-800",
  scheduled: "bg-green-100 text-green-800",
  reschedule: "bg-amber-100 text-amber-800",
  quotationSended: "bg-indigo-100 text-indigo-800",
  dropped: "bg-rose-100 text-rose-800",
  closing: "bg-emerald-200 text-emerald-900",
  noQualify: "bg-rose-100 text-rose-800",
  customer: "bg-emerald-200 text-emerald-900",
};

export function EtiquetaEstado({ estado }: { estado: EstadoCliente }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${COLOR_ESTADO[estado]}`}>
      {ETIQUETA_ESTADO[estado]}
    </span>
  );
}

export function Temperatura({ valor }: { valor: "caliente" | "tibio" | "frio" }) {
  const estilos = {
    caliente: "bg-rose-100 text-rose-800",
    tibio: "bg-amber-100 text-amber-800",
    frio: "bg-sky-100 text-sky-800",
  } as const;
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${estilos[valor]}`}>
      {valor}
    </span>
  );
}

export function Vacio({ mensaje }: { mensaje: string }) {
  return <p className="py-6 text-center text-sm text-[var(--color-tinta-suave)]">{mensaje}</p>;
}
