import Link from "next/link";

import { Tarjeta, Temperatura, Vacio } from "@/componentes/ui";
import { exigirUsuario, leadsVisibles } from "@/lib/auth/acceso";
import { tienda } from "@/lib/datos";
import { formatearUf } from "@/lib/dominio/chile";
import { ESTADOS_CLIENTE, ETIQUETA_ESTADO } from "@/lib/jetbrokers/tipos";

export const dynamic = "force-dynamic";

export default async function Pipeline() {
  const usuario = await exigirUsuario("/pipeline");
  const db = tienda();
  const [todos, oportunidades] = await Promise.all([db.listarLeads(), db.listarOportunidades()]);
  const leads = leadsVisibles(usuario, todos);
  const suyos = new Set(leads.map((lead) => lead.id));
  const visibles = oportunidades.filter((opo) => suyos.has(opo.leadId));
  const nombres = new Map(leads.map((lead) => [lead.id, lead.nombre]));

  const columnas = ESTADOS_CLIENTE.map((estado) => ({
    estado,
    oportunidades: visibles.filter((opo) => opo.estado === estado),
  })).filter((columna) => columna.oportunidades.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Pipeline</h1>
        <p className="mt-1 text-sm text-[var(--color-tinta-suave)]">
          Los estados son los que acepta el campo <code>status</code> del Customer API de JetBrokers.
        </p>
      </div>

      {columnas.length === 0 ? (
        <Tarjeta>
          <Vacio mensaje="Sin oportunidades. Procesa los leads pendientes desde el panel." />
        </Tarjeta>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {columnas.map((columna) => (
            <div key={columna.estado} className="w-72 shrink-0">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold">{ETIQUETA_ESTADO[columna.estado]}</h2>
                <span className="text-xs tabular-nums text-[var(--color-tinta-suave)]">
                  {columna.oportunidades.length}
                </span>
              </div>
              <ul className="space-y-2">
                {columna.oportunidades.map((oportunidad) => (
                  <li
                    key={oportunidad.id}
                    className="rounded-lg border border-[var(--color-borde)] bg-white p-3"
                  >
                    <Link
                      href={`/leads/${oportunidad.leadId}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {nombres.get(oportunidad.leadId) ?? oportunidad.leadId}
                    </Link>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-xs tabular-nums text-[var(--color-tinta-suave)]">
                        {oportunidad.valorUf ? formatearUf(oportunidad.valorUf) : "sin valor"}
                      </span>
                      {oportunidad.calificacion && (
                        <Temperatura valor={oportunidad.calificacion.temperatura} />
                      )}
                    </div>
                    {oportunidad.calificacion?.recomendaciones[0] && (
                      <p className="mt-1 truncate text-xs text-[var(--color-tinta-suave)]">
                        {oportunidad.calificacion.recomendaciones[0].nombre}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
