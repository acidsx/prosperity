import Link from "next/link";

import {
  correrIndeciso,
  correrSimulacion,
  ultimaSimulacion,
  ultimoIndeciso,
} from "@/app/simulacion/acciones";
import { BotonAccion } from "@/componentes/boton-accion";
import { Metrica, Tarjeta, Vacio } from "@/componentes/ui";
import { exigirUsuario } from "@/lib/auth/acceso";
import { formatearUf } from "@/lib/dominio/chile";
import type { Voz } from "@/lib/simulacion/indeciso";
import type { Actor } from "@/lib/simulacion/venta";

export const dynamic = "force-dynamic";

const ETIQUETA_ACTOR: Record<Actor, string> = {
  comprador: "Comprador",
  agente: "Agente",
  ejecutivo: "Ejecutivo",
  banco: "Banco",
  notaria: "Notaría",
  cbr: "Conservador",
  sistema: "Sistema",
};

const COLOR_ACTOR: Record<Actor, string> = {
  comprador: "bg-slate-100 text-slate-700",
  agente: "bg-green-100 text-green-900",
  ejecutivo: "bg-blue-100 text-blue-900",
  banco: "bg-indigo-100 text-indigo-900",
  notaria: "bg-amber-100 text-amber-900",
  cbr: "bg-purple-100 text-purple-900",
  sistema: "bg-rose-100 text-rose-900",
};

const ETIQUETA_VOZ: Record<Voz, string> = {
  comprador: "Comprador",
  agente: "Agente",
  ejecutivo: "Ejecutivo",
  sistema: "Sistema",
};

function fechaCorta(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Santiago",
  }).format(new Date(iso));
}

export default async function Simulacion() {
  await exigirUsuario("/simulacion");
  const [resultado, indeciso] = await Promise.all([ultimaSimulacion(), ultimoIndeciso()]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Simulación de una venta</h1>
          <p className="mt-1 text-sm text-[var(--color-tinta-suave)]">
            Recorre el ciclo completo, de la consulta a la entrega. La calificación, la respuesta y
            la confirmación de la visita las hace el agente con el mismo código que corre en
            producción; el banco, la notaría y el Conservador están simulados.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={correrSimulacion}>
            <BotonAccion>{resultado ? "Simular otra venta" : "Simular una venta"}</BotonAccion>
          </form>
          <form action={correrIndeciso}>
            <BotonAccion variante="secundario">
              {indeciso ? "Otro comprador indeciso" : "Simular un comprador indeciso"}
            </BotonAccion>
          </form>
        </div>
      </div>

      {!resultado ? (
        indeciso ? null : (
          <Tarjeta>
            <Vacio mensaje="Todavía no has corrido ninguna simulación." />
          </Tarjeta>
        )
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metrica
              etiqueta="Precio de cierre"
              valor={formatearUf(resultado.resumen.precioUf)}
              detalle={`${resultado.resumen.proyecto}${
                resultado.resumen.unidad ? ` · ${resultado.resumen.unidad}` : ""
              }`}
            />
            <Metrica
              etiqueta="Comisión"
              valor={formatearUf(resultado.resumen.comisionUf)}
              detalle={resultado.resumen.comprador}
            />
            <Metrica
              etiqueta="Duración"
              valor={`${resultado.resumen.diasHabiles} días`}
              detalle="hábiles, de la consulta a la comisión"
            />
            <Metrica
              etiqueta="Mensajes del agente"
              valor={String(resultado.resumen.mensajesDelAgente)}
              detalle={`${resultado.resumen.documentosRecibidos} documentos recibidos`}
            />
          </div>

          <div className="flex flex-wrap gap-3 text-sm">
            <Link
              href={`/leads/${resultado.resumen.leadId}`}
              className="rounded-md border border-[var(--color-borde)] bg-white px-3 py-1.5 hover:bg-[var(--color-lienzo)]"
            >
              Ver la conversación
            </Link>
            <Link
              href={`/negocios/${resultado.resumen.negocioId}`}
              className="rounded-md border border-[var(--color-borde)] bg-white px-3 py-1.5 hover:bg-[var(--color-lienzo)]"
            >
              Ver el cierre
            </Link>
          </div>

          <Tarjeta titulo="Lo que pasó, paso a paso">
            <ol className="space-y-3">
              {resultado.pasos.map((paso, indice) => (
                <li key={indice} className="flex gap-3">
                  <div className="w-24 shrink-0 text-right">
                    <p className="text-sm tabular-nums">día {paso.dia}</p>
                    <p className="text-xs text-[var(--color-tinta-suave)]">
                      {fechaCorta(paso.fecha)}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1 border-l border-[var(--color-borde)] pb-1 pl-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLOR_ACTOR[paso.actor]}`}
                      >
                        {ETIQUETA_ACTOR[paso.actor]}
                      </span>
                      <span className="font-medium">{paso.titulo}</span>
                    </div>
                    <p className="text-sm text-[var(--color-tinta-suave)]">{paso.detalle}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Tarjeta>
        </>
      )}

      {indeciso ? <ConversacionIndecisa resultado={indeciso} /> : null}
    </div>
  );
}

/**
 * El comprador difícil: el que no sabe qué quiere, tiene miedo y duda.
 *
 * Se muestra la conversación completa, con la objeción que respondió cada
 * mensaje, porque lo que hay que poder auditar es cómo persuade el agente y
 * dónde se detiene.
 */
function ConversacionIndecisa({ resultado }: { resultado: NonNullable<Awaited<ReturnType<typeof ultimoIndeciso>>> }) {
  const { turnos, resumen } = resultado;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          Un comprador indeciso y temeroso
        </h2>
        <p className="mt-1 text-sm text-[var(--color-tinta-suave)]">
          {resumen.comprador} no sabe qué busca, le da miedo endeudarse, pregunta qué pasa si
          pierde el trabajo, encuentra todo caro y desconfía. Las respuestas del agente salen del
          mismo código que corre en producción; lo escrito acá son solo sus mensajes.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica
          etiqueta="Le financiarían"
          valor={resumen.techoUf ? formatearUf(resumen.techoUf) : "Sin estimar"}
          detalle="según su renta y su ahorro"
        />
        <Metrica
          etiqueta="Objeciones"
          valor={String(resumen.objeciones.length)}
          detalle={`${resumen.mensajesDelAgente} mensajes del agente`}
        />
        <Metrica
          etiqueta="Pasó a una persona"
          valor={String(resumen.escalamientos)}
          detalle="desconfianza: no la maneja el agente solo"
        />
        <Metrica
          etiqueta="Dejó de insistir"
          valor={resumen.seDetuvo ? "Sí" : "No hizo falta"}
          detalle="a la tercera vez con el mismo miedo"
        />
      </div>

      <Tarjeta titulo="Objeciones que aparecieron">
        <ul className="flex flex-wrap gap-2">
          {resumen.objeciones.map((objecion) => (
            <li
              key={objecion.tipo}
              className="rounded-full bg-[var(--color-lienzo)] px-3 py-1 text-sm"
            >
              {objecion.etiqueta}
              <span className="ml-2 text-xs text-[var(--color-tinta-suave)]">
                {objecion.intentos} {objecion.intentos === 1 ? "vez" : "veces"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-[var(--color-tinta-suave)]">{resumen.desenlace}</p>
      </Tarjeta>

      <Tarjeta titulo="La conversación completa">
        <ol className="space-y-4">
          {turnos.map((turno, indice) => (
            <li
              key={indice}
              className={turno.voz === "comprador" ? "" : "sm:pl-10"}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${
                    turno.voz === "comprador"
                      ? "bg-slate-100 text-slate-700"
                      : turno.voz === "agente"
                        ? "bg-green-100 text-green-900"
                        : "bg-blue-100 text-blue-900"
                  }`}
                >
                  {ETIQUETA_VOZ[turno.voz]}
                </span>
                <span className="text-[var(--color-tinta-suave)]">
                  día {turno.dia} · {fechaCorta(turno.fecha)}
                  {turno.canal ? ` · ${turno.canal}` : ""}
                </span>
                {turno.etiquetaObjecion ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">
                    {turno.etiquetaObjecion}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{turno.texto}</p>
              {turno.nota ? (
                <p className="mt-1 text-xs text-[var(--color-tinta-suave)]">{turno.nota}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </Tarjeta>

      <Link
        href={`/leads/${resumen.leadId}`}
        className="inline-block rounded-md border border-[var(--color-borde)] bg-white px-3 py-1.5 text-sm hover:bg-[var(--color-lienzo)]"
      >
        Ver la ficha de {resumen.comprador.split(" ")[0]}
      </Link>
    </div>
  );
}
