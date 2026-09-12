import Link from "next/link";
import { notFound } from "next/navigation";

import { gestionarUno } from "@/app/acciones";
import { BotonAccion } from "@/componentes/boton-accion";
import { EtiquetaEstado, Tarjeta, Temperatura, Vacio } from "@/componentes/ui";
import { abrirNegocio } from "@/app/negocios/acciones";
import { exigirUsuario, puedeVerLead } from "@/lib/auth/acceso";
import { tienda } from "@/lib/datos";
import { documento } from "@/lib/documentos/catalogo";
import { formatearClp, formatearFecha, formatearUf, valorUf } from "@/lib/dominio/chile";
import { horasRestantesDeVentana } from "@/lib/mensajeria/politica";

export const dynamic = "force-dynamic";

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--color-tinta-suave)]">{etiqueta}</dt>
      <dd className="text-sm">{valor}</dd>
    </div>
  );
}

export default async function FichaLead({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const usuario = await exigirUsuario(`/leads/${id}`);
  const db = tienda();
  const lead = await db.obtenerLead(id);
  if (!lead) notFound();
  // Un lead fuera de la cartera no existe para este usuario.
  if (!puedeVerLead(usuario, lead)) notFound();

  const [oportunidad, mensajes, visitas, actividades, solicitud, negocio, uf] = await Promise.all([
    db.oportunidadDeLead(id),
    db.listarMensajes(id),
    db.listarVisitas(),
    db.listarActividades(200),
    db.solicitudDeLead(id),
    db.negocioDeLead(id),
    valorUf(),
  ]);

  const calificacion = oportunidad?.calificacion ?? null;
  const perfil = calificacion?.perfil ?? lead.perfil;
  const visitasLead = visitas.filter((visita) => visita.leadId === id);
  const ventana = horasRestantesDeVentana(lead);
  const actividadesLead = actividades.filter((actividad) => actividad.leadId === id);

  const pesos = (valor: number | null) => (valor === null ? "—" : formatearClp(valor));
  const siNo = (valor: boolean | null) => (valor === null ? "—" : valor ? "Sí" : "No");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/leads" className="text-xs text-[var(--color-tinta-suave)] hover:underline">
            ← Volver a la bandeja
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{lead.nombre}</h1>
          <p className="text-sm text-[var(--color-tinta-suave)]">
            {[lead.email, lead.telefono, lead.rut].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {oportunidad && <EtiquetaEstado estado={oportunidad.estado} />}
          <form action={gestionarUno}>
            <input type="hidden" name="leadId" value={lead.id} />
            <BotonAccion variante="secundario">{calificacion ? "Recalificar" : "Calificar"}</BotonAccion>
          </form>
          {negocio ? (
            <Link
              href={`/negocios/${negocio.id}`}
              className="rounded-md bg-[var(--color-marca)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              Ver cierre
            </Link>
          ) : (
            <form action={abrirNegocio}>
              <input type="hidden" name="leadId" value={lead.id} />
              <BotonAccion>Abrir cierre</BotonAccion>
            </form>
          )}
        </div>
      </div>

      {(lead.optOut || lead.enManosDeHumano) && (
        <div className="space-y-2">
          {lead.optOut && (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
              Pidió no recibir más mensajes
              {lead.optOutEn ? ` el ${formatearFecha(lead.optOutEn)}` : ""}. El agente no le escribe.
            </p>
          )}
          {lead.enManosDeHumano && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              La conversación la lleva una persona del equipo. El agente dejó de responder.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Tarjeta
            titulo="Conversación"
            accion={
              <span className="text-xs text-[var(--color-tinta-suave)]">
                {ventana === null
                  ? "Ventana de WhatsApp cerrada: solo plantillas"
                  : `Ventana de WhatsApp abierta por ${ventana} h`}
              </span>
            }
          >
            <ul className="space-y-3">
              {mensajes
                // WhatsApp entrega la hora con precisión de segundos, así que
                // dos mensajes del mismo segundo empatan: el id desempata por
                // orden de llegada.
                .sort((a, b) => a.enviadoEn.localeCompare(b.enviadoEn) || a.id.localeCompare(b.id))
                .map((mensaje) => (
                  <li
                    key={mensaje.id}
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      mensaje.direccion === "entrante"
                        ? "border-[var(--color-borde)] bg-[var(--color-lienzo)]"
                        : "border-green-200 bg-green-50"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs text-[var(--color-tinta-suave)]">
                      <span>
                        {mensaje.direccion === "entrante" ? lead.nombre : "Gestor"} · {mensaje.canal}
                        {mensaje.automatico ? " · automático" : ""}
                        {mensaje.plantilla ? ` · plantilla ${mensaje.plantilla}` : ""}
                      </span>
                      <span>
                        {formatearFecha(mensaje.enviadoEn)}
                        {mensaje.direccion === "saliente" ? ` · ${mensaje.estado}` : ""}
                      </span>
                    </div>
                    {mensaje.asunto && <p className="mb-1 text-sm font-medium">{mensaje.asunto}</p>}
                    <p className="whitespace-pre-wrap">{mensaje.cuerpo}</p>
                    {mensaje.detalleError && (
                      <p className="mt-1 text-xs text-rose-700">{mensaje.detalleError}</p>
                    )}
                  </li>
                ))}
            </ul>
          </Tarjeta>

          {calificacion && (
            <Tarjeta titulo="Proyectos recomendados">
              {calificacion.recomendaciones.length === 0 ? (
                <Vacio mensaje="Ningún proyecto del inventario calzó con esta búsqueda." />
              ) : (
                <ul className="space-y-2">
                  {calificacion.recomendaciones.map((recomendacion) => (
                    <li
                      key={recomendacion.proyectoId}
                      className="rounded-md border border-[var(--color-borde)] p-3"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">{recomendacion.nombre}</span>
                        <span className="text-sm tabular-nums">
                          {recomendacion.precioUf ? formatearUf(recomendacion.precioUf) : "precio por confirmar"}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--color-tinta-suave)]">
                        {recomendacion.comuna}
                        {recomendacion.modelo ? ` · tipología ${recomendacion.modelo}` : ""}
                      </p>
                      <p className="mt-1 text-sm">{recomendacion.motivo}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Tarjeta>
          )}

          <Tarjeta titulo="Bitácora">
            {actividadesLead.length === 0 ? (
              <Vacio mensaje="Sin actividad." />
            ) : (
              <ul className="divide-y divide-[var(--color-borde)] text-sm">
                {actividadesLead.map((actividad) => (
                  <li key={actividad.id} className="flex gap-3 py-2">
                    <span className="w-32 shrink-0 text-xs text-[var(--color-tinta-suave)]">
                      {formatearFecha(actividad.ocurridaEn)}
                    </span>
                    <span>{actividad.detalle}</span>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>
        </div>

        <div className="space-y-4">
          <Tarjeta titulo="Calificación">
            {!calificacion ? (
              <Vacio mensaje="Este lead todavía no se califica." />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-semibold tabular-nums">{calificacion.puntaje}</span>
                  <Temperatura valor={calificacion.temperatura} />
                </div>
                <dl className="grid gap-3">
                  <Dato
                    etiqueta="Techo de compra"
                    valor={
                      calificacion.presupuestoUfEstimado
                        ? `${formatearUf(calificacion.presupuestoUfEstimado)} (${formatearClp(
                            calificacion.presupuestoUfEstimado * uf.valor,
                          )})`
                        : "Sin datos suficientes"
                    }
                  />
                  <Dato
                    etiqueta="Pie disponible"
                    valor={calificacion.pieUfEstimado ? formatearUf(calificacion.pieUfEstimado) : "—"}
                  />
                  <Dato etiqueta="Urgencia" valor={calificacion.urgencia} />
                  <Dato etiqueta="Siguiente acción" valor={calificacion.siguienteAccion.replace(/_/g, " ")} />
                  <Dato etiqueta="Motor" valor={calificacion.motor} />
                </dl>
                {calificacion.razonamiento && (
                  <p className="border-t border-[var(--color-borde)] pt-3 text-sm">
                    {calificacion.razonamiento}
                  </p>
                )}
                {calificacion.objeciones.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[var(--color-tinta-suave)]">
                      Objeciones
                    </p>
                    <ul className="mt-1 list-disc pl-4 text-sm">
                      {calificacion.objeciones.map((objecion) => (
                        <li key={objecion}>{objecion}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {calificacion.riesgos.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[var(--color-tinta-suave)]">
                      Riesgos y notas
                    </p>
                    <ul className="mt-1 list-disc pl-4 text-sm">
                      {calificacion.riesgos.map((riesgo) => (
                        <li key={riesgo}>{riesgo}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Tarjeta>

          <Tarjeta titulo="Perfil financiero">
            <dl className="grid grid-cols-2 gap-3">
              <Dato etiqueta="Renta líquida" valor={pesos(perfil.rentaClp)} />
              <Dato etiqueta="Renta variable" valor={pesos(perfil.rentaVariableClp)} />
              <Dato etiqueta="Ahorro" valor={pesos(perfil.ahorroClp)} />
              <Dato etiqueta="Capacidad ahorro" valor={pesos(perfil.capacidadAhorroClp)} />
              <Dato etiqueta="Pareja" valor={siNo(perfil.tienePareja)} />
              <Dato etiqueta="Renta pareja" valor={pesos(perfil.rentaParejaClp)} />
              <Dato etiqueta="Dicom" valor={siNo(perfil.tieneDicom)} />
              <Dato etiqueta="Cuenta bancaria" valor={siNo(perfil.tieneCuentaBancaria)} />
              <Dato etiqueta="Cuotas consumo" valor={pesos(perfil.cuotasConsumoMensualesClp)} />
              <Dato etiqueta="Dividendos vigentes" valor={pesos(perfil.dividendosMensualesClp)} />
              <Dato etiqueta="Para invertir" valor={siNo(perfil.paraInvertir)} />
              <Dato etiqueta="Para vivir" valor={siNo(perfil.paraVivir)} />
            </dl>
          </Tarjeta>

          {visitasLead.length > 0 && (
            <Tarjeta titulo="Visitas">
              <ul className="space-y-2 text-sm">
                {visitasLead.map((visita) => (
                  <li key={visita.id} className="rounded-md border border-[var(--color-borde)] p-2">
                    <p className="font-medium">{formatearFecha(visita.inicio)}</p>
                    <p className="text-xs text-[var(--color-tinta-suave)]">
                      {visita.estado} · {visita.notas}
                    </p>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}

          {solicitud && (
            <Tarjeta titulo="Documentos para la preaprobación">
              <p className="mb-2 text-xs text-[var(--color-tinta-suave)]">
                Solicitados el {formatearFecha(solicitud.solicitadaEn)} · estado {solicitud.estado} ·
                se eliminan el {formatearFecha(solicitud.eliminarDespuesDe)}
              </p>
              <ul className="space-y-1 text-sm">
                {solicitud.documentos.map((pedido) => (
                  <li key={pedido.documento} className="flex items-start gap-2">
                    <span
                      className={pedido.recibidoEn ? "text-green-700" : "text-[var(--color-tinta-suave)]"}
                      aria-hidden
                    >
                      {pedido.recibidoEn ? "✓" : "○"}
                    </span>
                    <span>
                      {documento(pedido.documento)?.nombre ?? pedido.documento}
                      {pedido.archivo && (
                        <span className="block text-xs text-[var(--color-tinta-suave)]">
                          {pedido.archivo.nombre}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}

          {oportunidad && (
            <Tarjeta titulo="CRM">
              <dl className="grid gap-3">
                <Dato etiqueta="Sincronización" valor={oportunidad.sincronizacion} />
                <Dato
                  etiqueta="Última sincronización"
                  valor={oportunidad.sincronizadoEn ? formatearFecha(oportunidad.sincronizadoEn) : "—"}
                />
                <Dato
                  etiqueta="Comisión estimada"
                  valor={oportunidad.comisionUf ? formatearUf(oportunidad.comisionUf) : "—"}
                />
                {calificacion && calificacion.tags.length > 0 && (
                  <Dato etiqueta="Tags" valor={calificacion.tags.join(", ")} />
                )}
              </dl>
              {oportunidad.detalleSincronizacion && (
                <p className="mt-3 border-t border-[var(--color-borde)] pt-3 text-xs text-[var(--color-tinta-suave)]">
                  {oportunidad.detalleSincronizacion}
                </p>
              )}
            </Tarjeta>
          )}
        </div>
      </div>
    </div>
  );
}
