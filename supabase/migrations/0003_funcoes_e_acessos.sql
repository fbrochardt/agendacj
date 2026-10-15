-- Função de cada pessoa (Vendedor ou SDR) e atribuição de agendas a usuários.
-- O nível de acesso continua em profiles.role: 'admin' (Administrador) ou 'member' (Usuário).

alter table public.profiles
  add column job text check (job in ('vendedor', 'sdr'));

-- Quem, além do dono, pode acessar cada agenda. Só administradores atribuem.
create table public.agenda_members (
  agenda_id uuid not null references public.agendas (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (agenda_id, user_id)
);
create index agenda_members_user_idx on public.agenda_members (user_id);

alter table public.agenda_members enable row level security;

create policy "atribuicoes proprias: leitura" on public.agenda_members
  for select to authenticated using (user_id = (select auth.uid()));

-- Leitura de agendas e agendamentos: dono ou pessoa atribuída.
drop policy "agendas do dono: leitura" on public.agendas;
create policy "agendas do dono ou atribuidas: leitura" on public.agendas
  for select to authenticated using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.agenda_members m
      where m.agenda_id = agendas.id and m.user_id = (select auth.uid())
    )
  );

drop policy "agendamentos das agendas do dono: leitura" on public.appointments;
create policy "agendamentos de agendas acessiveis: leitura" on public.appointments
  for select to authenticated using (
    exists (
      select 1 from public.agendas a
      where a.id = appointments.agenda_id
        and (
          a.owner_id = (select auth.uid())
          or exists (
            select 1 from public.agenda_members m
            where m.agenda_id = a.id and m.user_id = (select auth.uid())
          )
        )
    )
  );

grant select on public.agenda_members to authenticated;
grant all on public.agenda_members to service_role;
