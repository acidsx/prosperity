import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "Gestor inmobiliario | Prosperity",
  description: "Agente que califica leads y agenda visitas sobre el CRM de JetBrokers",
};

const NAVEGACION = [
  { href: "/", etiqueta: "Panel" },
  { href: "/leads", etiqueta: "Leads" },
  { href: "/pipeline", etiqueta: "Pipeline" },
  { href: "/proyectos", etiqueta: "Proyectos" },
  { href: "/agenda", etiqueta: "Agenda" },
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CL">
      <body className="min-h-screen antialiased">
        <header className="border-b border-[var(--color-borde)] bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Gestor inmobiliario
            </Link>
            <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--color-tinta-suave)]">
              {NAVEGACION.map((item) => (
                <Link key={item.href} href={item.href} className="hover:text-[var(--color-tinta)]">
                  {item.etiqueta}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
