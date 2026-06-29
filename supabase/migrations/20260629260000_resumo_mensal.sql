-- ╔══════════════════════════════════════════════════════════════╗
-- ║ SindiTrack — visão mensal da mensalidade (linha do tempo 12m)  ║
-- ║ Agrega por mês (1–12) de um ano, com status pago/aberto/vencido.║
-- ╚══════════════════════════════════════════════════════════════╝
create or replace function public.resumo_mensal(p_ano int)
returns table(
  mes int,
  total_qtd bigint, total_valor numeric,
  pago_qtd bigint, pago_valor numeric,
  aberto_qtd bigint, aberto_valor numeric,
  vencido_qtd bigint, vencido_valor numeric
) language sql stable as $$
  select
    left(mes_referencia, 2)::int as mes,
    count(*),
    coalesce(sum(valor), 0),
    count(*) filter (where status = 'pago'),
    coalesce(sum(valor) filter (where status = 'pago'), 0),
    count(*) filter (where status = 'aberto'),
    coalesce(sum(valor) filter (where status = 'aberto'), 0),
    count(*) filter (where status = 'vencido'),
    coalesce(sum(valor) filter (where status = 'vencido'), 0)
  from public.recebimentos
  where tipo = 'mensalidade'
    and ano = p_ano
    and mes_referencia ~ '^\d{2}/\d{4}$'
  group by left(mes_referencia, 2)::int
  order by mes;
$$;

-- Anos com mensalidade (para o seletor)
create or replace function public.anos_mensalidade()
returns table(ano int) language sql stable as $$
  select distinct ano from public.recebimentos
  where tipo = 'mensalidade' and ano is not null
  order by ano desc;
$$;

revoke execute on function public.resumo_mensal(int) from anon;
revoke execute on function public.anos_mensalidade() from anon;
