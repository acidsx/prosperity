-- CRM: usuarios con rol y negocios en cierre.

create table if not exists usuarios (
  id text primary key,
  datos jsonb not null,
  email text generated always as (lower(datos ->> 'email')) stored,
  rol text generated always as (datos ->> 'rol') stored,
  activo boolean generated always as ((datos ->> 'activo')::boolean) stored,
  creado_en timestamptz not null default now()
);

create unique index if not exists usuarios_email_idx on usuarios (email);

-- Dueño de la cartera.
alter table leads
  add column if not exists ejecutivo_id text generated always as (datos ->> 'ejecutivoId') stored;

create index if not exists leads_ejecutivo_idx on leads (ejecutivo_id);

create table if not exists negocios (
  id text primary key,
  lead_id text not null references leads (id) on delete cascade,
  datos jsonb not null,
  etapa text generated always as (datos ->> 'etapa') stored,
  ejecutivo_id text generated always as (datos ->> 'ejecutivoId') stored,
  proyecto_id text generated always as (datos ->> 'proyectoId') stored,
  precio_uf numeric generated always as ((datos ->> 'precioUf')::numeric) stored,
  comision_uf numeric generated always as ((datos ->> 'comisionUf')::numeric) stored,
  actualizado_en timestamptz not null default now()
);

create index if not exists negocios_etapa_idx on negocios (etapa);
create index if not exists negocios_ejecutivo_idx on negocios (ejecutivo_id);
create unique index if not exists negocios_lead_idx on negocios (lead_id);

alter table usuarios enable row level security;
alter table negocios enable row level security;

-- El hash de la clave vive en `datos`. Ninguna política debe exponer esta
-- tabla a claves públicas: el acceso es solo con la service role key desde
-- el servidor.
