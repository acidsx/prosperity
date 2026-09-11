-- Esquema del gestor inmobiliario.
--
-- Cada tabla guarda el objeto completo en `datos` (jsonb) y expone como
-- columnas generadas los campos por los que se filtra. Así hay un solo
-- camino de escritura y las consultas siguen siendo SQL normal.

create table if not exists proyectos (
  id text primary key,
  datos jsonb not null,
  comuna text generated always as (datos ->> 'comuna') stored,
  etapa text generated always as (datos ->> 'etapa') stored,
  modo text generated always as (datos ->> 'modo') stored,
  precio_desde_uf numeric generated always as ((datos ->> 'precioDesdeUf')::numeric) stored,
  actualizado_en timestamptz not null default now()
);

create index if not exists proyectos_comuna_idx on proyectos (comuna);
create index if not exists proyectos_precio_idx on proyectos (precio_desde_uf);

create table if not exists leads (
  id text primary key,
  datos jsonb not null,
  email text generated always as (datos ->> 'email') stored,
  telefono text generated always as (datos ->> 'telefono') stored,
  canal text generated always as (datos ->> 'canal') stored,
  creado_en timestamptz not null default now()
);

create index if not exists leads_email_idx on leads (email);
create index if not exists leads_creado_idx on leads (creado_en desc);

create table if not exists oportunidades (
  id text primary key,
  lead_id text not null references leads (id) on delete cascade,
  datos jsonb not null,
  -- Mismos valores que el campo `status` del Customer API de JetBrokers.
  estado text generated always as (datos ->> 'estado') stored,
  puntaje int generated always as ((datos -> 'calificacion' ->> 'puntaje')::int) stored,
  sincronizacion text generated always as (datos ->> 'sincronizacion') stored,
  actualizada_en timestamptz not null default now()
);

create index if not exists oportunidades_estado_idx on oportunidades (estado);
create index if not exists oportunidades_lead_idx on oportunidades (lead_id);

create table if not exists visitas (
  id text primary key,
  lead_id text not null references leads (id) on delete cascade,
  datos jsonb not null,
  inicio timestamptz generated always as ((datos ->> 'inicio')::timestamptz) stored,
  estado text generated always as (datos ->> 'estado') stored
);

create index if not exists visitas_inicio_idx on visitas (inicio);

create table if not exists mensajes (
  id text primary key,
  lead_id text not null references leads (id) on delete cascade,
  datos jsonb not null,
  direccion text generated always as (datos ->> 'direccion') stored,
  enviado_en timestamptz generated always as ((datos ->> 'enviadoEn')::timestamptz) stored
);

create index if not exists mensajes_lead_idx on mensajes (lead_id, enviado_en);

create table if not exists actividades (
  id text primary key,
  lead_id text references leads (id) on delete cascade,
  datos jsonb not null,
  tipo text generated always as (datos ->> 'tipo') stored,
  ocurrida_en timestamptz generated always as ((datos ->> 'ocurridaEn')::timestamptz) stored
);

create index if not exists actividades_ocurrida_idx on actividades (ocurrida_en desc);

-- El gestor corre del lado del servidor con la service role key. RLS queda
-- activo para que ninguna clave pública pueda leer el pipeline.
alter table proyectos enable row level security;
alter table leads enable row level security;
alter table oportunidades enable row level security;
alter table visitas enable row level security;
alter table mensajes enable row level security;
alter table actividades enable row level security;
