/**
 * Diagnóstico de la conexión con JetBrokers.
 *
 * Está pensado para correrse desde la red de la corredora, que es donde el
 * API es alcanzable. Prueba los endpoints en modo lectura, contrasta lo que
 * llega contra los tipos del proyecto y descubre los valores de enum que la
 * documentación entregada no trae.
 *
 *   npm run jetbrokers -- diagnostico
 *   npm run jetbrokers -- proyecto cpmoqN5r
 *   npm run jetbrokers -- payload            (muestra el POST sin enviarlo)
 */

import { ErrorJetBrokers, JetBrokers } from "../src/lib/jetbrokers/cliente";
import { conDetalle, desdeResumen } from "../src/lib/jetbrokers/mapeo";
import type { ProyectoResumen } from "../src/lib/jetbrokers/tipos";
import { validarCliente } from "../src/lib/jetbrokers/validacion";

const ok = (texto: string) => console.log(`[ok]    ${texto}`);
const falla = (texto: string) => console.log(`[falla] ${texto}`);
const aviso = (texto: string) => console.log(`[aviso] ${texto}`);
const nota = (texto: string) => console.log(`        ${texto}`);

function cliente(): JetBrokers {
  const organizationId = process.env.JETBROKERS_ORG_ID;
  if (!organizationId) {
    console.error("Falta JETBROKERS_ORG_ID. Ponlo en .env.local o pásalo en la línea de comandos.");
    process.exit(1);
  }
  return new JetBrokers({
    organizationId,
    baseUrl: process.env.JETBROKERS_BASE_URL,
    // El diagnóstico nunca escribe, pase lo que pase en el entorno.
    permitirEscritura: false,
    timeoutMs: 20000,
  });
}

/** Campos que llegaron y no están en nuestros tipos, y al revés. */
function compararCampos(
  recibido: Record<string, unknown>,
  esperados: string[],
): { sobran: string[]; faltan: string[] } {
  const llegaron = Object.keys(recibido);
  return {
    sobran: llegaron.filter((campo) => !esperados.includes(campo)),
    faltan: esperados.filter((campo) => !llegaron.includes(campo)),
  };
}

const CAMPOS_RESUMEN: string[] = [
  "id",
  "name",
  "slug",
  "cover",
  "locality",
  "developer",
  "dateOfDelivery",
  "yearOfDelivery",
  "reservaCLP",
  "bestPrice",
  "stage",
  "mode",
  "scope",
  "tags",
];

// Todo lo que el proyecto sí modela del detalle: lo que aparezca fuera de
// esta lista es un campo nuevo del API que conviene revisar.
const CAMPOS_DETALLE: string[] = [
  "name", "slug", "address", "locality", "perks", "perksNearby", "perksCommonAreas",
  "dateOfDelivery", "yearOfDelivery", "stage", "description", "gpsLat", "gpsLon",
  "allowTransfer", "buildingPermit", "buildingPermitNumber", "coverId", "developerName",
  "developerCoverId", "parkingFrom", "parkingTo", "storeFrom", "storeTo", "apartmentFrom",
  "apartmentTo", "brokerName", "brokerEmail", "brokerPhone", "brokerAvatarId",
  "organizationName", "organizationLogoId", "organizationEmail", "organizationPhone",
  "organizationAddress", "organizationDescription", "organizationWeb",
  "organizationPrimaryColor", "buildingCompany", "models", "files", "apartmentCount",
  "storeCount", "parkingCount", "elevatorsCount", "apartmentsByFloor",
  "projectDeveloperSummary", "floors", "reserveCLP", "reserveTarget", "fee",
  "installmentsPreEntrega", "installmentsPostEntrega", "payMethodPreEntrega",
  "payMethodPostEntrega", "reserveName", "reserveTaxId", "reserveAccountType",
  "reserveAccountNumber", "reserveBank", "mode", "scope", "orgBackgroundBannerJbId",
  "orgBackgroundBannerJsId", "jetGalleryTop", "jetGalleryBottom",
];

async function diagnostico() {
  const api = cliente();
  console.log(`Organización: ${api.organizationId}`);
  console.log(`Base: ${process.env.JETBROKERS_BASE_URL ?? "https://api.jetbrokers.io"}\n`);

  // 1. Buscador de proyectos.
  let resumenes: ProyectoResumen[] = [];
  try {
    resumenes = await api.buscarProyectos();
    ok(`Project Search API: ${resumenes.length} proyectos`);
  } catch (error) {
    falla(`Project Search API: ${mensaje(error)}`);
    if (error instanceof ErrorJetBrokers && error.estado === 404) {
      nota("Un 404 suele significar organizationId equivocado.");
    }
    nota("Sin el buscador no hay inventario: el resto del diagnóstico no aplica.");
    return;
  }

  if (resumenes.length === 0) {
    aviso("El buscador respondió vacío. ¿La organización tiene proyectos publicados?");
    return;
  }

  const comparacion = compararCampos(
    resumenes[0] as unknown as Record<string, unknown>,
    CAMPOS_RESUMEN,
  );
  if (comparacion.sobran.length > 0) {
    aviso(`El resumen trae campos que no modelamos: ${comparacion.sobran.join(", ")}`);
  }
  if (comparacion.faltan.length > 0) {
    aviso(`El resumen no trae: ${comparacion.faltan.join(", ")}`);
  }

  // 2. Detalle de proyecto.
  const primero = resumenes[0];
  try {
    const detalle = await api.detalleProyecto(primero.id);
    ok(`Project API: detalle de "${detalle.name}" con ${detalle.models?.length ?? 0} tipologías`);

    const dif = compararCampos(detalle as unknown as Record<string, unknown>, CAMPOS_DETALLE);
    if (dif.sobran.length > 0) nota(`Campos extra en el detalle: ${dif.sobran.slice(0, 12).join(", ")}`);
    if (dif.faltan.length > 0) aviso(`El detalle no trae: ${dif.faltan.join(", ")}`);

    const proyecto = conDetalle(desdeResumen(primero), detalle);
    nota(
      `Normalizado: ${proyecto.comuna} · UF ${proyecto.precioDesdeUf ?? "?"} – ${proyecto.precioHastaUf ?? "?"} · comisión ${proyecto.feePorcentaje ?? "?"}%`,
    );
    if (proyecto.precioDesdeUf === null) {
      aviso("No se pudo leer el precio: revisa apartmentFrom/apartmentTo y los models.");
    }

    // 3. Archivos.
    const archivo = detalle.files?.[0];
    if (archivo) {
      try {
        const descarga = await api.descargarArchivo(archivo.id);
        ok(`File API: ${archivo.type} (${descarga.mime}, ${descarga.contenido.byteLength} bytes)`);
      } catch (error) {
        falla(`File API: ${mensaje(error)}`);
      }
    } else {
      nota("El proyecto no tiene archivos para probar el File API.");
    }
  } catch (error) {
    falla(`Project API: ${mensaje(error)}`);
  }

  // 4. Video de sala de reuniones.
  try {
    const video = await api.videoSalaReuniones();
    if (video) ok(`Sala de reuniones: ${video}`);
    else nota("Sala de reuniones: sin video configurado.");
  } catch (error) {
    aviso(`Sala de reuniones: ${mensaje(error)}`);
  }

  // 5. Valores de enum que la documentación no trae.
  console.log("\nValores encontrados en los datos reales:");
  const recolectar = (extraer: (proyecto: ProyectoResumen) => unknown) =>
    [...new Set(resumenes.map(extraer).filter((valor) => valor !== null && valor !== undefined))];

  console.log(`  locality (LocalityEnum): ${recolectar((p) => p.locality).join(", ") || "—"}`);
  console.log(`  stage: ${recolectar((p) => p.stage).join(", ") || "—"}`);
  console.log(`  mode: ${recolectar((p) => p.mode).join(", ") || "—"}`);
  console.log(`  scope: ${recolectar((p) => p.scope).join(", ") || "—"}`);
  console.log(`  tags: ${[...new Set(resumenes.flatMap((p) => p.tags ?? []))].join(", ") || "—"}`);
  nota("Estas listas son las que la documentación entregada dejó en blanco.");

  // 6. Filtros del buscador.
  console.log("\nFiltros del buscador:");
  const comuna = resumenes.find((p) => p.locality)?.locality;
  if (comuna) {
    try {
      const filtrados = await api.buscarProyectos({ locality: comuna });
      const correcto = filtrados.every((p) => p.locality === comuna);
      if (correcto && filtrados.length > 0) ok(`locality="${comuna}" devolvió ${filtrados.length}`);
      else aviso(`locality="${comuna}" devolvió ${filtrados.length}, y no todos calzan`);
    } catch (error) {
      falla(`Filtro locality: ${mensaje(error)}`);
    }
  }

  try {
    const baratos = await api.buscarProyectos({ bestPriceTo: 3000 });
    const respetado = baratos.every((p) => Number(p.bestPrice) <= 3000);
    if (respetado) ok(`bestPriceTo=3000 devolvió ${baratos.length}, todos dentro del tope`);
    else aviso("bestPriceTo devolvió proyectos sobre el tope: el filtro no se aplica como esperamos");
  } catch (error) {
    falla(`Filtro bestPriceTo: ${mensaje(error)}`);
  }

  console.log("\nEl POST de clientes no se probó: crearía un registro en el CRM.");
  console.log('Usa "npm run jetbrokers -- payload" para ver qué se enviaría.');
}

async function proyecto(id: string) {
  const api = cliente();
  const detalle = await api.detalleProyecto(id);
  console.log(JSON.stringify(detalle, null, 2));
}

/** Muestra el payload exacto del Customer API, ya saneado, sin enviarlo. */
function payload() {
  const ejemplo = validarCliente({
    fullName: "Camila Fuentes",
    email: "camila@gmail.com",
    mobile: "+56912345678",
    taxId: "12.345.678-5",
    comments:
      "Consulta desde Portal Inmobiliario. Calificación 84/100 (caliente). Presupuesto estimado UF 3.399.",
    origin: "portal_inmobiliario",
    marketSegment: "caliente",
    status: "scheduled",
    tags: "preaprobado,primera-vivienda",
    salary: 2_400_000,
    savingsBalance: 28_000_000,
    hasDicom: false,
    aimToLive: true,
    comuna: "Ñuñoa",
  });

  console.log("POST /api/gallery/customer/{organizationId}");
  console.log("Content-Type: application/json\n");
  console.log(JSON.stringify(ejemplo.payload, null, 2));
  if (ejemplo.avisos.length > 0) {
    console.log("\nAvisos del saneamiento:");
    for (const texto of ejemplo.avisos) console.log(`  - ${texto}`);
  }
  console.log(
    "\nLos montos van como número, no como texto: la API descarta en silencio los tipos incorrectos.",
  );
}

function mensaje(error: unknown): string {
  if (error instanceof ErrorJetBrokers) {
    return `${error.message}${error.cuerpo ? ` — ${error.cuerpo.slice(0, 200)}` : ""}`;
  }
  return error instanceof Error ? error.message : String(error);
}

const [comando, argumento] = process.argv.slice(2);

const tareas: Record<string, () => Promise<void> | void> = {
  diagnostico,
  proyecto: () => {
    if (!argumento) {
      console.error("Uso: npm run jetbrokers -- proyecto <projectId>");
      process.exit(1);
    }
    return proyecto(argumento);
  },
  payload,
};

const tarea = tareas[comando ?? ""];
if (!tarea) {
  console.error("Comandos: diagnostico | proyecto <id> | payload");
  process.exit(1);
}

Promise.resolve(tarea()).catch((error) => {
  console.error(mensaje(error));
  process.exit(1);
});
