import Link from "next/link";

import { Metrica, Tarjeta, Vacio } from "@/componentes/ui";
import { exigirPermiso } from "@/lib/auth/acceso";
import { aPublico, ETIQUETA_ROL } from "@/lib/auth/tipos";
import { sembrarNegociosDemo } from "@/lib/cierre/demo";
import { alertasDeLaCartera, auditoriaDelAgente, metricasPorEjecutivo } from "@/lib/cierre/gestion";
import { tienda } from "@/lib/datos";
import { formatearUf } from "@/lib/dominio/chile";
import { ETIQUETA_RESPONSABLE, precioFinalUf, type Responsable } from "@/lib/dominio/cierre";

export const dynamic = "force-dynamic";

function duracion(minutos: number | null): string {
  if (minutos === null) return "—";
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 1440) return `${Math.round(minutos / 60)} h`;
  return `${Math.round(minutos / 1440)} d`;
}

export default async function Control() {
  await exigirPermiso("ver_control_de_gestion");
  await sembrarNegociosDemo();

  const db = tienda();
  const [usuarios, leads, oportunidades, mensajes, visitas, negocios, actividades] =
    await Promise.all([
      db.listarUsuarios(),
      db.listarLeads(),
      db.listarOportunidades(),
      db.listarMensajes(),
      db.listarVisitas(),
      db.listarNegocios(),
      db.listarActividades(500),
    ]);

  const filas = metricasPorEjecutivo({
    usuarios: usuarios.map(aPublico),
    leads,
    oportunidades,
    mensajes,
    visitas,
    negocios,
  });

  const agente = auditoriaDelAgente(oportunidades, mensajes, actividades);

  // Una alerta sin saber de qué operación es no sirve: se etiqueta con el
  // comprador y la unidad.
  const nombreLead = new Map(leads.map((lead) => [lead.id, lead.nombre]));
  const etiquetaNegocio = new Map(
    negocios.map((negocio) => [
      negocio.id,
      [nombreLead.get(negocio.leadId) ?? negocio.leadId, negocio.unidad].filter(Boolean).join(" · "),
    ]),
  );
  const activos = negocios.filter(
    (negocio) => negocio.etapa !== "cerrado" && negocio.etapa !== "caido",
  );
  const alertas = alertasDeLaCartera(activos);

  const pipelineUf = activos.reduce((total, negocio) => total + precioFinalUf(negocio), 0);
  const comisionUf = activos.reduce((total, negocio) => total + (negocio.comisionUf ?? 0), 0);
  const cerrados = negocios.filter((negocio) => negocio.etapa === "cerrado");
  const caidos = negocios.filter((negocio) => negocio.etapa === "caido");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Control de gestión</h1>
        <p className="mt-1 text-sm text-[var(--color-tinta-suave)]">
          Cómo va el equipo y qué está haciendo el agente.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica
          etiqueta="Pipeline en cierre"
          valor={formatearUf(pipelineUf)}
          detalle={`${activos.length} operaciones activas`}
        />
        <Metrica
          etiqueta="Comisión proyectada"
          valor={formatearUf(comisionUf)}
          detalle={`${cerrados.length} cerradas · ${caidos.length} caídas`}
        />
        <Metrica
          etiqueta="Alertas abiertas"
          valor={String(alertas.length)}
          detalle={`${alertas.filter((alerta) => alerta.gravedad === "critica").length} críticas`}
        />
        <Metrica
          etiqueta="Leads procesados"
          valor={String(agente.leadsProcesados)}
          detalle={`${agente.escalamientos} escalados a una persona`}
        />
      </div>

      <Tarjeta titulo="Por ejecutivo">
        {filas.length === 0 ? (
          <Vacio mensaje="Sin cartera asignada." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-borde)] text-left text-xs uppercase tracking-wide text-[var(--color-tinta-suave)]">
                  <th className="py-2 pr-3 font-medium">Ejecutivo</th>
                  <th className="py-2 pr-3 font-medium">Leads</th>
                  <th className="py-2 pr-3 font-medium">1ª respuesta</th>
                  <th className="py-2 pr-3 font-medium">Sin responder</th>
                  <th className="py-2 pr-3 font-medium">Visitas</th>
                  <th className="py-2 pr-3 font-medium">Cierres</th>
                  <th className="py-2 pr-3 font-medium">Pipeline</th>
                  <th className="py-2 pr-3 font-medium">Comisión</th>
                  <th className="py-2 font-medium">Alertas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-borde)]">
                {filas.map((fila) => (
                  <tr key={fila.ejecutivo?.id ?? "sin-asignar"}>
                    <td className="py-2 pr-3">
                      <p className="font-medium">{fila.ejecutivo?.nombre ?? "Sin asignar"}</p>
                      <p className="text-xs text-[var(--color-tinta-suave)]">
                        {fila.ejecutivo ? ETIQUETA_ROL[fila.ejecutivo.rol] : "cartera huérfana"}
                      </p>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {fila.leads}
                      <span className="text-xs text-[var(--color-tinta-suave)]">
                        {" "}
                        ({fila.calificados} calificados)
                      </span>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {duracion(fila.primeraRespuestaMediana)}
                    </td>
                    <td
                      className={`py-2 pr-3 tabular-nums ${fila.sinResponder > 0 ? "text-rose-700" : ""}`}
                    >
                      {fila.sinResponder}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {fila.visitasAgendadas}
                      <span className="text-xs text-[var(--color-tinta-suave)]">
                        {" "}
                        / {fila.visitasRealizadas} hechas
                      </span>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {fila.negociosActivos}
                      <span className="text-xs text-[var(--color-tinta-suave)]">
                        {" "}
                        ({fila.negociosCerrados} cerrados)
                      </span>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{formatearUf(fila.pipelineUf)}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {formatearUf(fila.comisionProyectadaUf)}
                    </td>
                    <td className="py-2 tabular-nums">{fila.alertas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-[var(--color-tinta-suave)]">
          La primera respuesta es la mediana entre la consulta del comprador y el primer mensaje que
          sale. Es la métrica que más mueve la conversión en corretaje.
        </p>
      </Tarjeta>

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Qué hizo el agente">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-[var(--color-tinta-suave)]">Calificados con el modelo</dt>
              <dd className="tabular-nums">{agente.conModelo}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-tinta-suave)]">Con la heurística local</dt>
              <dd className="tabular-nums">{agente.conHeuristica}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-tinta-suave)]">Mensajes enviados</dt>
              <dd className="tabular-nums">{agente.mensajesEnviados}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-tinta-suave)]">En simulación</dt>
              <dd className="tabular-nums">{agente.mensajesSimulados}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-tinta-suave)]">Envíos frenados</dt>
              <dd className="tabular-nums">{agente.enviosBloqueados}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-tinta-suave)]">Escalados a una persona</dt>
              <dd className="tabular-nums">{agente.escalamientos}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-tinta-suave)]">Bajas</dt>
              <dd className="tabular-nums">{agente.bajas}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-tinta-suave)]">Errores</dt>
              <dd className={`tabular-nums ${agente.errores > 0 ? "text-rose-700" : ""}`}>
                {agente.errores}
              </dd>
            </div>
          </dl>

          {agente.motivosDeFreno.length > 0 && (
            <div className="mt-4 border-t border-[var(--color-borde)] pt-3">
              <p className="text-xs uppercase tracking-wide text-[var(--color-tinta-suave)]">
                Por qué se detuvo
              </p>
              <ul className="mt-1 space-y-1 text-sm">
                {agente.motivosDeFreno.slice(0, 6).map((item) => (
                  <li key={item.motivo} className="flex justify-between gap-3">
                    <span>{item.motivo}</span>
                    <span className="tabular-nums text-[var(--color-tinta-suave)]">{item.veces}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-3 text-xs text-[var(--color-tinta-suave)]">
            Un agente que escala seguido no está fallando: está pidiendo ayuda donde corresponde.
            Lo que hay que mirar son los errores y los envíos frenados por tope.
          </p>
        </Tarjeta>

        <Tarjeta titulo="Alertas de la cartera">
          {alertas.length === 0 ? (
            <Vacio mensaje="Nada atrasado ni por vencer." />
          ) : (
            <ul className="space-y-2">
              {alertas.slice(0, 12).map((alerta, indice) => (
                <li key={indice} className="text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={`/negocios/${alerta.negocioId}`}
                      className="font-medium hover:underline"
                    >
                      {alerta.titulo}
                      <span className="ml-2 font-normal text-[var(--color-tinta-suave)]">
                        {etiquetaNegocio.get(alerta.negocioId) ?? ""}
                      </span>
                    </Link>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        alerta.gravedad === "critica"
                          ? "bg-rose-100 text-rose-900"
                          : alerta.gravedad === "alta"
                            ? "bg-amber-100 text-amber-900"
                            : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {ETIQUETA_RESPONSABLE[alerta.responsable as Responsable] ?? alerta.responsable}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-tinta-suave)]">{alerta.detalle}</p>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>
    </div>
  );
}
