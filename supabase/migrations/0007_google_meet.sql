-- Link do Google Meet por agendamento das agendas da equipe.
alter table public.appointments
  add column wants_meet boolean not null default true,
  add column meet_url text;

-- Reuniões presenciais já existentes não precisam de Meet.
update public.appointments set wants_meet = false where title ilike '%presencial%';
