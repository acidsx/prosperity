-- Mensajería y solicitudes de documentos.

-- Conciliación de estados y descarte de webhooks repetidos.
alter table mensajes
  add column if not exists id_proveedor text generated always as (datos ->> 'idProveedor') stored;

create unique index if not exists mensajes_id_proveedor_idx
  on mensajes (id_proveedor)
  where id_proveedor is not null;

alter table mensajes
  add column if not exists estado text generated always as (datos ->> 'estado') stored;

-- Ventana de 24 h de WhatsApp y opt-out.
alter table leads
  add column if not exists ultimo_entrante_en timestamptz
    generated always as ((datos ->> 'ultimoEntranteEn')::timestamptz) stored;

alter table leads
  add column if not exists opt_out boolean
    generated always as ((datos ->> 'optOut')::boolean) stored;

create table if not exists solicitudes_documentos (
  id text primary key,
  lead_id text not null references leads (id) on delete cascade,
  datos jsonb not null,
  -- Token del alias de respuesta: 'documentos+<token>@dominio'.
  token text generated always as (datos ->> 'token') stored,
  estado text generated always as (datos ->> 'estado') stored,
  -- Plazo de conservación informado al comprador.
  eliminar_despues_de timestamptz
    generated always as ((datos ->> 'eliminarDespuesDe')::timestamptz) stored,
  solicitada_en timestamptz not null default now()
);

create unique index if not exists solicitudes_token_idx on solicitudes_documentos (token);
create index if not exists solicitudes_eliminar_idx on solicitudes_documentos (eliminar_despues_de);

alter table solicitudes_documentos enable row level security;
