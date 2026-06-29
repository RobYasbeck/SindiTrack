-- ╔══════════════════════════════════════════════════════════════╗
-- ║ SindiTrack — Cron de sincronização (sem webhook na origem)     ║
-- ║ 1) atualizar_vencidos(): aberto→vencido só pela passagem do    ║
-- ║    tempo — UPDATE local diário, NÃO bate na API, sem segredo.  ║
-- ║ 2) configurar_cron_http(): agenda o pull de pagamentos via     ║
-- ║    Edge Function. Segredo passado em runtime (rpc), nunca aqui.║
-- ╚══════════════════════════════════════════════════════════════╝

-- 1) Rederiva vencidos localmente (barato, sem API)
create or replace function public.atualizar_vencidos()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.recebimentos
     set status = 'vencido'
   where status = 'aberto'
     and data_pagamento is null
     and data_vencimento is not null
     and data_vencimento < current_date;
  get diagnostics n = row_count;
  return n;
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sinditrack-vencidos') then
    perform cron.unschedule('sinditrack-vencidos');
  end if;
  perform cron.schedule('sinditrack-vencidos', '5 6 * * *', 'select public.atualizar_vencidos()');
end $$;

-- 2) Agendador HTTP genérico — só admin agenda; segredo vem no runtime, não no git.
create or replace function public.configurar_cron_http(
  p_nome text, p_schedule text, p_url text, p_headers jsonb, p_body jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.meu_papel() is distinct from 'admin' then
    raise exception 'apenas admin pode agendar';
  end if;
  if exists (select 1 from cron.job where jobname = p_nome) then
    perform cron.unschedule(p_nome);
  end if;
  perform cron.schedule(p_nome, p_schedule, format(
    'select net.http_post(url:=%L, headers:=%L::jsonb, body:=%L::jsonb)',
    p_url, p_headers::text, p_body::text));
end $$;

revoke execute on function public.configurar_cron_http(text, text, text, jsonb, jsonb) from anon;
