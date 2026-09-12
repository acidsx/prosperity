-- Huella del último payload enviado a JetBrokers.
--
-- Sirve para no gastar uno de los diez envíos por hora reenviando algo
-- idéntico a lo que el CRM ya tiene.
alter table oportunidades
  add column if not exists huella_sincronizacion text
    generated always as (datos ->> 'huellaSincronizacion') stored;

-- Para que el reintento de pendientes no recorra toda la tabla.
create index if not exists oportunidades_sincronizacion_idx
  on oportunidades (sincronizacion)
  where sincronizacion in ('pendiente', 'error');
