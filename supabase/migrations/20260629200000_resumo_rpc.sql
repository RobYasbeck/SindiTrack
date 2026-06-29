-- ╔══════════════════════════════════════════════════════════════╗
-- ║ SindiTrack — RPC de resumo p/ dashboards (agrega no banco)     ║
-- ║ SECURITY INVOKER: respeita a RLS de recebimentos (só usuário   ║
-- ║ ativo lê), sem precisar de checagem manual.                    ║
-- ╚══════════════════════════════════════════════════════════════╝

-- Resumo por tipo (mensalidade/patronal) e competência opcional
-- (mensalidade: mes_referencia 'MM/AAAA' · patronal: exercicio 'AAAA').
create or replace function public.resumo_recebimentos(p_tipo text, p_competencia text default null)
returns json language sql stable as $$
  select json_build_object(
    'total_qtd',    count(*),
    'total_valor',  coalesce(sum(valor), 0),
    'pago_qtd',     count(*) filter (where status = 'pago'),
    'pago_valor',   coalesce(sum(valor) filter (where status = 'pago'), 0),
    'aberto_qtd',   count(*) filter (where status = 'aberto'),
    'aberto_valor', coalesce(sum(valor) filter (where status = 'aberto'), 0),
    'vencido_qtd',  count(*) filter (where status = 'vencido'),
    'vencido_valor',coalesce(sum(valor) filter (where status = 'vencido'), 0)
  )
  from public.recebimentos
  where tipo = p_tipo
    and (p_competencia is null
         or (case when p_tipo = 'mensalidade' then mes_referencia else exercicio end) = p_competencia);
$$;

-- Competências disponíveis (para o seletor do dashboard), mais recentes primeiro
create or replace function public.competencias(p_tipo text)
returns table(competencia text) language sql stable as $$
  select distinct (case when p_tipo = 'mensalidade' then mes_referencia else exercicio end) as competencia
  from public.recebimentos
  where tipo = p_tipo
    and (case when p_tipo = 'mensalidade' then mes_referencia else exercicio end) is not null
    and (case when p_tipo = 'mensalidade' then mes_referencia else exercicio end) <> ''
  order by competencia desc;
$$;

revoke execute on function public.resumo_recebimentos(text, text) from anon;
revoke execute on function public.competencias(text) from anon;
