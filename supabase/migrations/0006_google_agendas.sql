-- Liga cada agenda da equipe a uma agenda do Google e guarda o evento criado por agendamento.

alter table public.agendas
  add column google_connection_id uuid references public.calendar_connections (id) on delete set null,
  add column google_calendar_id text,
  add column google_calendar_name text;

alter table public.appointments
  add column google_event_id text,
  add column google_calendar_id text,
  add column google_connection_id uuid references public.calendar_connections (id) on delete set null,
  add column google_sync_error text;
