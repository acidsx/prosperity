import type { Metadata, Route } from "next";
import Link from "next/link";

import { salir } from "@/app/entrar/acciones";
import { usuarioActual } from "@/lib/auth/acceso";
import { ETIQUETA_ROL, puede } from "@/lib/auth/tipos";

import "./globals.css";

export const metadata: Metadata = {
  title: "Gestor inmobiliario | Prosperity",
  description: "CRM de corretaje: captación, cierre con el banco y firmas ante notario",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const usuario = await usuarioActual();

  // Las rutas se declaran como texto y se afirman al renderizar: typedRoutes
  // no puede inferir el tipo de un arreglo armado condicionalmente.
  const navegacion: Array<{ href: string; etiqueta: string }> = usuario
    ? [
        { href: "/", etiqueta: "Panel" },
        { href: "/leads", etiqueta: "Leads" },
        { href: "/pipeline", etiqueta: "Pipeline" },
        { href: "/negocios", etiqueta: "Cierres" },
        { href: "/proyectos", etiqueta: "Proyectos" },
        { href: "/agenda", etiqueta: "Agenda" },
        { href: "/mensajeria", etiqueta: "Mensajería" },
        { href: "/simulacion", etiqueta: "Simulación" },
        ...(puede(usuario.rol, "ver_control_de_gestion")
          ? [{ href: "/control", etiqueta: "Control" }]
          : []),
      ]
    : [];

  return (
    <html lang="es-CL">
      <body className="min-h-screen antialiased">
        <header className="border-b border-[var(--color-borde)] bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Gestor inmobiliario
            </Link>
            <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--color-tinta-suave)]">
              {navegacion.map((item) => (
                <Link key={item.href} href={item.href as Route} className="hover:text-[var(--color-tinta)]">
                  {item.etiqueta}
                </Link>
              ))}
            </nav>
            {usuario && (
              <div className="ml-auto flex items-center gap-3 text-xs text-[var(--color-tinta-suave)]">
                <span>
                  {usuario.nombre} · {ETIQUETA_ROL[usuario.rol]}
                </span>
                <form action={salir}>
                  <button type="submit" className="hover:text-[var(--color-tinta)] hover:underline">
                    Salir
                  </button>
                </form>
              </div>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
