import Link from "next/link";

import { Tarjeta, Vacio } from "@/componentes/ui";
import { exigirUsuario, negociosVisibles, veTodo } from "@/lib/auth/acceso";
import { sembrarNegociosDemo } from "@/lib/cierre/demo";
import { alertasDeLaCartera } from "@/lib/cierre/gestion";
import { alertasDelNegocio, avance, siguienteHito } from "@/lib/cierre/negocio";
import { tienda } from "@/lib/datos";
import { formatearFecha, formatearUf } from "@/lib/dominio/chile";
import { ETIQUETA_CIERRE, ETIQUETA_RESPONSABLE, precioFinalUf, type Responsable } from "@/lib/dominio/cierre";

export const dynamic = "force-dynamic";

const COLOR_GRAVEDAD = {
  critica: "bg-rose-100 text-rose-900",
  alta: "bg-amber-100 text-amber-900",
  media: "bg-slate-100 text-slate-700",
} as const;

export default async function Negocios() {
  const usuario = await exigirUsuario("/negocios");
  await sembrarNegociosDemo();

  const db = tienda();
  const [todos, leads, proyectos, usuarios] = await Promise.all([
    db.listarNegocios(),
    db.listarLeads(),
    db.listarProyectos(),
    db.listarUsuarios(),
  ]);

  const negocios = negociosVisibles(usuario, todos);
  const nombreLead = new Map(leads.map((lead) => [lead.id, lead.nombre]));
  const nombreProyecto = new Map(proyectos.map((proyecto) => [proyecto.id, proyecto.nombre]));
  const nombreEjecutivo = new Map(usuarios.map((item) => [item.id, item.nombre]));

  const activos = negocios.filter(
    (negocio) => negocio.etapa !== "cerrado" && negocio.etapa !== "caido",
  );
  const alertas = alertasDeLaCartera(activos);
  const criticas = alertas.filter((alerta) => alerta.gravedad === "critica");
  const etiquetaNegocio = new Map(
    negocios.map((negocio) => [
      negocio.id,
      [nombreLead.get(negocio.leadId) ?? negocio.leadId, negocio.unidad].filter(Boolean).join(" · "),
    ]),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Cierres</h1>
          <p className="mt-1 text-sm text-[var(--color-tinta-suave)]">
            {activos.length} operaciones activas ·{" "}
            {formatearUf(activos.reduce((total, negocio) => total + precioFinalUf(negocio), 0))} en
            juego
            {veTodo(usuario) ? " · toda la corredora" : " · tu cartera"}
          </p>
        </div>
      </div>

      {criticas.length > 0 && (
        <Tarjeta titulo={`${criticas.length} cosa(s) que frenan un cierre`}>
          <ul className="space-y-2">
            {criticas.slice(0, 6).map((alerta, indice) => (
              <li
                key={`${alerta.negocioId}-${indice}`}
                className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/negocios/${alerta.negocioId}`} className="font-medium hover:underline">
                    {alerta.titulo}
                    <span className="ml-2 font-normal text-[var(--color-tinta-suave)]">
                      {etiquetaNegocio.get(alerta.negocioId) ?? ""}
                    </span>
                  </Link>
                  <span className="text-xs text-[var(--color-tinta-suave)]">
                    {ETIQUETA_RESPONSABLE[alerta.responsable as Responsable] ?? alerta.responsable}
                  </span>
                </div>
                <p className="text-xs text-rose-900">{alerta.detalle}</p>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      <Tarjeta>
        {negocios.length === 0 ? (
          <Vacio mensaje="Sin cierres abiertos. Se abren desde la ficha de un lead que reservó." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-borde)] text-left text-xs uppercase tracking-wide text-[var(--color-tinta-suave)]">
                  <th className="py-2 pr-3 font-medium">Operación</th>
                  <th className="py-2 pr-3 font-medium">Etapa</th>
                  <th className="py-2 pr-3 font-medium">Avance</th>
                  <th className="py-2 pr-3 font-medium">Siguiente</th>
                  <th className="py-2 pr-3 font-medium">Precio</th>
                  <th className="py-2 pr-3 font-medium">Ejecutivo</th>
                  <th className="py-2 font-medium">Alertas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-borde)]">
                {negocios.map((negocio) => {
                  const propias = alertasDelNegocio(negocio);
                  const siguiente = siguienteHito(negocio);
                  const peor = propias[0]?.gravedad;
                  return (
                    <tr key={negocio.id} className="hover:bg-[var(--color-lienzo)]">
                      <td className="py-2 pr-3">
                        <Link href={`/negocios/${negocio.id}`} className="font-medium hover:underline">
                          {nombreLead.get(negocio.leadId) ?? negocio.leadId}
                        </Link>
                        <p className="text-xs text-[var(--color-tinta-suave)]">
                          {nombreProyecto.get(negocio.proyectoId ?? "") ?? "sin proyecto"}
                          {negocio.unidad ? ` · ${negocio.unidad}` : ""}
                        </p>
                      </td>
                      <td className="py-2 pr-3">
                        <span className="rounded-full bg-[var(--color-lienzo)] px-2 py-0.5 text-xs">
                          {ETIQUETA_CIERRE[negocio.etapa]}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-lienzo)]">
                            <div
                              className="h-full bg-[var(--color-marca)]"
                              style={{ width: `${avance(negocio)}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums">{avance(negocio)}%</span>
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {siguiente ? (
                          <>
                            {siguiente.nombre}
                            <span className="block text-[var(--color-tinta-suave)]">
                              {ETIQUETA_RESPONSABLE[siguiente.responsable as Responsable] ??
                                siguiente.responsable}
                              {siguiente.hito.comprometidoPara
                                ? ` · ${formatearFecha(siguiente.hito.comprometidoPara)}`
                                : ""}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{formatearUf(precioFinalUf(negocio))}</td>
                      <td className="py-2 pr-3 text-xs">
                        {nombreEjecutivo.get(negocio.ejecutivoId ?? "") ?? "sin asignar"}
                      </td>
                      <td className="py-2">
                        {propias.length > 0 ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${COLOR_GRAVEDAD[peor ?? "media"]}`}
                          >
                            {propias.length}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--color-tinta-suave)]">al día</span>
                        )}
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
