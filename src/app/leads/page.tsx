import Link from "next/link";

import { ejecutarAgente, ingresarLead } from "@/app/acciones";
import { BotonAccion } from "@/componentes/boton-accion";
import { EtiquetaEstado, Tarjeta, Temperatura, Vacio } from "@/componentes/ui";
import { exigirUsuario, leadsVisibles, veTodo } from "@/lib/auth/acceso";
import { tienda } from "@/lib/datos";
import { formatearFecha, formatearUf } from "@/lib/dominio/chile";

export const dynamic = "force-dynamic";

export default async function Leads() {
  const usuario = await exigirUsuario("/leads");
  const db = tienda();
  const [todos, oportunidades] = await Promise.all([db.listarLeads(), db.listarOportunidades()]);
  const leads = leadsVisibles(usuario, todos);
  const porLead = new Map(oportunidades.map((opo) => [opo.leadId, opo]));

  const ordenados = [...leads].sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Bandeja de leads</h1>
          <p className="mt-1 text-sm text-[var(--color-tinta-suave)]">
            {veTodo(usuario) ? "Toda la corredora" : "Tu cartera"} · {leads.length} leads
          </p>
        </div>
        <form action={ejecutarAgente}>
          <BotonAccion>Procesar pendientes</BotonAccion>
        </form>
      </div>

      <Tarjeta titulo="Ingresar consulta manual">
        <form action={ingresarLead} className="grid gap-3 sm:grid-cols-2">
          <input
            name="nombre"
            required
            placeholder="Nombre completo"
            className="rounded-md border border-[var(--color-borde)] px-3 py-2 text-sm"
          />
          <input
            name="email"
            type="email"
            placeholder="Email"
            className="rounded-md border border-[var(--color-borde)] px-3 py-2 text-sm"
          />
          <input
            name="telefono"
            placeholder="Teléfono (+569…)"
            className="rounded-md border border-[var(--color-borde)] px-3 py-2 text-sm"
          />
          <input
            name="rut"
            placeholder="RUT (opcional)"
            className="rounded-md border border-[var(--color-borde)] px-3 py-2 text-sm"
          />
          <textarea
            name="mensaje"
            required
            rows={3}
            placeholder="Mensaje del comprador: presupuesto, comuna, renta, ahorro…"
            className="sm:col-span-2 rounded-md border border-[var(--color-borde)] px-3 py-2 text-sm"
          />
          <div className="sm:col-span-2">
            <BotonAccion>Ingresar y calificar</BotonAccion>
          </div>
        </form>
      </Tarjeta>

      <Tarjeta>
        {ordenados.length === 0 ? (
          <Vacio mensaje="No hay leads." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-borde)] text-left text-xs uppercase tracking-wide text-[var(--color-tinta-suave)]">
                  <th className="py-2 pr-3 font-medium">Comprador</th>
                  <th className="py-2 pr-3 font-medium">Canal</th>
                  <th className="py-2 pr-3 font-medium">Estado</th>
                  <th className="py-2 pr-3 font-medium">Puntaje</th>
                  <th className="py-2 pr-3 font-medium">Presupuesto</th>
                  <th className="py-2 font-medium">Ingreso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-borde)]">
                {ordenados.map((lead) => {
                  const oportunidad = porLead.get(lead.id);
                  const calificacion = oportunidad?.calificacion;
                  return (
                    <tr key={lead.id} className="hover:bg-[var(--color-lienzo)]">
                      <td className="py-2 pr-3">
                        <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
                          {lead.nombre}
                        </Link>
                        <p className="max-w-md truncate text-xs text-[var(--color-tinta-suave)]">
                          {lead.mensajeInicial}
                        </p>
                      </td>
                      <td className="py-2 pr-3 text-xs text-[var(--color-tinta-suave)]">
                        {lead.canal.replace(/_/g, " ")}
                      </td>
                      <td className="py-2 pr-3">
                        {oportunidad ? <EtiquetaEstado estado={oportunidad.estado} /> : "—"}
                      </td>
                      <td className="py-2 pr-3">
                        {calificacion ? (
                          <span className="flex items-center gap-2">
                            <span className="tabular-nums">{calificacion.puntaje}</span>
                            <Temperatura valor={calificacion.temperatura} />
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--color-tinta-suave)]">sin calificar</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {calificacion?.presupuestoUfEstimado
                          ? formatearUf(calificacion.presupuestoUfEstimado)
                          : "—"}
                      </td>
                      <td className="py-2 text-xs text-[var(--color-tinta-suave)]">
                        {formatearFecha(lead.creadoEn)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>
    </div>
  );
}
