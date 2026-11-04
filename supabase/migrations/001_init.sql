-- 001_init.sql
-- Core schema for Deal Ledger: deals, deal_events, contacts.
-- Rules come from ASSUMPTIONS.md. Plain SQL, runs top to bottom in the
-- Supabase SQL editor. RLS is on with no policies: anon and authenticated
-- get no rows until 002 adds policies. service_role (ingest) bypasses RLS.

begin;

-- ---------------------------------------------------------------------------
-- Stage enum (ASSUMPTIONS.md section 1), in funnel order.
-- ---------------------------------------------------------------------------
create type public.deal_stage as enum (
  'sourcing',
  'in_pipeline',
  'pre_loi',
  'negotiating_loi',
  'negotiating_psa',
  'in_contract',
  'closed',
  'on_hold',
  'unknown'
);

-- ---------------------------------------------------------------------------
-- deals: one row per client-tab source row.
-- Typed columns are the fields every client tab has (plus state, see
-- ASSUMPTIONS.md section 5). Everything else, and the raw text of any
-- number that wasn't clean, lives in attributes.
-- ---------------------------------------------------------------------------
create table public.deals (
  id                     uuid primary key default gen_random_uuid(),
  client                 text not null,                 -- Client name
  vertical               text not null,                 -- from tab prefix
  market                 text,                          -- Metro (search market)
  address                text,
  city                   text,
  state                  text,                          -- null for food tab
  bldg_sf                numeric,
  list_price             numeric,
  list_price_per_sf      numeric,
  lot_sf                 numeric,
  list_price_per_lot_sf  numeric,
  stage                  public.deal_stage not null default 'unknown',
  stage_raw              text,                          -- original Status, unchanged
  stage_changed_at       timestamptz,                   -- no default: source has no stage dates
  notes_raw              text,
  attributes             jsonb not null default '{}'::jsonb
                           check (jsonb_typeof(attributes) = 'object'),
  assumption_fields      text[] not null default '{}',
  source_tab             text not null,
  source_row             integer not null check (source_row > 0),
  natural_key            text not null unique,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users (id) on delete set null,
  unique (source_tab, source_row)
);

create index deals_stage_idx    on public.deals (stage);
create index deals_vertical_idx on public.deals (vertical);
create index deals_market_idx   on public.deals (market);

-- ---------------------------------------------------------------------------
-- deal_events: field-level change history.
-- ---------------------------------------------------------------------------
create table public.deal_events (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references public.deals (id) on delete cascade,
  field       text not null,
  old_value   jsonb,
  new_value   jsonb,
  changed_by  uuid references auth.users (id) on delete set null,
  changed_at  timestamptz not null default now()
);

create index deal_events_deal_id_changed_at_idx
  on public.deal_events (deal_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- contacts: contact_tracker rows. raw keeps the full original row.
-- ---------------------------------------------------------------------------
create table public.contacts (
  id             uuid primary key default gen_random_uuid(),
  contact_name   text,          -- Contact Name
  title          text,          -- Title
  email          text,          -- Email
  office_phone   text,          -- Office #
  mobile_phone   text,          -- Mobile #
  emailed        boolean,       -- Emailed?
  linkedin_dm    boolean,       -- LinkedIn DM?
  helpful_reply  boolean,       -- Helpful Reply?
  notes_raw      text,          -- Notes
  raw            jsonb not null check (jsonb_typeof(raw) = 'object'),
  source_tab     text not null,
  source_row     integer not null check (source_row > 0),
  created_at     timestamptz not null default now(),
  unique (source_tab, source_row)
);

-- ---------------------------------------------------------------------------
-- Keep deals.updated_at current.
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger deals_set_updated_at
  before update on public.deals
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: enabled, no policies yet (002 adds them).
-- ---------------------------------------------------------------------------
alter table public.deals       enable row level security;
alter table public.deal_events enable row level security;
alter table public.contacts    enable row level security;

-- ---------------------------------------------------------------------------
-- Grants: nothing for anon, select only for authenticated, all for
-- service_role. Revoke from authenticated first in case default
-- privileges granted more.
-- ---------------------------------------------------------------------------
revoke all on table public.deals, public.deal_events, public.contacts
  from anon, authenticated;

grant select on table public.deals, public.deal_events, public.contacts
  to authenticated;

grant all on table public.deals, public.deal_events, public.contacts
  to service_role;

commit;
