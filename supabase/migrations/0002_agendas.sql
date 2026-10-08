-- Agendas internas: criadas pelo admin, cada uma com um dono (ex.: um vendedor).
-- Não dependem de Google Agenda nem da Apple.

create table public.agendas (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  description text,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index agendas_owner_idx on public.agendas (owner_id);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  agenda_id uuid not null references public.agendas (id) on delete cascade,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  client_name text,
  client_phone text,
  client_email text,
  notes text,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_at > start_at),
  -- Dois agendamentos confirmados não podem se sobrepor na mesma agenda.
  constraint appointments_no_overlap exclude using gist (
    agenda_id with =,
    tstzrange(start_at, end_at) with &&
  ) where (status = 'confirmed')
);
create index appointments_agenda_start_idx on public.appointments (agenda_id, start_at);

alter table public.agendas enable row level security;
alter table public.appointments enable row level security;

-- O dono enxerga as próprias agendas. Criar, editar e agendar é feito pelo
-- servidor, depois de conferir que quem pediu é administrador.
create policy "agendas do dono: leitura" on public.agendas
  for select to authenticated using (owner_id = (select auth.uid()));

create policy "agendamentos das agendas do dono: leitura" on public.appointments
  for select to authenticated using (
    exists (
      select 1 from public.agendas a
      where a.id = appointments.agenda_id and a.owner_id = (select auth.uid())
    )
  );

grant select on public.agendas, public.appointments to authenticated;
grant all on public.agendas, public.appointments to service_role;
