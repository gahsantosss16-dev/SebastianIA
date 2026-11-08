-- Server-only storage; this schema is not exposed through the Data API.
create schema if not exists sebastian;
revoke all on schema sebastian from public, anon, authenticated;

create table if not exists sebastian.memory_records (
  namespace text not null check (length(btrim(namespace)) > 0),
  record_key text not null check (length(btrim(record_key)) > 0),
  value_json text not null check (jsonb_typeof(value_json::jsonb) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (namespace, record_key)
);

-- The primary key already indexes namespace + record_key.
alter table sebastian.memory_records enable row level security;
revoke all on sebastian.memory_records from public, anon, authenticated;

-- Grant this non-login role to a dedicated server login through secure provisioning.
-- No password, superuser privilege or Data API access is created by this migration.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'sebastian_runtime') then
    create role sebastian_runtime nologin;
  end if;
end
$$;
grant usage on schema sebastian to sebastian_runtime, service_role;
grant select, insert, update on sebastian.memory_records to sebastian_runtime, service_role;
create policy sebastian_runtime_records on sebastian.memory_records
  for all to sebastian_runtime using (true) with check (true);
