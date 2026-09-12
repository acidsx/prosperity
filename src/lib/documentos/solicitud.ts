/**
 * Solicitud de documentos por correo y registro de lo que llega.
 *
 * Del contenido de los archivos no se guarda nada: quedan en el proveedor de
 * correo y acá solo se anota qué documento llegó, cuándo y con qué nombre.
 * Tampoco se copian al CRM, porque el campo de comentarios de JetBrokers es
 * visible para toda la organización.
 */

import "server-only";

import { randomBytes } from "node:crypto";

import { tienda } from "@/lib/datos";
import { nuevoId } from "@/lib/datos/tienda";
import { documentosPara, documento, type Documento } from "@/lib/documentos/catalogo";
import { formatearFecha } from "@/lib/dominio/chile";
import type {
  AdjuntoEntrante,
} from "@/lib/mensajeria/tipos";
import type {
  DocumentoId,
  Lead,
  SolicitudDocumentos,
} from "@/lib/dominio/tipos";

/** Días que se conservan los documentos. Va informado en el correo. */
export const DIAS_RETENCION = Number(process.env.DOCUMENTOS_DIAS_RETENCION ?? 180);

export const CONTACTO_DATOS = process.env.CONTACTO_PROTECCION_DATOS ?? "datos@corredora.cl";
export const NOMBRE_CORREDORA = process.env.NOMBRE_CORREDORA ?? "la corredora";

export function crearSolicitud(lead: Lead): SolicitudDocumentos {
  const independiente = lead.perfil.tipoRenta === "invoices";
  const compraEnPareja = lead.perfil.tienePareja === true;
  const requeridos = documentosPara({ independiente, compraEnPareja });

  const ahora = new Date();
  const eliminar = new Date(ahora);
  eliminar.setDate(eliminar.getDate() + DIAS_RETENCION);

  return {
    id: nuevoId("sol"),
    leadId: lead.id,
    // Token del alias de respuesta: permite calzar la vuelta aunque el
    // comprador responda desde otra casilla.
    token: randomBytes(9).toString("base64url"),
    solicitadaEn: ahora.toISOString(),
    documentos: requeridos.map((item) => ({
      documento: item.id,
      recibidoEn: null,
      archivo: null,
    })),
    estado: "pendiente",
    recordatorios: 0,
    eliminarDespuesDe: eliminar.toISOString(),
  };
}

export interface CorreoSolicitud {
  asunto: string;
  html: string;
  texto: string;
}

/**
 * Arma el correo. Dice para qué se pide cada documento, quién lo recibe y
 * hasta cuándo se guarda: eso es lo que exige informar la Ley 21.719 y es
 * también lo que hace que el comprador efectivamente los mande.
 */
export function correoSolicitud(
  lead: Lead,
  solicitud: SolicitudDocumentos,
  opciones: { firma: string; proyecto?: string },
): CorreoSolicitud {
  const items = solicitud.documentos
    .map((pedido) => documento(pedido.documento))
    .filter((item): item is Documento => item !== undefined);

  const pendientes = items.filter(
    (item) =>
      solicitud.documentos.find((pedido) => pedido.documento === item.id)?.recibidoEn === null,
  );

  const primerNombre = lead.nombre.split(" ")[0];
  const asunto = opciones.proyecto
    ? `Documentos para tu preaprobación — ${opciones.proyecto}`
    : "Documentos para tu preaprobación hipotecaria";

  const lineas = pendientes.map(
    (item, indice) =>
      `${indice + 1}. ${item.nombre}${item.obligatorio ? "" : " (opcional)"}\n   Para qué: ${item.motivo}\n   Cómo conseguirlo: ${item.comoObtenerlo}`,
  );

  const avisoDatos = [
    `Estos documentos los usamos solo para gestionar tu preaprobación hipotecaria y presentarla a los bancos con los que trabajamos. No los compartimos con nadie más.`,
    `Los conservamos hasta el ${formatearFecha(solicitud.eliminarDespuesDe)} y después se eliminan.`,
    `Puedes pedir en cualquier momento acceder a tus datos, corregirlos o eliminarlos escribiendo a ${CONTACTO_DATOS}.`,
  ];

  const texto = [
    `Hola ${primerNombre},`,
    ``,
    `Para avanzar con tu preaprobación, el banco necesita estos documentos:`,
    ``,
    ...lineas,
    ``,
    `Puedes responder este mismo correo con los archivos adjuntos. No hace falta que vengan todos juntos: los vamos registrando a medida que llegan.`,
    ``,
    `Sobre tus datos:`,
    ...avisoDatos.map((linea) => `- ${linea}`),
    ``,
    `Cualquier duda, respóndeme por acá.`,
    ``,
    `Saludos,`,
    opciones.firma,
    NOMBRE_CORREDORA,
  ].join("\n");

  const html = `<!doctype html>
<html lang="es-CL"><body style="margin:0;padding:24px;background:#f6f7f9;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#101418;line-height:1.5">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e3e7ec;border-radius:8px;padding:24px">
    <p>Hola ${escapar(primerNombre)},</p>
    <p>Para avanzar con tu preaprobación, el banco necesita estos documentos:</p>
    <ol style="padding-left:20px">
      ${pendientes
        .map(
          (item) => `<li style="margin-bottom:14px">
        <strong>${escapar(item.nombre)}</strong>${item.obligatorio ? "" : ' <span style="color:#5b6672">(opcional)</span>'}
        <div style="color:#5b6672;font-size:14px;margin-top:2px">Para qué: ${escapar(item.motivo)}</div>
        <div style="color:#5b6672;font-size:14px">Cómo conseguirlo: ${escapar(item.comoObtenerlo)}</div>
      </li>`,
        )
        .join("\n      ")}
    </ol>
    <p>Puedes <strong>responder este mismo correo</strong> con los archivos adjuntos. No hace falta que vengan todos juntos: los vamos registrando a medida que llegan.</p>
    <div style="margin-top:24px;padding:16px;background:#f6f7f9;border-radius:6px;font-size:13px;color:#5b6672">
      <strong style="color:#101418">Sobre tus datos</strong>
      <ul style="padding-left:18px;margin:8px 0 0">
        ${avisoDatos.map((linea) => `<li style="margin-bottom:4px">${escapar(linea)}</li>`).join("\n        ")}
      </ul>
    </div>
    <p style="margin-top:24px">Cualquier duda, respóndeme por acá.</p>
    <p style="margin-bottom:0">Saludos,<br>${escapar(opciones.firma)}<br><span style="color:#5b6672">${escapar(NOMBRE_CORREDORA)}</span></p>
  </div>
</body></html>`;

  return { asunto, html, texto };
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface RecepcionDocumentos {
  solicitud: SolicitudDocumentos;
  /** Documentos identificados y marcados como recibidos. */
  reconocidos: DocumentoId[];
  /** Adjuntos que no se pudieron clasificar: los revisa una persona. */
  sinClasificar: AdjuntoEntrante[];
  faltantes: DocumentoId[];
}

/**
 * Registra los adjuntos de una respuesta. Solo metadatos: nombre, tipo y las
 * referencias para descargarlo después desde el proveedor.
 */
export function registrarRecepcion(
  solicitud: SolicitudDocumentos,
  adjuntos: AdjuntoEntrante[],
  emailId: string,
  clasificar: (nombre: string | null, mime: string) => DocumentoId | null,
): RecepcionDocumentos {
  const actualizada: SolicitudDocumentos = structuredClone(solicitud);
  const reconocidos: DocumentoId[] = [];
  const sinClasificar: AdjuntoEntrante[] = [];
  const ahora = new Date().toISOString();

  for (const adjunto of adjuntos) {
    const id = clasificar(adjunto.nombre, adjunto.mime);
    const pedido = id ? actualizada.documentos.find((item) => item.documento === id) : undefined;

    if (!pedido) {
      sinClasificar.push(adjunto);
      continue;
    }

    pedido.recibidoEn = ahora;
    pedido.archivo = {
      nombre: adjunto.nombre ?? "sin nombre",
      mime: adjunto.mime,
      idCorreo: emailId,
      idAdjunto: adjunto.idAdjunto,
    };
    if (!reconocidos.includes(pedido.documento)) reconocidos.push(pedido.documento);
  }

  const obligatorios = actualizada.documentos.filter(
    (pedido) => documento(pedido.documento)?.obligatorio ?? false,
  );
  const faltantes = obligatorios
    .filter((pedido) => pedido.recibidoEn === null)
    .map((pedido) => pedido.documento);

  const algunoRecibido = actualizada.documentos.some((pedido) => pedido.recibidoEn !== null);
  actualizada.estado = faltantes.length === 0 ? "completa" : algunoRecibido ? "parcial" : "pendiente";

  return { solicitud: actualizada, reconocidos, sinClasificar, faltantes };
}

export function nombresDe(ids: DocumentoId[]): string {
  return ids
    .map((id) => documento(id)?.nombre ?? id)
    .join(", ")
    .toLowerCase();
}

/** Guarda la solicitud y deja la traza en la bitácora. */
export async function persistirSolicitud(
  solicitud: SolicitudDocumentos,
  detalle: string,
  tipo: "documentos_solicitados" | "documentos_recibidos",
): Promise<void> {
  const db = tienda();
  await db.guardarSolicitud(solicitud);
  await db.registrarActividad({
    id: nuevoId("act"),
    leadId: solicitud.leadId,
    tipo,
    detalle,
    autor: "agente",
    ocurridaEn: new Date().toISOString(),
  });
}
