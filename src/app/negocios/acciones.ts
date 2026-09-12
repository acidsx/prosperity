"use server";

import { revalidatePath } from "next/cache";

import { exigirUsuario, puedeVerNegocio } from "@/lib/auth/acceso";
import { puede } from "@/lib/auth/tipos";
import { crearNegocio, cumplirHito, marcarCaido } from "@/lib/cierre/negocio";
import { tienda } from "@/lib/datos";
import { nuevoId } from "@/lib/datos/tienda";
import { comisionUf } from "@/lib/dominio/chile";
import type { EstadoCredito, Negocio, TipoHito } from "@/lib/dominio/cierre";
import type { DocumentoPropiedadId } from "@/lib/documentos/propiedad";

function refrescar(negocioId?: string) {
  revalidatePath("/negocios");
  revalidatePath("/control");
  revalidatePath("/");
  if (negocioId) revalidatePath(`/negocios/${negocioId}`);
}

/** Carga el negocio comprobando que el usuario tenga acceso. */
async function negocioAutorizado(id: string): Promise<Negocio> {
  const usuario = await exigirUsuario();
  if (!puede(usuario.rol, "editar_cierre")) {
    throw new Error("Tu rol no permite editar el cierre");
  }
  const negocio = await tienda().obtenerNegocio(id);
  if (!negocio) throw new Error("El negocio no existe");
  if (!puedeVerNegocio(usuario, negocio)) {
    throw new Error("Este negocio no es de tu cartera");
  }
  return negocio;
}

export async function abrirNegocio(formData: FormData): Promise<void> {
  const usuario = await exigirUsuario();
  const db = tienda();

  const leadId = String(formData.get("leadId") ?? "");
  const lead = await db.obtenerLead(leadId);
  if (!lead) throw new Error("El lead no existe");

  const existente = await db.negocioDeLead(leadId);
  if (existente) {
    refrescar(existente.id);
    return;
  }

  const oportunidad = await db.oportunidadDeLead(leadId);
  const proyectoId = oportunidad?.proyectoId ?? lead.proyectoIdInteres;
  const proyecto = proyectoId ? await db.obtenerProyecto(proyectoId) : null;
  const precioUf = oportunidad?.valorUf ?? proyecto?.precioDesdeUf ?? 0;

  const negocio = crearNegocio({
    id: nuevoId("neg"),
    leadId,
    proyectoId,
    modelo: oportunidad?.modelo ?? null,
    unidad: String(formData.get("unidad") ?? "").trim() || null,
    precioUf,
    reservaClp: proyecto?.reservaClp ?? 0,
    // Si el lead no tiene dueño, queda a nombre de quien lo abre.
    ejecutivoId: lead.ejecutivoId ?? usuario.id,
    compradores: [
      {
        nombre: lead.nombre,
        rut: lead.rut,
        email: lead.email,
        telefono: lead.telefono,
        estadoCivil: null,
      },
    ],
    vendedor: proyecto?.desarrollador
      ? { nombre: proyecto.desarrollador, rut: null, email: null, telefono: null, estadoCivil: null }
      : null,
    comisionUf: proyecto?.feePorcentaje
      ? Math.round(precioUf * (proyecto.feePorcentaje / 100) * 100) / 100
      : comisionUf(precioUf),
  });

  await db.guardarNegocio(negocio);
  if (!lead.ejecutivoId) await db.actualizarLead(leadId, { ejecutivoId: usuario.id });

  await db.registrarActividad({
    id: nuevoId("act"),
    leadId,
    tipo: "estado_cambiado",
    detalle: `Se abrió el cierre ${negocio.id}`,
    autor: "humano",
    ocurridaEn: new Date().toISOString(),
  });

  refrescar(negocio.id);
}

export async function marcarHito(formData: FormData): Promise<void> {
  const id = String(formData.get("negocioId") ?? "");
  const tipo = String(formData.get("hito") ?? "") as TipoHito;
  const negocio = await negocioAutorizado(id);

  const actualizado = cumplirHito(negocio, tipo, {
    nota: String(formData.get("nota") ?? "").trim() || undefined,
  });
  await tienda().guardarNegocio(actualizado);

  await tienda().registrarActividad({
    id: nuevoId("act"),
    leadId: negocio.leadId,
    tipo: "estado_cambiado",
    detalle: `Hito cumplido: ${tipo}. Etapa: ${actualizado.etapa}`,
    autor: "humano",
    ocurridaEn: new Date().toISOString(),
  });

  refrescar(id);
}

export async function actualizarCredito(formData: FormData): Promise<void> {
  const id = String(formData.get("negocioId") ?? "");
  const negocio = await negocioAutorizado(id);

  const numero = (clave: string): number | null => {
    const valor = Number(String(formData.get(clave) ?? "").replace(",", "."));
    return Number.isFinite(valor) && valor > 0 ? valor : null;
  };

  const reparos = String(formData.get("reparos") ?? "")
    .split("\n")
    .map((linea) => linea.trim())
    .filter(Boolean);

  const actualizado: Negocio = {
    ...negocio,
    credito: {
      banco: String(formData.get("banco") ?? "").trim(),
      ejecutivoBanco: String(formData.get("ejecutivoBanco") ?? "").trim() || null,
      contactoBanco: String(formData.get("contactoBanco") ?? "").trim() || null,
      estado: (String(formData.get("estado") ?? "ingresada") as EstadoCredito) || "ingresada",
      montoUf: numero("montoUf"),
      tasaAnual: numero("tasaAnual"),
      plazoAnos: numero("plazoAnos"),
      tasacionUf: numero("tasacionUf"),
      reparos,
      actualizadaEn: new Date().toISOString(),
    },
    actualizadoEn: new Date().toISOString(),
  };

  await tienda().guardarNegocio(actualizado);
  refrescar(id);
}

export async function agendarFirma(formData: FormData): Promise<void> {
  const id = String(formData.get("negocioId") ?? "");
  const negocio = await negocioAutorizado(id);

  const fecha = String(formData.get("agendadaPara") ?? "").trim();
  const actualizado: Negocio = {
    ...negocio,
    firmas: [
      ...negocio.firmas,
      {
        id: nuevoId("fir"),
        parte: (String(formData.get("parte") ?? "comprador") as "comprador" | "vendedor" | "banco"),
        notaria: String(formData.get("notaria") ?? "").trim() || null,
        direccionNotaria: String(formData.get("direccionNotaria") ?? "").trim() || null,
        // El input datetime-local entrega hora local del navegador.
        agendadaPara: fecha ? new Date(fecha).toISOString() : null,
        firmadaEn: null,
        asistentes: String(formData.get("asistentes") ?? "")
          .split(",")
          .map((nombre) => nombre.trim())
          .filter(Boolean),
        nota: String(formData.get("nota") ?? "").trim() || null,
      },
    ],
    actualizadoEn: new Date().toISOString(),
  };

  await tienda().guardarNegocio(actualizado);
  refrescar(id);
}

export async function confirmarFirma(formData: FormData): Promise<void> {
  const id = String(formData.get("negocioId") ?? "");
  const firmaId = String(formData.get("firmaId") ?? "");
  const negocio = await negocioAutorizado(id);

  const firmas = negocio.firmas.map((firma) =>
    firma.id === firmaId ? { ...firma, firmadaEn: new Date().toISOString() } : firma,
  );

  let actualizado: Negocio = { ...negocio, firmas, actualizadoEn: new Date().toISOString() };

  // La firma de cada parte cumple su hito correspondiente.
  const firmada = firmas.find((firma) => firma.id === firmaId);
  if (firmada) {
    const hitoPorParte = {
      comprador: "firma_comprador",
      vendedor: "firma_vendedor",
      banco: "firma_banco",
    } as const;
    actualizado = cumplirHito(actualizado, hitoPorParte[firmada.parte]);
  }

  await tienda().guardarNegocio(actualizado);
  refrescar(id);
}

export async function registrarCbr(formData: FormData): Promise<void> {
  const id = String(formData.get("negocioId") ?? "");
  const negocio = await negocioAutorizado(id);

  const inscritaEn = String(formData.get("inscritaEn") ?? "").trim();
  const actualizado: Negocio = {
    ...negocio,
    cbr: {
      conservador: String(formData.get("conservador") ?? "").trim() || null,
      ingresadaEn: String(formData.get("ingresadaEn") ?? "").trim() || negocio.cbr?.ingresadaEn || null,
      numeroIngreso: String(formData.get("numeroIngreso") ?? "").trim() || null,
      inscritaEn: inscritaEn || null,
      fojas: String(formData.get("fojas") ?? "").trim() || null,
      numero: String(formData.get("numero") ?? "").trim() || null,
      ano: Number(formData.get("ano")) || null,
      reparos: String(formData.get("reparos") ?? "")
        .split("\n")
        .map((linea) => linea.trim())
        .filter(Boolean),
    },
    actualizadoEn: new Date().toISOString(),
  };

  await tienda().guardarNegocio(
    inscritaEn ? cumplirHito(actualizado, "inscripcion_cbr", { fecha: inscritaEn }) : actualizado,
  );
  refrescar(id);
}

export async function registrarDocumento(formData: FormData): Promise<void> {
  const id = String(formData.get("negocioId") ?? "");
  const documento = String(formData.get("documento") ?? "") as DocumentoPropiedadId;
  const negocio = await negocioAutorizado(id);

  const emitidoEn = String(formData.get("emitidoEn") ?? "").trim();
  const documentos = negocio.documentos.map((registro) =>
    registro.documento === documento
      ? {
          ...registro,
          // La vigencia se cuenta desde la emisión, no desde que lo recibimos.
          emitidoEn: emitidoEn ? new Date(emitidoEn).toISOString() : new Date().toISOString(),
          recibidoEn: new Date().toISOString(),
          archivo: {
            nombre: String(formData.get("nombreArchivo") ?? "").trim() || "documento",
            mime: "application/pdf",
            referencia: String(formData.get("referencia") ?? "").trim() || "carga manual",
          },
          nota: String(formData.get("nota") ?? "").trim() || null,
        }
      : registro,
  );

  await tienda().guardarNegocio({
    ...negocio,
    documentos,
    actualizadoEn: new Date().toISOString(),
  });
  refrescar(id);
}

export async function caerNegocio(formData: FormData): Promise<void> {
  const id = String(formData.get("negocioId") ?? "");
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (!motivo) throw new Error("Hay que registrar por qué se cayó");

  const negocio = await negocioAutorizado(id);
  await tienda().guardarNegocio(marcarCaido(negocio, motivo));

  await tienda().registrarActividad({
    id: nuevoId("act"),
    leadId: negocio.leadId,
    tipo: "estado_cambiado",
    detalle: `Negocio caído: ${motivo}`,
    autor: "humano",
    ocurridaEn: new Date().toISOString(),
  });

  refrescar(id);
}

export async function reasignarNegocio(formData: FormData): Promise<void> {
  const usuario = await exigirUsuario();
  if (!puede(usuario.rol, "reasignar_cartera")) {
    throw new Error("Tu rol no permite reasignar cartera");
  }

  const id = String(formData.get("negocioId") ?? "");
  const ejecutivoId = String(formData.get("ejecutivoId") ?? "").trim() || null;

  const db = tienda();
  const negocio = await db.obtenerNegocio(id);
  if (!negocio) throw new Error("El negocio no existe");

  await db.guardarNegocio({ ...negocio, ejecutivoId, actualizadoEn: new Date().toISOString() });
  await db.actualizarLead(negocio.leadId, { ejecutivoId });
  refrescar(id);
}
