import { sincronizarProyectos } from "@/app/acciones";
import { BotonAccion } from "@/componentes/boton-accion";
import { Tarjeta, Vacio } from "@/componentes/ui";
import { exigirUsuario } from "@/lib/auth/acceso";
import { tienda } from "@/lib/datos";
import { formatearClp, formatearUf } from "@/lib/dominio/chile";
import { ETIQUETA_ETAPA_PROYECTO } from "@/lib/jetbrokers/tipos";

export const dynamic = "force-dynamic";

export default async function Proyectos() {
  await exigirUsuario("/proyectos");
  const proyectos = await tienda().listarProyectos();
  const desdeApi = proyectos.filter((proyecto) => proyecto.desdeApi).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Inventario</h1>
          <p className="mt-1 text-sm text-[var(--color-tinta-suave)]">
            {proyectos.length} proyectos · {desdeApi} desde JetBrokers ·{" "}
            {proyectos.length - desdeApi} de demostración
          </p>
        </div>
        <form action={sincronizarProyectos}>
          <BotonAccion variante="secundario">Sincronizar con JetBrokers</BotonAccion>
        </form>
      </div>

      {proyectos.length === 0 ? (
        <Tarjeta>
          <Vacio mensaje="Sin inventario. Sincroniza para traer los proyectos." />
        </Tarjeta>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {proyectos.map((proyecto) => (
            <article
              key={proyecto.id}
              className="rounded-lg border border-[var(--color-borde)] bg-white p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium">{proyecto.nombre}</h2>
                  <p className="text-xs text-[var(--color-tinta-suave)]">
                    {proyecto.comuna}
                    {proyecto.desarrollador ? ` · ${proyecto.desarrollador}` : ""}
                  </p>
                </div>
                {proyecto.etapa && (
                  <span className="shrink-0 rounded-full bg-[var(--color-lienzo)] px-2 py-0.5 text-xs">
                    {ETIQUETA_ETAPA_PROYECTO[proyecto.etapa]}
                  </span>
                )}
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-[var(--color-tinta-suave)]">Precio</dt>
                  <dd className="tabular-nums">
                    {proyecto.precioDesdeUf
                      ? `${formatearUf(proyecto.precioDesdeUf)}${
                          proyecto.precioHastaUf && proyecto.precioHastaUf !== proyecto.precioDesdeUf
                            ? ` – ${formatearUf(proyecto.precioHastaUf)}`
                            : ""
                        }`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-tinta-suave)]">Reserva</dt>
                  <dd className="tabular-nums">
                    {proyecto.reservaClp ? formatearClp(proyecto.reservaClp) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-tinta-suave)]">Entrega</dt>
                  <dd>{[proyecto.entrega, proyecto.anoEntrega].filter(Boolean).join(" ") || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-tinta-suave)]">Comisión</dt>
                  <dd>{proyecto.feePorcentaje ? `${proyecto.feePorcentaje}%` : "—"}</dd>
                </div>
              </dl>

              {proyecto.modelos.length > 0 && (
                <p className="mt-3 text-xs text-[var(--color-tinta-suave)]">
                  Tipologías:{" "}
                  {proyecto.modelos
                    .map((modelo) => `${modelo.name} (${modelo.rooms}D${modelo.bathrooms}B)`)
                    .join(", ")}
                </p>
              )}

              {proyecto.tags.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1">
                  {proyecto.tags.map((tag) => (
                    <li
                      key={tag}
                      className="rounded-full bg-[var(--color-marca-suave)] px-2 py-0.5 text-xs text-[var(--color-marca)]"
                    >
                      {tag}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
