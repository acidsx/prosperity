/**
 * Negocios de demostración, para poder ver el cierre funcionando sin tener
 * todavía operaciones reales. Solo corre con la tienda en memoria.
 */

import "server-only";

import { esModoDemo } from "@/lib/auth/demo";
import { crearNegocio, cumplirHito, sumarDiasHabiles } from "@/lib/cierre/negocio";
import { tienda } from "@/lib/datos";
import { comisionUf } from "@/lib/dominio/chile";
import type { Negocio } from "@/lib/dominio/cierre";

function hace(dias: number): Date {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - dias);
  return fecha;
}

export async function sembrarNegociosDemo(): Promise<void> {
  if (!esModoDemo()) return;

  const db = tienda();
  const existentes = await db.listarNegocios();
  if (existentes.length > 0) return;

  const [leads, proyectos, usuarios] = await Promise.all([
    db.listarLeads(),
    db.listarProyectos(),
    db.listarUsuarios(),
  ]);
  if (leads.length < 3 || proyectos.length === 0) return;

  const ejecutivos = usuarios.filter((usuario) => usuario.rol === "ejecutivo");
  const ejecutivo = (indice: number) => ejecutivos[indice % Math.max(ejecutivos.length, 1)]?.id ?? null;

  const armar = (
    indiceLead: number,
    indiceProyecto: number,
    diasAtras: number,
    unidad: string,
  ): Negocio => {
    const proyecto = proyectos[indiceProyecto % proyectos.length];
    const precio = proyecto.precioDesdeUf ?? 3000;
    return crearNegocio({
      leadId: leads[indiceLead].id,
      proyectoId: proyecto.id,
      unidad,
      modelo: proyecto.modelos[0]?.name ?? null,
      precioUf: precio,
      reservaClp: proyecto.reservaClp ?? 500_000,
      ejecutivoId: ejecutivo(indiceLead),
      compradores: [
        {
          nombre: leads[indiceLead].nombre,
          rut: leads[indiceLead].rut,
          email: leads[indiceLead].email,
          telefono: leads[indiceLead].telefono,
          estadoCivil: null,
        },
      ],
      vendedor: {
        nombre: proyecto.desarrollador ?? "Inmobiliaria",
        rut: null,
        email: null,
        telefono: null,
        estadoCivil: null,
      },
      comisionUf: proyecto.feePorcentaje
        ? Math.round(precio * (proyecto.feePorcentaje / 100) * 100) / 100
        : comisionUf(precio),
      esCopropiedad: true,
      desde: hace(diasAtras),
    });
  };

  // 1. Recién reservado, todo al día.
  let uno = armar(0, 0, 4, "Depto 802");
  uno = cumplirHito(uno, "reserva_firmada", { fecha: hace(4).toISOString() });

  // 2. En evaluación bancaria, con el banco atrasado y la tasación bajo el precio.
  let dos = armar(1, 1, 40, "Depto 1204");
  dos = cumplirHito(dos, "reserva_firmada", { fecha: hace(40).toISOString() });
  dos = cumplirHito(dos, "credito_ingresado", { fecha: hace(35).toISOString() });
  dos = cumplirHito(dos, "tasacion", { fecha: hace(20).toISOString() });
  dos.credito = {
    banco: "Banco de Chile",
    ejecutivoBanco: "Marcela Núñez",
    contactoBanco: "marcela.nunez@bancochile.cl",
    estado: "en_estudio_titulos",
    montoUf: Math.round(dos.precioUf * 0.8),
    tasaAnual: 4.6,
    plazoAnos: 25,
    // Tasó bajo el precio: al comprador le falta pie.
    tasacionUf: Math.round(dos.precioUf * 0.94),
    reparos: ["Falta alzamiento de hipoteca anterior del vendedor"],
    actualizadaEn: hace(6).toISOString(),
  };

  // 3. En firmas, con un certificado vencido que frena la escritura.
  let tres = armar(2, 2, 80, "Casa 14");
  for (const tipo of [
    "reserva_firmada",
    "credito_ingresado",
    "tasacion",
    "estudio_titulos",
    "credito_aprobado",
    "promesa_firmada",
    "borrador_escritura",
    "firma_comprador",
  ] as const) {
    tres = cumplirHito(tres, tipo, { fecha: hace(70).toISOString() });
  }
  tres.credito = {
    banco: "BCI",
    ejecutivoBanco: "Jorge Pinto",
    contactoBanco: "jpinto@bci.cl",
    estado: "aprobada",
    montoUf: Math.round(tres.precioUf * 0.8),
    tasaAnual: 4.4,
    plazoAnos: 30,
    tasacionUf: Math.round(tres.precioUf * 1.02),
    reparos: [],
    actualizadaEn: hace(30).toISOString(),
  };
  tres.firmas = [
    {
      id: "fir_1",
      parte: "comprador",
      notaria: "Notaría Iván Torrealba",
      direccionNotaria: "Huérfanos 979, Santiago",
      agendadaPara: hace(12).toISOString(),
      firmadaEn: hace(12).toISOString(),
      asistentes: [tres.compradores[0].nombre],
      nota: null,
    },
    {
      id: "fir_2",
      parte: "vendedor",
      notaria: "Notaría Iván Torrealba",
      direccionNotaria: "Huérfanos 979, Santiago",
      agendadaPara: sumarDiasHabiles(new Date(), 2).toISOString(),
      firmadaEn: null,
      asistentes: [tres.vendedor?.nombre ?? "Vendedor"],
      nota: "Confirmar poder del representante legal",
    },
  ];
  // Los certificados del Conservador se pidieron hace 45 días: ya vencieron.
  for (const registro of tres.documentos) {
    if (["dominio_vigente", "hipotecas_gravamenes", "prohibiciones_interdicciones"].includes(registro.documento)) {
      registro.emitidoEn = hace(45).toISOString();
      registro.recibidoEn = hace(44).toISOString();
    }
    if (["recepcion_final", "escritura_anterior"].includes(registro.documento)) {
      registro.emitidoEn = hace(60).toISOString();
      registro.recibidoEn = hace(59).toISOString();
    }
  }

  for (const negocio of [uno, dos, tres]) {
    await db.guardarNegocio(negocio);
  }
}
