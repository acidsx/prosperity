import Link from "next/link";

import { Tarjeta, Vacio } from "@/componentes/ui";
import { exigirUsuario, leadsVisibles } from "@/lib/auth/acceso";
import { tienda } from "@/lib/datos";
import { formatearFecha } from "@/lib/dominio/chile";

export const dynamic = "force-dynamic";

export default async function Agenda() {
  const usuario = await exigirUsuario("/agenda");
  const db = tienda();
  const [todasLasVisitas, todosLosLeads, proyectos] = await Promise.all([
    db.listarVisitas(),
    db.listarLeads(),
    db.listarProyectos(),
  ]);

  const leads = leadsVisibles(usuario, todosLosLeads);
  const suyos = new Set(leads.map((lead) => lead.id));
  const visitas = todasLasVisitas.filter((visita) => suyos.has(visita.leadId));

  const nombreLead = new Map(leads.map((lead) => [lead.id, lead.nombre]));
  const nombreProyecto = new Map(proyectos.map((proyecto) => [proyecto.id, proyecto.nombre]));

  const ordenadas = [...visitas].sort((a, b) => a.inicio.localeCompare(b.inicio));
  const porDia = new Map<string, typeof ordenadas>();
  for (const visita of ordenadas) {
    const dia = new Intl.DateTimeFormat("es-CL", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "America/Santiago",
    }).format(new Date(visita.inicio));
    porDia.set(dia, [...(porDia.get(dia) ?? []), visita]);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Agenda de visitas</h1>
        <p className="mt-1 text-sm text-[var(--color-tinta-suave)]">
          Bloques hábiles de lunes a sábado. Los domingos no se muestran propiedades.
        </p>
      </div>

      {ordenadas.length === 0 ? (
        <Tarjeta>
          <Vacio mensaje="Sin visitas agendadas todavía." />
        </Tarjeta>
      ) : (
        <div className="space-y-4">
          {[...porDia.entries()].map(([dia, visitasDelDia]) => (
            <Tarjeta key={dia} titulo={dia}>
              <ul className="divide-y divide-[var(--color-borde)]">
                {visitasDelDia.map((visita) => (
                  <li key={visita.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
                    <span className="w-28 shrink-0 tabular-nums">{formatearFecha(visita.inicio)}</span>
                    <Link href={`/leads/${visita.leadId}`} className="font-medium hover:underline">
                      {nombreLead.get(visita.leadId) ?? visita.leadId}
                    </Link>
                    <span className="text-[var(--color-tinta-suave)]">
                      {nombreProyecto.get(visita.proyectoId) ?? visita.proyectoId}
                    </span>
                    <span className="ml-auto rounded-full bg-[var(--color-lienzo)] px-2 py-0.5 text-xs">
                      {visita.estado}
                    </span>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          ))}
        </div>
      )}
    </div>
  );
}
