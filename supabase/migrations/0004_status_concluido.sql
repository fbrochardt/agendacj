-- Status "Concluído" nos agendamentos das agendas da equipe e aviso para quem agendou.

alter table public.appointments drop constraint appointments_status_check;
alter table public.appointments
  add constraint appointments_status_check check (status in ('confirmed', 'completed', 'cancelled'));

-- Agendamento concluído continua ocupando o horário; só o cancelado libera.
alter table public.appointments drop constraint appointments_no_overlap;
alter table public.appointments
  add constraint appointments_no_overlap exclude using gist (
    agenda_id with =,
    tstzrange(start_at, end_at) with &&
  ) where (status in ('confirmed', 'completed'));

-- Quem concluiu/cancelou, quando, e se quem agendou já viu o aviso.
alter table public.appointments
  add column status_changed_by uuid references public.profiles (id) on delete set null,
  add column status_changed_at timestamptz,
  add column creator_seen_at timestamptz;

create index appointments_created_by_idx on public.appointments (created_by)
  where status in ('completed', 'cancelled') and creator_seen_at is null;
