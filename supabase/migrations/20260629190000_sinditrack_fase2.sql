-- ╔══════════════════════════════════════════════════════════════╗
-- ║ SindiTrack — Fase 2: recebimentos para acompanhamento          ║
-- ║ Desnormaliza dados da empresa no recebimento (a API já manda   ║
-- ║ junto) p/ os dashboards rodarem sem join sobre ~15k linhas.    ║
-- ║ Habilita pg_cron + pg_net p/ a sincronização periódica.        ║
-- ╚══════════════════════════════════════════════════════════════╝

-- Vínculo com a empresa por higestor_id (entidade do recebimento) + desnormalização
alter table public.recebimentos
  add column if not exists empresa_higestor_id bigint,
  add column if not exists empresa_razao_social text,
  add column if not exists empresa_associado boolean;

create index if not exists idx_receb_emp_hg on public.recebimentos(empresa_higestor_id);
create index if not exists idx_receb_mes on public.recebimentos(mes_referencia);
create index if not exists idx_receb_exercicio on public.recebimentos(exercicio);

-- Extensões para o agendamento (job criado fora do git, lendo segredo do Vault)
create extension if not exists pg_cron;
create extension if not exists pg_net;
