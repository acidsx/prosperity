import Link from "next/link";

import { Tarjeta, Vacio } from "@/componentes/ui";
import { exigirUsuario, leadsVisibles } from "@/lib/auth/acceso";
import { tienda } from "@/lib/datos";
import { formatearFecha } from "@/lib/dominio/chile";
import { POLITICA_POR_DEFECTO } from "@/lib/mensajeria/politica";
import { PLANTILLAS, validarCatalogo } from "@/lib/mensajeria/plantillas";
import { bandejaSimulada } from "@/lib/mensajeria/simulado";

export const dynamic = "force-dynamic";

export default async function Mensajeria() {
  const usuario = await exigirUsuario("/mensajeria");
  const db = tienda();
  const [todos, todasLasSolicitudes] = await Promise.all([
    db.listarLeads(),
    db.listarSolicitudes(),
  ]);

  const leads = leadsVisibles(usuario, todos);
  const suyos = new Set(leads.map((lead) => lead.id));
  const solicitudes = todasLasSolicitudes.filter((solicitud) => suyos.has(solicitud.leadId));

  const bandeja = bandejaSimulada();
  const problemas = validarCatalogo();
  const bajas = leads.filter((lead) => lead.optOut);
  const escalados = leads.filter((lead) => lead.enManosDeHumano);

  const whatsappConectado = Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  const correoConectado = Boolean(process.env.RESEND_API_KEY && process.env.CORREO_REMITENTE);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Mensajería</h1>
        <p className="mt-1 text-sm text-[var(--color-tinta-suave)]">
          WhatsApp{" "}
          {whatsappConectado
            ? process.env.WHATSAPP_ENVIO === "true"
              ? "conectado y enviando"
              : "conectado en simulación"
            : "sin configurar"}{" "}
          · Correo{" "}
          {correoConectado
            ? process.env.CORREO_ENVIO === "true"
              ? "conectado y enviando"
              : "conectado en simulación"
            : "sin configurar"}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Tarjeta
            titulo="Bandeja simulada"
            accion={
              <span className="text-xs text-[var(--color-tinta-suave)]">
                {bandeja.length} mensajes que habrían salido
              </span>
            }
          >
            {bandeja.length === 0 ? (
              <Vacio mensaje="Nada pendiente. Los mensajes aparecen acá mientras no haya credenciales." />
            ) : (
              <ul className="space-y-2">
                {bandeja.slice(0, 25).map((envio) => (
                  <li key={envio.id} className="rounded-md border border-[var(--color-borde)] p-3 text-sm">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-tinta-suave)]">
                      <span>
                        {envio.canal} → {envio.para}
                        {envio.salida.tipo === "plantilla" ? ` · plantilla ${envio.salida.plantilla}` : ""}
                      </span>
                      <span>
                        <Link href={`/leads/${envio.leadId}`} className="hover:underline">
                          ver lead
                        </Link>{" "}
                        · {formatearFecha(envio.creadoEn)}
                      </span>
                    </div>
                    {envio.salida.tipo === "correo" && (
                      <p className="mb-1 font-medium">{envio.salida.asunto}</p>
                    )}
                    <p className="whitespace-pre-wrap">
                      {envio.salida.tipo === "texto"
                        ? envio.salida.cuerpo
                        : envio.salida.tipo === "plantilla"
                          ? envio.salida.vistaPrevia
                          : envio.salida.texto}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>

          <Tarjeta
            titulo="Plantillas para aprobación de Meta"
            accion={
              <span
                className={`text-xs ${problemas.length === 0 ? "text-green-700" : "text-rose-700"}`}
              >
                {problemas.length === 0
                  ? "todas pasan las reglas de formato"
                  : `${problemas.length} problema(s)`}
              </span>
            }
          >
            <p className="mb-3 text-xs text-[var(--color-tinta-suave)]">
              Fuera de las 24 horas desde el último mensaje del comprador, WhatsApp solo acepta
              plantillas aprobadas. Estas son las que hay que dar de alta en el WhatsApp Manager.
            </p>
            {problemas.length > 0 && (
              <ul className="mb-3 list-disc rounded-md bg-rose-50 p-3 pl-7 text-xs text-rose-900">
                {problemas.map((problema, indice) => (
                  <li key={indice}>
                    {problema.plantilla}: {problema.problema}
                  </li>
                ))}
              </ul>
            )}
            <ul className="space-y-3">
              {PLANTILLAS.map((item) => (
                <li key={item.nombre} className="rounded-md border border-[var(--color-borde)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="text-sm font-medium">{item.nombre}</code>
                    <span className="rounded-full bg-[var(--color-lienzo)] px-2 py-0.5 text-xs">
                      {item.categoria} · {item.idioma}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{item.cuerpo}</p>
                  <p className="mt-1 text-xs text-[var(--color-tinta-suave)]">
                    {item.variables.length > 0
                      ? item.variables.map((variable, indice) => `{{${indice + 1}}} ${variable}`).join(" · ")
                      : "sin variables"}
                  </p>
                  {item.botones && (
                    <p className="mt-1 text-xs text-[var(--color-tinta-suave)]">
                      Botones: {item.botones.map((boton) => boton.texto).join(" / ")}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-[var(--color-tinta-suave)]">{item.proposito}</p>
                </li>
              ))}
            </ul>
          </Tarjeta>
        </div>

        <div className="space-y-4">
          <Tarjeta titulo="Frenos activos">
            <ul className="space-y-2 text-sm">
              <li>
                Horario de contacto: {POLITICA_POR_DEFECTO.horaInicio}:00 a{" "}
                {POLITICA_POR_DEFECTO.horaFin}:00, hora de Chile
              </li>
              <li>Máximo {POLITICA_POR_DEFECTO.maxPorDia} mensajes automáticos por lead al día</li>
              <li>
                Se detiene después de {POLITICA_POR_DEFECTO.maxSinRespuesta} mensajes sin respuesta
              </li>
              <li>Mínimo {POLITICA_POR_DEFECTO.minutosEntreMensajes} minutos entre mensajes</li>
              <li>Escala a una persona ante precio, reclamo o si piden hablar con alguien</li>
            </ul>
          </Tarjeta>

          <Tarjeta titulo="Bajas y escalamientos">
            {bajas.length === 0 && escalados.length === 0 ? (
              <Vacio mensaje="Sin bajas ni escalamientos." />
            ) : (
              <div className="space-y-3 text-sm">
                {escalados.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[var(--color-tinta-suave)]">
                      En manos de una persona ({escalados.length})
                    </p>
                    <ul className="mt-1 space-y-1">
                      {escalados.map((lead) => (
                        <li key={lead.id}>
                          <Link href={`/leads/${lead.id}`} className="hover:underline">
                            {lead.nombre}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {bajas.length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[var(--color-tinta-suave)]">
                      Pidieron la baja ({bajas.length})
                    </p>
                    <ul className="mt-1 space-y-1">
                      {bajas.map((lead) => (
                        <li key={lead.id}>
                          <Link href={`/leads/${lead.id}`} className="hover:underline">
                            {lead.nombre}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Tarjeta>

          <Tarjeta titulo="Documentos">
            {solicitudes.length === 0 ? (
              <Vacio mensaje="Sin solicitudes de documentos." />
            ) : (
              <ul className="space-y-2 text-sm">
                {solicitudes.map((solicitud) => {
                  const recibidos = solicitud.documentos.filter((pedido) => pedido.recibidoEn).length;
                  return (
                    <li key={solicitud.id} className="flex items-center justify-between gap-2">
                      <Link href={`/leads/${solicitud.leadId}`} className="hover:underline">
                        {leads.find((lead) => lead.id === solicitud.leadId)?.nombre ?? solicitud.leadId}
                      </Link>
                      <span className="text-xs tabular-nums text-[var(--color-tinta-suave)]">
                        {recibidos}/{solicitud.documentos.length} · {solicitud.estado}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Tarjeta>
        </div>
      </div>
    </div>
  );
}
