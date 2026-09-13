/**
 * Afirmaciones que el agente no puede hacer, con la norma que lo impide.
 *
 * Un prompt comercial bien escrito puede pedirle al modelo que diga cosas
 * falsas sin que nadie lo note: suenan bien, son específicas y vienen con
 * un número. La única defensa es una lista explícita, citada y verificable,
 * que corra sobre la salida.
 *
 * Cada entrada nació de una afirmación real encontrada en un prompt de
 * ventas. No son hipótesis.
 */

export type GravedadAfirmacion = "critica" | "alta" | "media";

export interface AfirmacionProhibida {
  id: string;
  /** Cómo aparece en un mensaje. */
  patron: RegExp;
  /** Qué se está afirmando. */
  afirmacion: string;
  /** Por qué es falso o inadmisible. */
  porQue: string;
  /** La norma, el organismo o el cálculo que lo desmiente. */
  norma: string;
  fuente: string;
  gravedad: GravedadAfirmacion;
  /** Qué sí se puede decir en su lugar. */
  enSuLugar: string;
  /**
   * Patrón que exonera.
   *
   * Varias de estas afirmaciones son ciertas cuando van con su límite dicho.
   * "El arriendo queda libre de impuesto" es falso a secas y correcto si
   * aparece el tope de dos viviendas. Sin esta salida, el verificador
   * castigaría justamente la versión bien dicha.
   */
  salvoQue?: RegExp;
}

export const AFIRMACIONES_PROHIBIDAS: AfirmacionProhibida[] = [
  {
    id: "mutuaria_no_se_informa",
    patron:
      /(no se informa|no queda registrad|no aparece)[^.]{0,60}(cmf|sistema financiero|deuda)|mantienes? intacta tu capacidad crediticia|deuda invisible|no te (aparece|figura) en el banco/i,
    afirmacion:
      "Que un crédito tomado con una mutuaria no se informa al sistema financiero y deja intacta la capacidad crediticia en el banco.",
    porQue:
      "Era una zona gris hasta 2026 y dejó de serlo. La Ley 21.680 creó el Registro de Deuda Consolidada (REDEC), que entró en vigencia el 1 de abril de 2026 y obliga a mutuarias, cooperativas, cajas, retail y fintech a informar las deudas en tiempo real. Inducir a alguien a endeudarse creyendo que su deuda es invisible es empujarlo a una evaluación bancaria que va a fallar, y a declarar mal su posición.",
    norma: "Ley 21.680, Registro de Deuda Consolidada (CMF), vigente desde el 01-04-2026",
    fuente: "https://www.cmfchile.cl/portal/prensa/625/articles-70386_doc_pdf.pdf",
    gravedad: "critica",
    enSuLugar:
      "Una mutuaria puede tener condiciones distintas a un banco y conviene cotizar ambas, pero desde abril de 2026 la deuda se informa igual y el banco la va a ver.",
  },
  {
    id: "dfl2_arriendo_sin_impuesto",
    patron:
      /(dfl\s?2|dfl-2)[^.]{0,120}(libre|exent|sin)[^.]{0,40}(impuesto|renta)|ingresos por arriendo (estar[áa]n |quedan )?(libres|exentos)/i,
    afirmacion:
      "Que por ser DFL2, todos los ingresos por arriendo quedan libres de impuesto a la renta.",
    porQue:
      "El beneficio existe pero tiene un límite que cambia el negocio de un inversionista: las rentas de arrendamiento no constituyen renta solo para personas naturales y solo por un máximo de dos viviendas DFL2. De la tercera en adelante el arriendo tributa. A quien está armando una cartera de cuatro unidades, decirle que todas quedan exentas le cambia el flujo proyectado.",
    norma: "DFL 2 de 1959, con el límite de 2 viviendas por persona natural vigente tras la reforma de 2016",
    fuente: "https://www.circuloverde.cl/se-pierden-todos-los-beneficios-del-dfl-2-cuando-se-tienen-mas-de-dos-viviendas-acogidas-a-dicha-norma/",
    gravedad: "critica",
    enSuLugar:
      "Si la unidad es DFL2, las dos primeras viviendas acogidas tienen el arriendo libre de impuesto a la renta; de la tercera en adelante tributa. Lo confirma el equipo tributario con su caso.",
    salvoQue:
      /dos primeras|m[áa]ximo de dos|hasta dos viviendas|de la tercera en adelante|solo (en |por )?(las )?dos/i,
  },
  {
    id: "devolucion_directa_impuestos",
    patron:
      /devoluci[óo]n de impuestos directa|directa a tu bolsillo|te (devuelven|devuelve el estado)[^.]{0,30}impuesto|el estado te (est[áa] )?subsidia[^.]{0,40}dividendo/i,
    afirmacion:
      "Que comprar propiedad nueva da una devolución de impuestos directa al bolsillo, equivalente a casi dos dividendos al año.",
    porQue:
      "El beneficio del artículo 55 bis no es una devolución: es una rebaja de la base imponible por los intereses del crédito hipotecario, con tope de 8 UTA. Lo que la persona recibe es esa rebaja multiplicada por su tasa marginal, que para una renta de clase media es una fracción pequeña. Además hay tramos: sobre 150 UTA de renta anual no hay beneficio, y exige un máximo de dos viviendas.",
    norma: "Artículo 55 bis de la Ley de la Renta. Tope 8 UTA, por tramos de renta, máximo 2 viviendas",
    fuente: "https://www.sii.cl/pagina/renta/beneficiostributarios.htm",
    gravedad: "alta",
    enSuLugar:
      "Los intereses del crédito hipotecario se pueden rebajar de la base imponible con tope de 8 UTA, según tramo de renta. El ahorro real depende de su tasa marginal y lo calcula el equipo tributario.",
  },
  {
    id: "banco_obligado_a_financiar",
    patron:
      /bancos? est[áa]n obligad|el banco (te )?tiene que (financiar|prestar)|te financian obligatoriamente/i,
    afirmacion: "Que con una garantía estatal los bancos están obligados a financiar.",
    porQue:
      "FOGAES es una garantía que habilita al banco a llegar hasta el 90%, no una obligación de hacerlo. El banco evalúa igual, y los cupos del fondo tienen tope. Prometer que están obligados convierte un rechazo normal en una promesa incumplida de la corredora.",
    norma: "FOGAES, Ley 21.640: garantía estatal, no mandato de otorgamiento",
    fuente: "https://fogaes.cl/sitio/requisitos/",
    gravedad: "alta",
    enSuLugar:
      "Con FOGAES el banco puede financiar hasta el 90% si el comprador califica y queda cupo del fondo. La decisión sigue siendo del banco.",
    salvoQue: /puede financiar|si calificas|si el comprador califica|queda cupo/i,
  },
  {
    id: "urgencia_fabricada",
    patron:
      /te (va a |ir[áa] a )?costar[áa]? millones|costarte millones|posponer[^.]{0,40}(millones|much[íi]simo)|si no (decides|firmas) (hoy|ahora)|ma[ñn]ana ya no|[úu]ltima oportunidad/i,
    afirmacion: "Presión por urgencia: que postergar la decisión le costará millones.",
    porQue:
      "Los plazos reales se dicen con su fecha y su fuente, y eso ya es suficiente urgencia. Convertirlos en una amenaza difusa es presión sobre alguien que está tomando la decisión financiera más grande de su vida, y es lo que hace que un negocio se caiga en la firma.",
    norma: "Ley 19.496 del consumidor: la información debe ser veraz y oportuna, sin inducir a error",
    fuente: "https://www.bcn.cl/leychile/navegar?idNorma=61438",
    gravedad: "media",
    enSuLugar:
      "FOGAES rige hasta el 30-06-2027 y sus cupos tienen tope: esa es la urgencia real y se dice con la fecha.",
  },
  {
    id: "vacancia_inventada",
    patron: /vacancia (casi |pr[áa]cticamente )?(cero|nula|inexistente)|nunca se desocupa|siempre arrendado/i,
    afirmacion: "Que el sector tiene vacancia cero o casi cero.",
    porQue:
      "La vacancia de un sector es un dato de mercado que hay que tener con fuente y fecha de corte. El sistema no la tiene: sus cálculos asumen un mes vacío al año como supuesto declarado, no como medición. Decir 'vacancia casi cero' es inventar el dato que más pesa en la rentabilidad de un arriendo.",
    norma: "Supuesto del modelo: VACANCIA_ANUAL = 1 mes al año, declarado como supuesto, no medido",
    fuente: "src/lib/dominio/inversion.ts",
    gravedad: "alta",
    enSuLugar:
      "El cálculo asume un mes de vacancia al año. La vacancia real del sector se la pido al área de estudios y se la mando con fuente y fecha.",
    salvoQue: /supuesto|no como medici[óo]n|no la tengo con respaldo/i,
  },
  {
    id: "cash_on_cash_inventado",
    patron: /cash on cash[^.]{0,40}(sobre|superior|de)\s?\d|capital inmovilizado (es )?casi cero/i,
    afirmacion: "Cifras de retorno sobre capital que no salen de ningún cálculo del sistema.",
    porQue:
      "El retorno sobre capital invertido depende del precio, del pie efectivo, del arriendo de mercado y de los costos del dueño. El sistema los calcula y da rentabilidad neta en torno a 2,4% con flujo mensual negativo. Una cifra de dos dígitos dicha al aire no es optimismo, es otra magnitud.",
    norma: "Cálculo propio: economiaUnidad y planificarCartera, sobre el inventario vigente",
    fuente: "src/lib/dominio/inversion.ts",
    gravedad: "critica",
    enSuLugar:
      "La rentabilidad neta calculada para esta unidad, con vacancia, administración, contribuciones y mantención descontadas, y el flujo mensual real.",
  },
];

export interface AfirmacionDetectada {
  afirmacion: AfirmacionProhibida;
  /** El fragmento del mensaje que la gatilló. */
  fragmento: string;
}

/** Revisa un mensaje contra la lista. */
export function afirmacionesProhibidasEn(texto: string): AfirmacionDetectada[] {
  const detectadas: AfirmacionDetectada[] = [];
  for (const afirmacion of AFIRMACIONES_PROHIBIDAS) {
    const coincidencia = texto.match(afirmacion.patron);
    if (!coincidencia) continue;
    // Dicha con su límite, la afirmación deja de ser falsa.
    if (afirmacion.salvoQue?.test(texto)) continue;
    detectadas.push({ afirmacion, fragmento: coincidencia[0].trim() });
  }
  return detectadas;
}
