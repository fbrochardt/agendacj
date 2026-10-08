-- Agenda: esquema inicial
-- Rode este arquivo no SQL Editor do Supabase (ou via `supabase db push`).

create extension if not exists btree_gist with schema extensions;

-- Perfis (um por usuário do Supabase Auth)
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null,
  username text not null unique check (username ~ '^[a-z0-9-]{3,30}$'),
  timezone text not null default 'America/Fortaleza',
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

-- Tipos de evento (ex.: "Reunião de 30 min")
create table public.event_types (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  slug text not null check (slug ~ '^[a-z0-9-]{1,60}$'),
  description text,
  duration_min int not null check (duration_min between 5 and 480),
  buffer_min int not null default 0 check (buffer_min between 0 and 240),
  min_notice_min int not null default 120 check (min_notice_min >= 0),
  window_days int not null default 60 check (window_days between 1 and 365),
  location_type text not null default 'google_meet'
    check (location_type in ('google_meet', 'in_person', 'phone', 'custom')),
  location_value text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, slug)
);

-- Disponibilidade semanal (0 = domingo ... 6 = sábado), no fuso do perfil
create table public.availability (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);
create index availability_user_idx on public.availability (user_id);

-- Agendas conectadas. `secret` guarda as credenciais criptografadas (AES-256-GCM)
create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null check (provider in ('google', 'apple')),
  account text not null,
  secret text not null,
  calendars jsonb not null default '[]'::jsonb,
  destination_calendar text,
  is_destination boolean not null default false,
  last_error text,
  created_at timestamptz not null default now(),
  unique (user_id, provider, account)
);

-- Agendamentos
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  event_type_id uuid references public.event_types (id) on delete set null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  guest_name text not null,
  guest_email text not null,
  guest_timezone text,
  notes text,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  location text,
  meeting_url text,
  external_provider text,
  external_event_id text,
  external_connection_id uuid references public.calendar_connections (id) on delete set null,
  calendar_error text,
  cancel_token text not null,
  created_at timestamptz not null default now(),
  check (end_at > start_at),
  -- Impede dois agendamentos confirmados no mesmo horário para a mesma pessoa,
  -- mesmo que duas reservas cheguem ao mesmo tempo.
  constraint bookings_no_overlap exclude using gist (
    user_id with =,
    tstzrange(start_at, end_at) with &&
  ) where (status = 'confirmed')
);
create index bookings_user_start_idx on public.bookings (user_id, start_at);

-- Segurança (RLS)
-- O navegador só enxerga as linhas do próprio usuário. Páginas públicas, reservas,
-- gestão de equipe e credenciais de agenda passam pelo servidor (chave secreta).
alter table public.profiles enable row level security;
alter table public.event_types enable row level security;
alter table public.availability enable row level security;
alter table public.calendar_connections enable row level security;
alter table public.bookings enable row level security;

create policy "perfil proprio: leitura" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

create policy "tipos de evento proprios" on public.event_types
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "disponibilidade propria" on public.availability
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "agendamentos proprios: leitura" on public.bookings
  for select to authenticated using (user_id = (select auth.uid()));

-- calendar_connections: sem políticas de propósito (somente o servidor acessa).
