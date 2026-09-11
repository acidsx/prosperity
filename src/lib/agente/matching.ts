/**
 * Calce entre lo que busca el comprador y el inventario.
 *
 * Corre antes del modelo: le entrega una lista corta ya filtrada por precio
 * y comuna, en vez de pedirle que revise el catálogo completo.
 */

import type { Proyecto } from "@/lib/dominio/tipos";
import type { ModeloProyecto } from "@/lib/jetbrokers/tipos";

export interface Criterios {
  /** Techo de compra en UF. */
  presupuestoUf: number | null;
  comunas: string[];
  dormitorios: number | null;
  banos: number | null;
  paraInvertir: boolean;
  necesitaSubsidio: boolean;
  /** Urgencia alta: prioriza entrega inmediata. */
  entregaInmediata: boolean;
  /** Proyecto por el que consultó explícitamente. */
  proyectoIdInteres: string | null;
}

export interface Candidato {
  proyecto: Proyecto;
  modelo: ModeloProyecto | null;
  precioUf: number | null;
  puntaje: number;
  motivos: string[];
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Modelo más caro que entra en el presupuesto y calza con la tipología. */
function mejorModelo(proyecto: Proyecto, criterios: Criterios): ModeloProyecto | null {
  const candidatos = proyecto.modelos.filter((modelo) => {
    if (criterios.dormitorios !== null && modelo.rooms !== criterios.dormitorios) return false;
    if (criterios.banos !== null && modelo.bathrooms < criterios.banos) return false;
    if (criterios.presupuestoUf !== null && modelo.priceFinal > criterios.presupuestoUf) return false;
    return true;
  });

  if (candidatos.length === 0) return null;
  return candidatos.reduce((mejor, actual) => (actual.priceFinal > mejor.priceFinal ? actual : mejor));
}

export function buscarCandidatos(
  proyectos: Proyecto[],
  criterios: Criterios,
  limite = 4,
): Candidato[] {
  const comunas = criterios.comunas.map(normalizar);

  const evaluados = proyectos.map<Candidato>((proyecto) => {
    const motivos: string[] = [];
    let puntaje = 0;

    const modelo = mejorModelo(proyecto, criterios);
    const precioUf = modelo?.priceFinal ?? proyecto.precioDesdeUf;

    if (proyecto.id === criterios.proyectoIdInteres) {
      puntaje += 30;
      motivos.push("Es el proyecto por el que consultó");
    }

    if (comunas.includes(normalizar(proyecto.comuna))) {
      puntaje += 25;
      motivos.push(`Está en ${proyecto.comuna}, una de las comunas que busca`);
    }

    if (criterios.presupuestoUf !== null && precioUf !== null) {
      if (precioUf <= criterios.presupuestoUf) {
        // Mientras más cerca del techo, mejor aprovecha su capacidad.
        const aprovechamiento = precioUf / criterios.presupuestoUf;
        puntaje += 20 + Math.round(aprovechamiento * 15);
        motivos.push(`Entra en su presupuesto de UF ${criterios.presupuestoUf}`);
      } else if (precioUf <= criterios.presupuestoUf * 1.1) {
        puntaje += 8;
        motivos.push("Queda apenas sobre su presupuesto: negociable con descuento");
      } else {
        puntaje -= 25;
      }
    }

    if (modelo && criterios.dormitorios !== null) {
      puntaje += 12;
      motivos.push(`Tipología ${modelo.rooms}D${modelo.bathrooms}B disponible`);
    }

    if (criterios.necesitaSubsidio) {
      if (proyecto.tags.includes("Subsidio")) {
        puntaje += 20;
        motivos.push("Acepta subsidio habitacional");
      } else {
        puntaje -= 15;
      }
    }

    if (criterios.paraInvertir) {
      const tagsInversion = proyecto.tags.filter((tag) =>
        ["Arriendo garantizado", "Arriendo asegurado", "Airbnb", "DFL2", "Arrendatario incluido"].includes(tag),
      );
      if (tagsInversion.length > 0) {
        puntaje += 15;
        motivos.push(`Pensado para inversión: ${tagsInversion.join(", ")}`);
      }
    }

    if (criterios.entregaInmediata && proyecto.etapa === "deliveryReady") {
      puntaje += 12;
      motivos.push("Entrega inmediata");
    }

    const ayudasPie = proyecto.tags.filter((tag) => tag.startsWith("Bono pie") || tag === "Pie cero");
    if (ayudasPie.length > 0) {
      puntaje += 6;
      motivos.push(`Beneficio de pie: ${ayudasPie.join(", ")}`);
    }

    return { proyecto, modelo, precioUf, puntaje, motivos };
  });

  return evaluados
    .filter((candidato) => candidato.puntaje > 0)
    .sort((a, b) => b.puntaje - a.puntaje)
    .slice(0, limite);
}
