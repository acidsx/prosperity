"use client";

import { useFormStatus } from "react-dom";

export function BotonAccion({
  children,
  variante = "primario",
}: {
  children: React.ReactNode;
  variante?: "primario" | "secundario";
}) {
  const { pending } = useFormStatus();
  const estilos =
    variante === "primario"
      ? "bg-[var(--color-marca)] text-white hover:opacity-90"
      : "border border-[var(--color-borde)] bg-white text-[var(--color-tinta)] hover:bg-[var(--color-lienzo)]";

  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${estilos}`}
    >
      {pending ? "Procesando…" : children}
    </button>
  );
}
