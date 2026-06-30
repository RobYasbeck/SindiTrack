-- ╔══════════════════════════════════════════════════════════════╗
-- ║ SindiTrack — patronal por ANO (seletor, no lugar das abas)     ║
-- ║ resumo_ano: agrega por ano (null = todos). anos_por_tipo: anos  ║
-- ║ disponíveis. Ambos respeitam o filtro de valores da patronal.  ║
-- ╚══════════════════════════════════════════════════════════════╝
create or replace function public.resumo_ano(p_tipo text, p_ano int default null)
returns json language plpgsql stable as $$
declare v_validos numeric[]; res json;
begin
  select valores_patronal_validos into v_validos from public.config where id = 1;
  select json_build_object(
    'total_qtd',    count(*),
    'total_valor',  coalesce(sum(valor), 0),
    'pago_qtd',     count(*) filter (where status = 'pago'),
    'pago_valor',   coalesce(sum(valor) filter (where status = 'pago'), 0),
    'aberto_qtd',   count(*) filter (where status = 'aberto'),
    'aberto_valor', coalesce(sum(valor) filter (where status = 'aberto'), 0),
    'vencido_qtd',  count(*) filter (where status = 'vencido'),
    'vencido_valor',coalesce(sum(valor) filter (where status = 'vencido'), 0)
  ) into res
  from public.recebimentos
  where tipo = p_tipo
    and (p_tipo <> 'patronal' or valor = any(v_validos))
    and (p_ano is null or ano = p_ano);
  return res;
end $$;
revoke execute on function public.resumo_ano(text, int) from anon;

create or replace function public.anos_por_tipo(p_tipo text)
returns table(ano int) language plpgsql stable as $$
declare v_validos numeric[];
begin
  select valores_patronal_validos into v_validos from public.config where id = 1;
  return query
    select distinct r.ano from public.recebimentos r
    where r.tipo = p_tipo and r.ano is not null
      and (p_tipo <> 'patronal' or r.valor = any(v_validos))
    order by r.ano desc;
end $$;
revoke execute on function public.anos_por_tipo(text) from anon;
