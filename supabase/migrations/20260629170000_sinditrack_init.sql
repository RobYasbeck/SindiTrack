-- ╔══════════════════════════════════════════════════════════════╗
-- ║ SindiTrack — schema inicial (projeto Supabase dedicado)        ║
-- ║ Cobrança sindical: mensalidade (associados) + contribuição    ║
-- ║ patronal anual R$ 2.400 (não-associados). Boletos via API      ║
-- ║ High Gestor. Sem webhook → status por polling (espelho local). ║
-- ║ Papéis: admin / operador                                       ║
-- ╚══════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────
-- Usuários e papéis de acesso
-- ─────────────────────────────────────────────────────────────
create table if not exists public.usuarios (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  nome       text not null,
  email      text not null,
  papel      text not null check (papel in ('admin','operador')),
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

-- Papel do usuário logado (SECURITY DEFINER evita recursão de RLS ao ler a própria tabela)
create or replace function public.meu_papel()
returns text language sql security definer stable
set search_path = public as $$
  select papel from public.usuarios
  where user_id = auth.uid() and ativo = true
  limit 1
$$;

alter table public.usuarios enable row level security;

-- Todo usuário ativo lê a lista de usuários (o próprio perfil sempre)
drop policy if exists usuarios_sel on public.usuarios;
create policy usuarios_sel on public.usuarios
  for select to authenticated
  using ( user_id = auth.uid() or public.meu_papel() is not null );
drop policy if exists usuarios_ins on public.usuarios;
create policy usuarios_ins on public.usuarios
  for insert to authenticated with check ( public.meu_papel() = 'admin' );
drop policy if exists usuarios_upd on public.usuarios;
create policy usuarios_upd on public.usuarios
  for update to authenticated using ( public.meu_papel() = 'admin' );
drop policy if exists usuarios_del on public.usuarios;
create policy usuarios_del on public.usuarios
  for delete to authenticated using ( public.meu_papel() = 'admin' );

-- ─────────────────────────────────────────────────────────────
-- Configuração (linha única id=1) — IDs de cobrança do High Gestor,
-- valores padrão, instância Evolution e templates de mensagem.
-- Preenchida na Fase 1 quando descobrirmos os cobranca_id reais.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.config (
  id                      int primary key default 1 check (id = 1),
  cobranca_id_mensalidade bigint,
  cobranca_id_patronal    bigint,
  valor_mensalidade       numeric(12,2),
  valor_patronal          numeric(12,2) not null default 2400.00,
  dia_vencimento          int not null default 10 check (dia_vencimento between 1 and 28),
  instancia_evolution     text,
  template_whatsapp       text not null default
    'Olá, {nome}! Segue o boleto referente a {referencia}, no valor de {valor}, com vencimento em {vencimento}.\n\nLinha digitável: {linha_digitavel}\nPIX: {codigo_pix}\nBoleto: {link_boleto}',
  template_email_assunto  text not null default 'Boleto {referencia} — vencimento {vencimento}',
  template_email_corpo    text not null default
    'Olá, {nome}!\n\nSegue o boleto referente a {referencia}, no valor de {valor}, com vencimento em {vencimento}.\n\nLinha digitável: {linha_digitavel}\nPIX: {codigo_pix}\nBoleto: {link_boleto}',
  updated_at              timestamptz not null default now()
);
insert into public.config (id) values (1) on conflict (id) do nothing;

alter table public.config enable row level security;
drop policy if exists config_sel on public.config;
create policy config_sel on public.config
  for select to authenticated using ( public.meu_papel() is not null );
drop policy if exists config_upd on public.config;
create policy config_upd on public.config
  for update to authenticated using ( public.meu_papel() = 'admin' );

-- ─────────────────────────────────────────────────────────────
-- Empresas — espelho das entidades do High Gestor.
-- Fonte da verdade é o High Gestor; sincronizado por Edge Function.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.empresas (
  id            uuid primary key default gen_random_uuid(),
  higestor_id   bigint not null unique,
  cpf_cnpj      text,
  razao_social  text,
  nome_fantasia text,
  email         text,
  celular       text,
  telefone      text,
  associado     boolean not null default false,
  filiado       boolean not null default false,
  ativo         boolean not null default true,
  last_sync     timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_empresas_assoc on public.empresas(associado);
create index if not exists idx_empresas_cpfcnpj on public.empresas(cpf_cnpj);

alter table public.empresas enable row level security;
-- Leitura para usuários ativos; escrita só via service role (Edge Function de sync, que ignora RLS)
drop policy if exists empresas_sel on public.empresas;
create policy empresas_sel on public.empresas
  for select to authenticated using ( public.meu_papel() is not null );

-- ─────────────────────────────────────────────────────────────
-- Recebimentos — espelho das faturas do High Gestor (mensalidade/patronal).
-- Campos de boleto vêm do POST/GET /recebimentos.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.recebimentos (
  id              uuid primary key default gen_random_uuid(),
  higestor_id     bigint not null unique,
  empresa_id      uuid references public.empresas(id) on delete set null,
  empresa_cpf_cnpj text,
  tipo            text check (tipo in ('mensalidade','patronal')),
  cobranca_id     bigint,
  referencia      text,
  mes_referencia  text,
  exercicio       text,
  valor           numeric(12,2),
  valor_pago      numeric(12,2) default 0,
  status          text check (status in ('aberto','pago','vencido','expirado','cancelado')),
  data_emissao    date,
  data_vencimento date,
  data_pagamento  date,
  link_boleto     text,
  linha_digitavel text,
  codigo_barra    text,
  codigo_pix      text,
  nosso_numero    text,
  last_sync       timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_receb_empresa on public.recebimentos(empresa_id);
create index if not exists idx_receb_status on public.recebimentos(status);
create index if not exists idx_receb_tipo_venc on public.recebimentos(tipo, data_vencimento);

alter table public.recebimentos enable row level security;
drop policy if exists receb_sel on public.recebimentos;
create policy receb_sel on public.recebimentos
  for select to authenticated using ( public.meu_papel() is not null );

-- ─────────────────────────────────────────────────────────────
-- Envios — log de encaminhamento do boleto (estado que a API NÃO guarda).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.envios (
  id             uuid primary key default gen_random_uuid(),
  recebimento_id uuid not null references public.recebimentos(id) on delete cascade,
  canal          text not null check (canal in ('whatsapp','email')),
  destino        text,
  status         text not null check (status in ('enviado','erro')),
  erro           text,
  enviado_por    uuid references auth.users(id),
  enviado_at     timestamptz not null default now()
);
create index if not exists idx_envios_receb on public.envios(recebimento_id);

alter table public.envios enable row level security;
drop policy if exists envios_sel on public.envios;
create policy envios_sel on public.envios
  for select to authenticated using ( public.meu_papel() is not null );

-- ─────────────────────────────────────────────────────────────
-- Lotes + itens — geração híbrida: rascunho → aprovado → gerado.
-- O rascunho é montado localmente; a geração emite os boletos no High Gestor.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.lotes (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null check (tipo in ('mensalidade','patronal')),
  competencia text not null,                 -- mensalidade: 'MM/AAAA' · patronal: 'AAAA'
  status      text not null default 'rascunho' check (status in ('rascunho','aprovado','gerado','cancelado')),
  total_itens int not null default 0,
  criado_por  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  aprovado_at timestamptz,
  gerado_at   timestamptz,
  unique (tipo, competencia)
);
alter table public.lotes enable row level security;
drop policy if exists lotes_sel on public.lotes;
create policy lotes_sel on public.lotes
  for select to authenticated using ( public.meu_papel() is not null );
drop policy if exists lotes_upd on public.lotes;
create policy lotes_upd on public.lotes
  for update to authenticated using ( public.meu_papel() is not null );

create table if not exists public.lote_itens (
  id              uuid primary key default gen_random_uuid(),
  lote_id         uuid not null references public.lotes(id) on delete cascade,
  empresa_id      uuid not null references public.empresas(id) on delete cascade,
  valor           numeric(12,2) not null,
  data_vencimento date not null,
  recebimento_id  uuid references public.recebimentos(id) on delete set null,
  status          text not null default 'pendente' check (status in ('pendente','gerado','erro')),
  erro            text,
  created_at      timestamptz not null default now(),
  unique (lote_id, empresa_id)
);
create index if not exists idx_lote_itens_lote on public.lote_itens(lote_id);
alter table public.lote_itens enable row level security;
drop policy if exists lote_itens_sel on public.lote_itens;
create policy lote_itens_sel on public.lote_itens
  for select to authenticated using ( public.meu_papel() is not null );
drop policy if exists lote_itens_upd on public.lote_itens;
create policy lote_itens_upd on public.lote_itens
  for update to authenticated using ( public.meu_papel() is not null );
