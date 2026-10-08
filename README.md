# Agenda

App de agendamento no estilo cal.com para uma equipe interna, feito com Next.js 15 e Supabase.

- Cada pessoa da equipe tem login, página pública (`/nome`) e links por tipo de evento (`/nome/30min`).
- Disponibilidade semanal por pessoa, com até dois períodos por dia, antecedência mínima, intervalo entre reuniões e janela máxima de reserva.
- Google Agenda: lê os horários ocupados, cria o evento, gera o link do Google Meet e envia o convite ao convidado.
- Apple (iCloud): lê os horários ocupados e cria o evento via CalDAV, usando uma senha de app.
- Agendas da equipe: agendas internas, sem Google nem Apple. O administrador cria quantas quiser, define o dono de cada uma na criação e marca os agendamentos; o dono acompanha a própria agenda.
- O administrador adiciona e remove usuários pelo painel. Não existe cadastro público.
- O convidado recebe uma página de confirmação com link para cancelar e arquivo `.ics`.

## Como colocar para rodar

### 1. Supabase

1. Crie um projeto em https://supabase.com (ou use um existente).
2. Abra **SQL Editor**, cole e execute, em ordem, os arquivos de `supabase/migrations/` (`0001_init.sql` e `0002_agendas.sql`).
3. Em **Authentication → Sign In / Providers**, desligue **Allow new users to sign up**. Os usuários são criados só pelo painel do app.
4. Em **Project Settings → API Keys**, copie a URL do projeto, a chave *publishable* e a chave *secret*.

### 2. Google (para Google Agenda e Meet)

1. Em https://console.cloud.google.com, crie um projeto e ative a **Google Calendar API**.
2. Em **Google Auth Platform**, configure a tela de consentimento e adicione os escopos
   `.../auth/calendar.events` e `.../auth/calendar.freebusy`.
3. Em **Clientes**, crie um **ID do cliente OAuth** do tipo *Aplicativo da Web* com o URI de redirecionamento
   `http://localhost:3000/api/google/callback` (e depois o do seu domínio, por exemplo
   `https://agenda.suaempresa.com/api/google/callback`).
4. Copie o Client ID e o Client Secret.

Importante sobre o status de publicação do app no Google:

- **Google Workspace**: escolha o tipo de usuário **Interno**. Funciona para todos da empresa, sem verificação.
- **Contas @gmail.com**: o tipo é **Externo**. Enquanto estiver em **Teste**, só os usuários de teste cadastrados
  conseguem conectar e a conexão **expira a cada 7 dias**. Para uso real, publique o app (**Em produção**). Sem a
  verificação do Google, aparece um aviso de "app não verificado" na hora de conectar, e há limite de 100 usuários.

### 3. Variáveis de ambiente

```bash
cp .env.example .env.local
# preencha os valores; gere a ENCRYPTION_KEY com:
openssl rand -base64 32
```

### 4. Rodar

```bash
npm install
npm run dev
```

Abra http://localhost:3000. Na primeira vez, o app leva para `/setup`, onde você cria a conta de administrador.
Depois: **Google e Apple** para conectar as agendas externas, **Agendas da equipe**, **Disponibilidade**, **Tipos de evento** e **Equipe**.

### 5. Publicar

O caminho mais simples é a Vercel: importe o projeto, cadastre as mesmas variáveis de ambiente (com
`NEXT_PUBLIC_APP_URL` apontando para o domínio final) e adicione o URI de redirecionamento do domínio no Google.

## Conectar a agenda da Apple

A Apple não tem login por botão (OAuth) para a agenda do iCloud. Cada pessoa precisa:

1. Entrar em https://account.apple.com → **Início de sessão e segurança** → **Senhas de app** e gerar uma senha.
2. No app, em **Google e Apple**, informar o Apple ID e essa senha de app.

A senha de app fica criptografada no banco (AES-256-GCM, com a `ENCRYPTION_KEY`) e pode ser revogada a qualquer
momento na conta Apple. Exige a verificação em duas etapas ativa no Apple ID.

## Como funciona

- **Agenda de destino**: cada pessoa escolhe em qual agenda conectada os novos agendamentos são gravados.
  Eventos com Google Meet vão sempre para a agenda Google, porque só o Google gera o link.
- **Horários ocupados**: somam-se os compromissos de todas as agendas conectadas, os agendamentos do próprio app e os das agendas da equipe em que a pessoa é dona.
  No Google é considerada a agenda principal da conta; no iCloud, todas as agendas da conta.
- **Reserva dupla**: o servidor confere o horário de novo ao reservar e o banco tem uma restrição que impede dois
  agendamentos confirmados sobrepostos para a mesma pessoa.
- **Segurança**: RLS ativo em todas as tabelas. O navegador só enxerga dados do próprio usuário; páginas públicas,
  reservas e credenciais de agenda passam pelo servidor com a chave secreta.

## Limites desta primeira versão

- Não envia e-mails próprios (confirmação, lembrete). Com Google Agenda, o convidado recebe o convite do Google;
  com agenda só da Apple, o convidado fica apenas com a página de confirmação e o `.ics`.
- Não há reagendamento: o convidado cancela e marca outro horário.
- Se uma agenda conectada parar de responder (senha de app revogada, acesso do Google removido), os compromissos
  dela deixam de bloquear horários até a reconexão. O erro aparece em **Google e Apple**.
- O formulário público tem só uma proteção simples contra robôs. Para tráfego aberto, vale adicionar limite de
  requisições ou CAPTCHA.
- Agendamentos são individuais (uma pessoa da equipe por evento), sem rodízio nem eventos em grupo.

## Testes

```bash
npm test          # cálculo de horários, fusos e leitura de eventos .ics (recorrência, exceções)
npm run typecheck
npm run build
```
