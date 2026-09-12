import { redirect } from "next/navigation";

import { FormularioIngreso } from "@/app/entrar/formulario";
import { usuarioActual } from "@/lib/auth/acceso";
import { CLAVE_DEMO, esModoDemo, sembrarUsuariosDemo } from "@/lib/auth/demo";
import { tienda } from "@/lib/datos";

export const dynamic = "force-dynamic";

export default async function Entrar({
  searchParams,
}: {
  searchParams: Promise<{ volver?: string }>;
}) {
  if (await usuarioActual()) redirect("/");

  const { volver } = await searchParams;
  await sembrarUsuariosDemo();
  const usuarios = await tienda().listarUsuarios();
  const demo = esModoDemo();

  return (
    <div className="mx-auto max-w-sm py-12">
      <h1 className="text-xl font-semibold tracking-tight">Gestor inmobiliario</h1>
      <p className="mt-1 text-sm text-[var(--color-tinta-suave)]">
        Entra con tu cuenta para ver tu cartera.
      </p>

      {usuarios.length === 0 && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No hay usuarios creados. Créalos con <code>npm run usuarios -- crear</code>.
        </p>
      )}

      <div className="mt-6 rounded-lg border border-[var(--color-borde)] bg-white p-5">
        <FormularioIngreso volver={volver ?? "/"} />
      </div>

      {demo && usuarios.length > 0 && (
        <div className="mt-4 rounded-md border border-[var(--color-borde)] bg-white p-4 text-xs text-[var(--color-tinta-suave)]">
          <p className="font-medium text-[var(--color-tinta)]">Modo demostración</p>
          <p className="mt-1">
            Los datos están en memoria y estas cuentas son de prueba. En cuanto configures Supabase,
            esto desaparece y los usuarios se crean con <code>npm run usuarios</code>.
          </p>
          <ul className="mt-2 space-y-0.5">
            {usuarios.map((usuario) => (
              <li key={usuario.id}>
                {usuario.email} · {usuario.rol}
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Clave de todas: <code>{CLAVE_DEMO}</code>
          </p>
        </div>
      )}
    </div>
  );
}
