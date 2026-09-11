import "server-only";

import { tiendaMemoria } from "@/lib/datos/memoria";
import { tiendaSupabase } from "@/lib/datos/supabase";
import type { Tienda } from "@/lib/datos/tienda";

let elegida: Tienda | null = null;

/** Supabase si está configurado; si no, la tienda en memoria. */
export function tienda(): Tienda {
  if (!elegida) elegida = tiendaSupabase() ?? tiendaMemoria;
  return elegida;
}
