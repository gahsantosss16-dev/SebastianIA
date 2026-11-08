-- Private schema: no table is exposed through Supabase Data API.
create schema if not exists sebastian;
revoke all on schema sebastian from public, anon, authenticated;

create table if not exists sebastian.memory_records (
  namespace text not null check (length(btrim(namespace)) > 0),
  record_key text not null check (length(btrim(record_key)) > 0),
  value_json text not null check (length(btrim(value_json)) > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (namespace, record_key)
);

create index if not exists memory_records_namespace_key_idx
  on sebastian.memory_records (namespace, record_key);

revoke all on sebastian.memory_records from public, anon, authenticated;
grant usage on schema sebastian to service_role;
grant select, insert, update, delete on sebastian.memory_records to service_role;
