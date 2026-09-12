"use client";

import { useActionState } from "react";

import { ingresar, type EstadoIngreso } from "@/app/entrar/acciones";
import { BotonAccion } from "@/componentes/boton-accion";

export function FormularioIngreso({ volver }: { volver: string }) {
  const [estado, accion] = useActionState<EstadoIngreso, FormData>(ingresar, { error: null });

  return (
    <form action={accion} className="space-y-3">
      <input type="hidden" name="volver" value={volver} />
      <label className="block text-sm">
        <span className="text-[var(--color-tinta-suave)]">Correo</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="mt-1 w-full rounded-md border border-[var(--color-borde)] px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="text-[var(--color-tinta-suave)]">Clave</span>
        <input
          name="clave"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-md border border-[var(--color-borde)] px-3 py-2"
        />
      </label>
      {estado.error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900">{estado.error}</p>
      )}
      <BotonAccion>Entrar</BotonAccion>
    </form>
  );
}
