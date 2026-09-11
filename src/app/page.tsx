import Link from "next/link";

import { ejecutarAgente, reiniciarSimulacion, sincronizarProyectos } from "@/app/acciones";
import { BotonAccion } from "@/componentes/boton-accion";
import { EtiquetaEstado, Metrica, Tarjeta, Vacio } from "@/componentes/ui";
import { tienda } from "@/lib/datos";
import { formatearFecha, formatearUf, valorUf, formatearClp } from "@/lib/dominio/chile";
import { ESTADOS_CLIENTE, ETIQUETA_ESTADO, type EstadoCliente } from "@/lib/jetbrokers/tipos";

export const dynamic = "force-dynamic";

export default async function Panel() {
  const db = tienda();
  const [leads, oportunidades, visitas, actividades, proyectos, uf] = await Promise.all([
    db.listarLeads(),
    db.listarOportunidades(),
    db.listarVisitas(),
    db.listarActividades(12),
    db.listarProyectos(),
    valorUf(),
  ]);

  const calificadas = oportunidades.filter((opo) => opo.calificacion !== null);
  const pendientes = leads.length - calificadas.length;
  const agendadas = oportunidades.filter((opo) => opo.estado === "scheduled");
  const valorPipeline = oportunidades
    .filter((opo) => !["dropped", "noQualify"].includes(opo.estado))
    .reduce((total, opo) => total + (opo.valorUf ?? 0), 0);
  const comision = oportunidades.reduce((total, opo) => total + (opo.comisionUf ?? 0), 0);

  const porEstado = new Map<EstadoCliente, number>();
  for (const oportunidad of oportunidades) {
    porEstado.set(oportunidad.estado, (porEstado.get(oportunidad.estado) ?? 0) + 1);
  }

  const conexiones = [
    {
      nombre: "JetBrokers",
      activo: Boolean(process.env.JETBROKERS_ORG_ID),
      detalle: process.env.JETBROKERS_ORG_ID
        ? process.env.JETBROKERS_ESCRITURA === "true"
          ? "Conectado, escritura habilitada"
          : "Conectado en modo simulación (no escribe en el CRM)"
        : "Sin configurar: inventario de demostración",
    },
    {
      nombre: "Claude",
      activo: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
      detalle:
        process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
          ? `Modelo ${process.env.ANTHROPIC_MODEL ?? "claude-opus-5"}`
          : "Sin credenciales: se usa la heurística local",
    },
    {
      nombre: "Persistencia",
      activo: db.nombre === "supabase",
      detalle: db.nombre === "supabase" ? "Supabase" : "En memoria (se reinicia con el proceso)",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Panel del gestor</h1>
          <p className="mt-1 text-sm text-[var(--color-tinta-suave)]">
            UF de hoy {formatearClp(uf.valor)}
            {uf.fuente === "fallback" ? " (valor de respaldo)" : " según mindicador.cl"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={ejecutarAgente}>
            <BotonAccion>Procesar {pendientes} pendientes</BotonAccion>
          </form>
          <form action={sincronizarProyectos}>
            <BotonAccion variante="secundario">Sincronizar inventario</BotonAccion>
          </form>
          {db.nombre === "memoria" && (
            <form action={reiniciarSimulacion}>
              <BotonAccion variante="secundario">Reiniciar simulación</BotonAccion>
            </form>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica etiqueta="Leads" valor={String(leads.length)} detalle={`${pendientes} sin calificar`} />
        <Metrica
          etiqueta="Visitas agendadas"
          valor={String(agendadas.length)}
          detalle={`${visitas.length} en agenda`}
        />
        <Metrica
          etiqueta="Pipeline"
          valor={formatearUf(valorPipeline)}
          detalle={formatearClp(valorPipeline * uf.valor)}
        />
        <Metrica
          etiqueta="Comisión potencial"
          valor={formatearUf(comision)}
          detalle={`${proyectos.length} proyectos en inventario`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Tarjeta titulo="Pipeline por estado">
            <div className="grid gap-2 sm:grid-cols-2">
              {ESTADOS_CLIENTE.filter((estado) => (porEstado.get(estado) ?? 0) > 0).map((estado) => (
                <div
                  key={estado}
                  className="flex items-center justify-between rounded-md border border-[var(--color-borde)] px-3 py-2"
                >
                  <EtiquetaEstado estado={estado} />
                  <span className="text-sm font-medium tabular-nums">{porEstado.get(estado)}</span>
                </div>
              ))}
              {porEstado.size === 0 && <Vacio mensaje="Todavía no hay oportunidades calificadas." />}
            </div>
          </Tarjeta>

          <Tarjeta
            titulo="Actividad reciente"
            accion={
              <Link href="/leads" className="text-xs text-[var(--color-tinta-suave)] hover:underline">
                Ver leads
              </Link>
            }
          >
            {actividades.length === 0 ? (
              <Vacio mensaje="Sin actividad todavía. Procesa los leads pendientes." />
            ) : (
              <ul className="divide-y divide-[var(--color-borde)] text-sm">
                {actividades.map((actividad) => (
                  <li key={actividad.id} className="flex gap-3 py-2">
                    <span className="w-32 shrink-0 text-xs text-[var(--color-tinta-suave)]">
                      {formatearFecha(actividad.ocurridaEn)}
                    </span>
                    <span className="flex-1">{actividad.detalle}</span>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>
        </div>

        <Tarjeta titulo="Conexiones">
          <ul className="space-y-3 text-sm">
            {conexiones.map((conexion) => (
              <li key={conexion.nombre}>
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${conexion.activo ? "bg-green-600" : "bg-amber-500"}`}
                    aria-hidden
                  />
                  <span className="font-medium">{conexion.nombre}</span>
                </div>
                <p className="ml-4 text-xs text-[var(--color-tinta-suave)]">{conexion.detalle}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-[var(--color-borde)] pt-3 text-xs text-[var(--color-tinta-suave)]">
            Los estados del pipeline son los mismos que acepta el campo <code>status</code> del
            Customer API: {ESTADOS_CLIENTE.map((estado) => ETIQUETA_ESTADO[estado]).join(", ")}.
          </p>
        </Tarjeta>
      </div>
    </div>
  );
}
