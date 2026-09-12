import Link from "next/link";
import { notFound } from "next/navigation";

import {
  actualizarCredito,
  agendarFirma,
  caerNegocio,
  confirmarFirma,
  marcarHito,
  reasignarNegocio,
  registrarCbr,
  registrarDocumento,
} from "@/app/negocios/acciones";
import { BotonAccion } from "@/componentes/boton-accion";
import { Tarjeta, Vacio } from "@/componentes/ui";
import { exigirUsuario, puedeVerNegocio } from "@/lib/auth/acceso";
import { puede } from "@/lib/auth/tipos";
import { alertasDelNegocio, avance } from "@/lib/cierre/negocio";
import { tienda } from "@/lib/datos";
import { formatearClp, formatearFecha, formatearUf } from "@/lib/dominio/chile";
import {
  BANCOS,
  ETAPAS_CIERRE,
  ETIQUETA_CIERRE,
  ETIQUETA_CREDITO,
  ETIQUETA_RESPONSABLE,
  PLAN_CIERRE,
  precioFinalUf,
  type EstadoCredito,
  type Responsable,
} from "@/lib/dominio/cierre";
import { documentoPropiedad, vigenciaDocumento } from "@/lib/documentos/propiedad";

export const dynamic = "force-dynamic";

const CAMPO = "rounded-md border border-[var(--color-borde)] px-2 py-1.5 text-sm";

const COLOR_VIGENCIA = {
  vigente: "text-green-700",
  por_vencer: "text-amber-700",
  vencido: "text-rose-700",
  sin_recibir: "text-[var(--color-tinta-suave)]",
  sin_vencimiento: "text-[var(--color-tinta-suave)]",
} as const;

export default async function FichaNegocio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const usuario = await exigirUsuario(`/negocios/${id}`);

  const db = tienda();
  const negocio = await db.obtenerNegocio(id);
  if (!negocio) notFound();
  if (!puedeVerNegocio(usuario, negocio)) notFound();

  const [lead, proyecto, usuarios] = await Promise.all([
    db.obtenerLead(negocio.leadId),
    negocio.proyectoId ? db.obtenerProyecto(negocio.proyectoId) : Promise.resolve(null),
    db.listarUsuarios(),
  ]);

  const alertas = alertasDelNegocio(negocio);
  const editable = puede(usuario.rol, "editar_cierre") && negocio.etapa !== "caido";
  const ejecutivo = usuarios.find((item) => item.id === negocio.ejecutivoId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/negocios" className="text-xs text-[var(--color-tinta-suave)] hover:underline">
            ← Volver a cierres
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            {lead?.nombre ?? negocio.leadId}
          </h1>
          <p className="text-sm text-[var(--color-tinta-suave)]">
            {proyecto?.nombre ?? "sin proyecto"}
            {negocio.unidad ? ` · ${negocio.unidad}` : ""}
            {negocio.modelo ? ` · tipología ${negocio.modelo}` : ""} ·{" "}
            {formatearUf(precioFinalUf(negocio))}
          </p>
        </div>
        <div className="text-right">
          <span className="rounded-full bg-[var(--color-lienzo)] px-3 py-1 text-sm font-medium">
            {ETIQUETA_CIERRE[negocio.etapa]}
          </span>
          <p className="mt-1 text-xs text-[var(--color-tinta-suave)]">
            {avance(negocio)}% · {ejecutivo?.nombre ?? "sin ejecutivo"}
          </p>
        </div>
      </div>

      {negocio.motivoCaida && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          Negocio caído: {negocio.motivoCaida}
        </p>
      )}

      {alertas.length > 0 && (
        <Tarjeta titulo={`${alertas.length} alerta(s)`}>
          <ul className="space-y-2">
            {alertas.map((alerta, indice) => (
              <li
                key={indice}
                className={`rounded-md px-3 py-2 text-sm ${
                  alerta.gravedad === "critica"
                    ? "border border-rose-200 bg-rose-50"
                    : alerta.gravedad === "alta"
                      ? "border border-amber-200 bg-amber-50"
                      : "border border-[var(--color-borde)]"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{alerta.titulo}</span>
                  <span className="text-xs text-[var(--color-tinta-suave)]">
                    {ETIQUETA_RESPONSABLE[alerta.responsable as Responsable] ?? alerta.responsable}
                  </span>
                </div>
                <p className="text-xs">{alerta.detalle}</p>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Tarjeta titulo="Línea del cierre">
            <ol className="space-y-4">
              {ETAPAS_CIERRE.map((etapa) => {
                const hitos = PLAN_CIERRE.filter((definicion) => definicion.etapa === etapa);
                if (hitos.length === 0) return null;
                return (
                  <li key={etapa}>
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-tinta-suave)]">
                      {ETIQUETA_CIERRE[etapa]}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {hitos.map((definicion) => {
                        const registro = negocio.hitos.find((item) => item.tipo === definicion.tipo);
                        const listo = Boolean(registro?.cumplidoEn);
                        const atrasado =
                          !listo &&
                          registro?.comprometidoPara &&
                          new Date(registro.comprometidoPara) < new Date();
                        return (
                          <li
                            key={definicion.tipo}
                            className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md border border-[var(--color-borde)] px-3 py-2 text-sm"
                          >
                            <span className={listo ? "text-green-700" : "text-[var(--color-tinta-suave)]"} aria-hidden>
                              {listo ? "✓" : "○"}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className={listo ? "text-[var(--color-tinta-suave)] line-through" : ""}>
                                {definicion.nombre}
                              </p>
                              <p className="text-xs text-[var(--color-tinta-suave)]">
                                {ETIQUETA_RESPONSABLE[definicion.responsable]}
                                {registro?.cumplidoEn
                                  ? ` · cumplido ${formatearFecha(registro.cumplidoEn)}`
                                  : registro?.comprometidoPara
                                    ? ` · comprometido ${formatearFecha(registro.comprometidoPara)}`
                                    : ""}
                                {atrasado ? " · atrasado" : ""}
                              </p>
                              {registro?.nota && <p className="text-xs">{registro.nota}</p>}
                            </div>
                            {!listo && editable && (
                              <form action={marcarHito} className="shrink-0">
                                <input type="hidden" name="negocioId" value={negocio.id} />
                                <input type="hidden" name="hito" value={definicion.tipo} />
                                <BotonAccion variante="secundario">Cumplido</BotonAccion>
                              </form>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ol>
          </Tarjeta>

          <Tarjeta titulo="Control documental de la propiedad">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-borde)] text-left text-xs uppercase tracking-wide text-[var(--color-tinta-suave)]">
                    <th className="py-2 pr-3 font-medium">Documento</th>
                    <th className="py-2 pr-3 font-medium">Vigencia</th>
                    <th className="py-2 pr-3 font-medium">Estado</th>
                    {editable && <th className="py-2 font-medium">Registrar</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-borde)]">
                  {negocio.documentos.map((registro) => {
                    const definicion = documentoPropiedad(registro.documento);
                    const vigencia = vigenciaDocumento(registro);
                    return (
                      <tr key={registro.documento}>
                        <td className="py-2 pr-3">
                          <p>{definicion?.nombre ?? registro.documento}</p>
                          <p className="text-xs text-[var(--color-tinta-suave)]">
                            {definicion?.donde}
                          </p>
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {definicion?.vigenciaDias ? `${definicion.vigenciaDias} días` : "no vence"}
                        </td>
                        <td className={`py-2 pr-3 text-xs ${COLOR_VIGENCIA[vigencia.estado]}`}>
                          {vigencia.estado === "sin_recibir"
                            ? "sin recibir"
                            : vigencia.estado === "sin_vencimiento"
                              ? `recibido ${formatearFecha(registro.recibidoEn!)}`
                              : `${vigencia.estado.replace("_", " ")} · ${
                                  (vigencia.diasRestantes ?? 0) >= 0
                                    ? `quedan ${vigencia.diasRestantes} d`
                                    : `venció hace ${Math.abs(vigencia.diasRestantes ?? 0)} d`
                                }`}
                        </td>
                        {editable && (
                          <td className="py-2">
                            <form action={registrarDocumento} className="flex flex-wrap items-center gap-1">
                              <input type="hidden" name="negocioId" value={negocio.id} />
                              <input type="hidden" name="documento" value={registro.documento} />
                              <input
                                type="date"
                                name="emitidoEn"
                                title="Fecha de emisión del certificado"
                                className={CAMPO}
                              />
                              <input
                                name="nombreArchivo"
                                placeholder="archivo.pdf"
                                className={`${CAMPO} w-32`}
                              />
                              <BotonAccion variante="secundario">Registrar</BotonAccion>
                            </form>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Tarjeta>

          <Tarjeta titulo="Firmas ante notario">
            {negocio.firmas.length === 0 ? (
              <Vacio mensaje="Sin firmas agendadas." />
            ) : (
              <ul className="mb-4 space-y-2">
                {negocio.firmas.map((firma) => (
                  <li
                    key={firma.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--color-borde)] px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">
                        Firma del {firma.parte}
                        {firma.firmadaEn ? " · firmada" : ""}
                      </p>
                      <p className="text-xs text-[var(--color-tinta-suave)]">
                        {[
                          firma.notaria,
                          firma.direccionNotaria,
                          firma.agendadaPara ? formatearFecha(firma.agendadaPara) : null,
                          firma.asistentes.length ? `asisten: ${firma.asistentes.join(", ")}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {firma.nota && <p className="text-xs">{firma.nota}</p>}
                    </div>
                    {!firma.firmadaEn && editable && (
                      <form action={confirmarFirma}>
                        <input type="hidden" name="negocioId" value={negocio.id} />
                        <input type="hidden" name="firmaId" value={firma.id} />
                        <BotonAccion variante="secundario">Marcar firmada</BotonAccion>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {editable && (
              <form action={agendarFirma} className="grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="negocioId" value={negocio.id} />
                <select name="parte" className={CAMPO} defaultValue="comprador">
                  <option value="comprador">Comprador</option>
                  <option value="vendedor">Vendedor</option>
                  <option value="banco">Banco</option>
                </select>
                <input type="datetime-local" name="agendadaPara" className={CAMPO} />
                <input name="notaria" placeholder="Notaría" className={CAMPO} />
                <input name="direccionNotaria" placeholder="Dirección" className={CAMPO} />
                <input
                  name="asistentes"
                  placeholder="Quiénes asisten, separados por coma"
                  className={`${CAMPO} sm:col-span-2`}
                />
                <input name="nota" placeholder="Nota" className={`${CAMPO} sm:col-span-2`} />
                <div className="sm:col-span-2">
                  <BotonAccion>Agendar firma</BotonAccion>
                </div>
              </form>
            )}
          </Tarjeta>
        </div>

        <div className="space-y-4">
          <Tarjeta titulo="Crédito hipotecario">
            {negocio.credito && (
              <dl className="mb-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-[var(--color-tinta-suave)]">Banco</dt>
                  <dd>{negocio.credito.banco}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-tinta-suave)]">Estado</dt>
                  <dd>{ETIQUETA_CREDITO[negocio.credito.estado]}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-tinta-suave)]">Monto</dt>
                  <dd>{negocio.credito.montoUf ? formatearUf(negocio.credito.montoUf) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-tinta-suave)]">Tasación</dt>
                  <dd>{negocio.credito.tasacionUf ? formatearUf(negocio.credito.tasacionUf) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-tinta-suave)]">Tasa / plazo</dt>
                  <dd>
                    {negocio.credito.tasaAnual ? `${negocio.credito.tasaAnual}%` : "—"}
                    {negocio.credito.plazoAnos ? ` · ${negocio.credito.plazoAnos} años` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-tinta-suave)]">Ejecutivo del banco</dt>
                  <dd className="break-words">{negocio.credito.ejecutivoBanco ?? "—"}</dd>
                </div>
              </dl>
            )}

            {editable && (
              <form action={actualizarCredito} className="space-y-2">
                <input type="hidden" name="negocioId" value={negocio.id} />
                <input
                  name="banco"
                  list="bancos"
                  defaultValue={negocio.credito?.banco ?? ""}
                  placeholder="Banco"
                  className={`${CAMPO} w-full`}
                />
                <datalist id="bancos">
                  {BANCOS.map((banco) => (
                    <option key={banco} value={banco} />
                  ))}
                </datalist>
                <select
                  name="estado"
                  defaultValue={negocio.credito?.estado ?? "por_ingresar"}
                  className={`${CAMPO} w-full`}
                >
                  {(Object.keys(ETIQUETA_CREDITO) as EstadoCredito[]).map((estado) => (
                    <option key={estado} value={estado}>
                      {ETIQUETA_CREDITO[estado]}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    name="montoUf"
                    defaultValue={negocio.credito?.montoUf ?? ""}
                    placeholder="Monto UF"
                    className={CAMPO}
                  />
                  <input
                    name="tasacionUf"
                    defaultValue={negocio.credito?.tasacionUf ?? ""}
                    placeholder="Tasación UF"
                    className={CAMPO}
                  />
                  <input
                    name="tasaAnual"
                    defaultValue={negocio.credito?.tasaAnual ?? ""}
                    placeholder="Tasa %"
                    className={CAMPO}
                  />
                  <input
                    name="plazoAnos"
                    defaultValue={negocio.credito?.plazoAnos ?? ""}
                    placeholder="Plazo años"
                    className={CAMPO}
                  />
                </div>
                <input
                  name="ejecutivoBanco"
                  defaultValue={negocio.credito?.ejecutivoBanco ?? ""}
                  placeholder="Ejecutivo del banco"
                  className={`${CAMPO} w-full`}
                />
                <input
                  name="contactoBanco"
                  defaultValue={negocio.credito?.contactoBanco ?? ""}
                  placeholder="Correo o teléfono"
                  className={`${CAMPO} w-full`}
                />
                <textarea
                  name="reparos"
                  rows={2}
                  defaultValue={negocio.credito?.reparos.join("\n") ?? ""}
                  placeholder="Reparos del estudio de títulos, uno por línea"
                  className={`${CAMPO} w-full`}
                />
                <BotonAccion>Guardar crédito</BotonAccion>
              </form>
            )}
          </Tarjeta>

          <Tarjeta titulo="Conservador de Bienes Raíces">
            {negocio.cbr?.inscritaEn && (
              <p className="mb-2 text-sm">
                Inscrita el {formatearFecha(negocio.cbr.inscritaEn)} · fojas {negocio.cbr.fojas ?? "—"} nº{" "}
                {negocio.cbr.numero ?? "—"} de {negocio.cbr.ano ?? "—"}
              </p>
            )}
            {editable && (
              <form action={registrarCbr} className="space-y-2">
                <input type="hidden" name="negocioId" value={negocio.id} />
                <input
                  name="conservador"
                  defaultValue={negocio.cbr?.conservador ?? ""}
                  placeholder="Conservador"
                  className={`${CAMPO} w-full`}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    name="ingresadaEn"
                    title="Fecha de ingreso"
                    className={CAMPO}
                  />
                  <input
                    name="numeroIngreso"
                    defaultValue={negocio.cbr?.numeroIngreso ?? ""}
                    placeholder="Nº ingreso"
                    className={CAMPO}
                  />
                  <input type="date" name="inscritaEn" title="Fecha de inscripción" className={CAMPO} />
                  <input
                    name="ano"
                    defaultValue={negocio.cbr?.ano ?? ""}
                    placeholder="Año"
                    className={CAMPO}
                  />
                  <input
                    name="fojas"
                    defaultValue={negocio.cbr?.fojas ?? ""}
                    placeholder="Fojas"
                    className={CAMPO}
                  />
                  <input
                    name="numero"
                    defaultValue={negocio.cbr?.numero ?? ""}
                    placeholder="Número"
                    className={CAMPO}
                  />
                </div>
                <textarea
                  name="reparos"
                  rows={2}
                  defaultValue={negocio.cbr?.reparos.join("\n") ?? ""}
                  placeholder="Reparos del Conservador, uno por línea"
                  className={`${CAMPO} w-full`}
                />
                <BotonAccion>Guardar inscripción</BotonAccion>
              </form>
            )}
          </Tarjeta>

          <Tarjeta titulo="Liquidación">
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-[var(--color-tinta-suave)]">Precio</dt>
                <dd className="tabular-nums">{formatearUf(negocio.precioUf)}</dd>
              </div>
              {negocio.descuentoUf > 0 && (
                <div className="flex justify-between">
                  <dt className="text-[var(--color-tinta-suave)]">Descuento</dt>
                  <dd className="tabular-nums">-{formatearUf(negocio.descuentoUf)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-[var(--color-tinta-suave)]">Reserva</dt>
                <dd className="tabular-nums">{formatearClp(negocio.reservaClp)}</dd>
              </div>
              <div className="flex justify-between border-t border-[var(--color-borde)] pt-2">
                <dt className="text-[var(--color-tinta-suave)]">Comisión</dt>
                <dd className="tabular-nums">
                  {negocio.comisionUf ? formatearUf(negocio.comisionUf) : "—"}
                  {negocio.comisionFacturada ? " · facturada" : ""}
                </dd>
              </div>
            </dl>
          </Tarjeta>

          {puede(usuario.rol, "reasignar_cartera") && (
            <Tarjeta titulo="Asignación">
              <form action={reasignarNegocio} className="space-y-2">
                <input type="hidden" name="negocioId" value={negocio.id} />
                <select
                  name="ejecutivoId"
                  defaultValue={negocio.ejecutivoId ?? ""}
                  className={`${CAMPO} w-full`}
                >
                  <option value="">Sin asignar</option>
                  {usuarios
                    .filter((item) => item.activo)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.nombre}
                      </option>
                    ))}
                </select>
                <BotonAccion variante="secundario">Reasignar</BotonAccion>
              </form>
            </Tarjeta>
          )}

          {editable && (
            <Tarjeta titulo="Dar por caído">
              <form action={caerNegocio} className="space-y-2">
                <input type="hidden" name="negocioId" value={negocio.id} />
                <input
                  name="motivo"
                  required
                  placeholder="Motivo (crédito rechazado, se arrepintió…)"
                  className={`${CAMPO} w-full`}
                />
                <BotonAccion variante="secundario">Marcar caído</BotonAccion>
              </form>
            </Tarjeta>
          )}
        </div>
      </div>
    </div>
  );
}
