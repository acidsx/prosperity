/**
 * Tipos del API de JetBrokers, transcritos de la documentación oficial
 * (Prosperity Latam - API documentation, 12 páginas).
 *
 * Base: https://api.jetbrokers.io
 */

/** Estados del cliente en el CRM. Es el pipeline real de JetBrokers. */
export const ESTADOS_CLIENTE = [
  "new",
  "callAgain",
  "noResponse",
  "furtherOn",
  "scheduled",
  "reschedule",
  "quotationSended",
  "dropped",
  "closing",
  "noQualify",
  "customer",
] as const;
export type EstadoCliente = (typeof ESTADOS_CLIENTE)[number];

export const ETIQUETA_ESTADO: Record<EstadoCliente, string> = {
  new: "Nuevo",
  callAgain: "Volver a llamar",
  noResponse: "Sin respuesta",
  furtherOn: "En seguimiento",
  scheduled: "Visita agendada",
  reschedule: "Reagendar",
  quotationSended: "Cotización enviada",
  dropped: "Descartado",
  closing: "En cierre",
  noQualify: "No califica",
  customer: "Cliente",
};

export const SEXOS = ["male", "female"] as const;
export type Sexo = (typeof SEXOS)[number];

export const ESTADOS_CIVILES = [
  "single",
  "married",
  "divorced",
  "widowed",
  "civilCohabitant",
  "separated",
] as const;
export type EstadoCivil = (typeof ESTADOS_CIVILES)[number];

export const TIPOS_RENTA = ["fixed", "variable", "invoices"] as const;
export type TipoRenta = (typeof TIPOS_RENTA)[number];

/** Etapa comercial del proyecto. */
export const ETAPAS_PROYECTO = ["deliveryReady", "green", "privateSale", "white"] as const;
export type EtapaProyecto = (typeof ETAPAS_PROYECTO)[number];

export const ETIQUETA_ETAPA_PROYECTO: Record<EtapaProyecto, string> = {
  deliveryReady: "Entrega inmediata",
  green: "Venta en verde",
  privateSale: "Venta privada",
  white: "Venta en blanco",
};

/** new = stock nuevo, used = segunda mano. */
export type ModoProyecto = "new" | "used";

/** market = proyectos del marketplace, private = proyectos propios. */
export type AlcanceProyecto = "market" | "private";

/** Beneficios comerciales que JetBrokers acepta como tags de proyecto. */
export const TAGS_PROYECTO = [
  "Bono pie",
  "Bono pie 5",
  "Bono pie 10",
  "Bono pie 15",
  "Arriendo garantizado",
  "Arriendo asegurado",
  "Adm. de propiedad",
  "Apoyo al dividendo",
  "Credito Interno",
  "Arrendatario incluido",
  "Arr. opción compra",
  "Primer arrendatario",
  "Gift Card",
  "Amoblado",
  "UF Congelada",
  "Tasa Congelada",
  "Devolución IVA",
  "Airbnb",
  "Pie cero",
  "Subsidio",
  "DFL2",
  "Gastos comunes",
  "Crédito hipotecario",
  "Locales",
  "Oficinas",
] as const;
export type TagProyecto = (typeof TAGS_PROYECTO)[number];

/**
 * Payload del POST /api/gallery/customer/{organizationId}.
 * Todos los campos salvo fullName son opcionales.
 */
export interface ClienteEntrada {
  fullName: string;
  email?: string;
  mobile?: string;
  /** En la plataforma se conoce como RUT. */
  taxId?: string;
  comments?: string;
  campaign?: string;
  origin?: string;
  marketSegment?: string;
  /** Email de un usuario de la plataforma: el cliente queda asignado a él. */
  assignedTo?: string;
  referredBy?: string;
  /** Formato 'tag1,tag2': sin espacios y sin coma final. */
  tags?: string;
  salary?: number;
  salaryVariable?: number;
  status?: EstadoCliente;
  /** '2024-01-01' | '2024-01-31 23:45' | '2024-01-12T15:30:00Z' */
  dateOfBirth?: string;
  sex?: Sexo;
  civilStatus?: EstadoCivil;
  marriageType?: string;
  profession?: string;
  address?: string;
  comuna?: string;
  region?: string;
  nationality?: string;
  salaryType?: TipoRenta;
  hasPartner?: boolean;
  partnerSalary?: number;
  partnerSalaryVariable?: number;
  partnerSalaryType?: TipoRenta;
  savingsCapacity?: number;
  savingsBalance?: number;
  hasBankAccount?: boolean;
  hasDicom?: boolean;
  mortgageCount?: number;
  mortgageMonthlyPaymentsTotal?: number;
  consumerCreditCount?: number;
  consumerCreditMonthlyPaymentsTotal?: number;
  aimToInvest?: boolean;
  aimToLive?: boolean;
}

/** Largos máximos por campo, según la documentación. */
export const LARGO_MAXIMO: Partial<Record<keyof ClienteEntrada, number>> = {
  fullName: 250,
  email: 250,
  mobile: 250,
  taxId: 250,
  comments: 500,
  campaign: 250,
  origin: 250,
  marketSegment: 250,
  assignedTo: 250,
  referredBy: 250,
  tags: 500,
  profession: 255,
  address: 255,
};

/** Dígitos máximos de los campos numéricos. */
export const DIGITOS_MAXIMOS: Partial<Record<keyof ClienteEntrada, number>> = {
  salary: 8,
  salaryVariable: 8,
  partnerSalary: 8,
  partnerSalaryVariable: 8,
  savingsCapacity: 8,
  savingsBalance: 9,
  mortgageCount: 2,
  mortgageMonthlyPaymentsTotal: 9,
  consumerCreditCount: 2,
  consumerCreditMonthlyPaymentsTotal: 9,
};

/** Tipología de un proyecto (depto tipo A8, etc.). Los precios van en UF. */
export interface ModeloProyecto {
  name: string;
  facing: string | null;
  rooms: number;
  bathrooms: number;
  blueprintId: string | null;
  surfaceTotal: string;
  surfaceInterior: string;
  surfaceTerrace: string;
  surfaceLogia: string;
  surfaceGarden: string;
  discountRateMin: string;
  discountRateMax: string;
  priceBase: number;
  priceFinal: number;
}

export interface ArchivoProyecto {
  id: string;
  type: string;
  mime: string;
  details: string | null;
}

/** Respuesta de GET /api/gallery/details/{org}/{projectId}[/{userId}]. */
export interface ProyectoDetalle {
  name: string;
  slug: string;
  address: string;
  locality: string;
  perks: string[];
  perksNearby: string[];
  perksCommonAreas: string[];
  dateOfDelivery: string | null;
  yearOfDelivery: number | null;
  stage: EtapaProyecto | null;
  description: string | null;
  gpsLat: string | null;
  gpsLon: string | null;
  allowTransfer: string | null;
  buildingPermit: string | null;
  buildingPermitNumber: string | null;
  coverId: string | null;
  developerName: string | null;
  developerCoverId: string | null;
  parkingFrom: string | null;
  parkingTo: string | null;
  storeFrom: string | null;
  storeTo: string | null;
  apartmentFrom: number | null;
  apartmentTo: number | null;
  brokerName: string | null;
  brokerEmail: string | null;
  brokerPhone: string | null;
  brokerAvatarId: string | null;
  organizationName: string | null;
  organizationLogoId: string | null;
  organizationEmail: string | null;
  organizationPhone: string | null;
  organizationAddress: string | null;
  organizationDescription: string | null;
  organizationWeb: string | null;
  organizationPrimaryColor: string | null;
  buildingCompany: string | null;
  models: ModeloProyecto[];
  files: ArchivoProyecto[];
  apartmentCount: number | null;
  storeCount: number | null;
  parkingCount: number | null;
  elevatorsCount: number | null;
  apartmentsByFloor: number | null;
  projectDeveloperSummary: string | null;
  floors: number | null;
  /** Monto de reserva, en pesos. */
  reserveCLP: string | null;
  reserveTarget: string | null;
  /** Comisión del broker, en porcentaje. */
  fee: string | null;
  installmentsPreEntrega: number | null;
  installmentsPostEntrega: number | null;
  payMethodPreEntrega: string | null;
  payMethodPostEntrega: string | null;
  reserveName: string | null;
  reserveTaxId: string | null;
  reserveAccountType: string | null;
  reserveAccountNumber: string | null;
  reserveBank: string | null;
  mode: ModoProyecto | null;
  scope: AlcanceProyecto | null;
  [clave: string]: unknown;
}

/** Elemento del array que devuelve POST /api/gallery/projects. */
export interface ProyectoResumen {
  id: string;
  name: string;
  slug: string;
  cover: string | null;
  locality: string | null;
  developer: string | null;
  dateOfDelivery: string | null;
  yearOfDelivery: number | null;
  /** Monto de reserva en pesos. Ojo: el JSON lo entrega como string. */
  reservaCLP: string | null;
  /** Mejor precio disponible, en UF, como string. */
  bestPrice: string | null;
  stage: EtapaProyecto | null;
  mode: ModoProyecto | null;
  scope: AlcanceProyecto | null;
  tags: string[];
}

/** Filtros del buscador de proyectos. */
export interface BusquedaProyectos {
  name?: string;
  /** LocalityEnum. La documentación entregada no trae la lista de valores. */
  locality?: string;
  dateOfDelivery?: string;
  yearOfDelivery?: number;
  stage?: EtapaProyecto;
  /** Formato '2D1B' = 2 dormitorios, 1 baño. */
  tipology?: string;
  bestPriceFrom?: number;
  bestPriceTo?: number;
  mode?: ModoProyecto;
  scope?: AlcanceProyecto;
  tags?: string[];
}

/** Formato '{dormitorios}D{banos}B' que espera el buscador. */
export function tipologia(dormitorios: number, banos: number): string {
  return `${dormitorios}D${banos}B`;
}
