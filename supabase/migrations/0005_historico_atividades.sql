-- Histórico de atividades dos agendamentos das agendas da equipe (para a aba Relatórios).

create table public.appointment_events (
  id bigint generated always as identity primary key,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  agenda_id uuid not null references public.agendas (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null
    check (action in ('created', 'updated', 'rescheduled', 'completed', 'reopened', 'cancelled')),
  details jsonb,
  created_at timestamptz not null default now()
);
create index appointment_events_created_idx on public.appointment_events (created_at desc);
create index appointment_events_agenda_idx on public.appointment_events (agenda_id, created_at desc);
create index appointment_events_actor_idx on public.appointment_events (actor_id, created_at desc);

-- Só o servidor (chave secreta) lê e grava.
alter table public.appointment_events enable row level security;
grant all on public.appointment_events to service_role;

-- Preenche com o que já se sabe dos agendamentos existentes.
insert into public.appointment_events (appointment_id, agenda_id, actor_id, action, created_at)
select id, agenda_id, created_by, 'created', created_at from public.appointments;

insert into public.appointment_events (appointment_id, agenda_id, actor_id, action, created_at)
select id, agenda_id, status_changed_by, status, coalesce(status_changed_at, created_at)
from public.appointments
where status in ('completed', 'cancelled');
