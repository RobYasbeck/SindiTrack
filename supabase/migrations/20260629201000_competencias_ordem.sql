-- Corrige a ordenação das competências: 'MM/AAAA' ordenado como string põe o mês
-- antes do ano. Ordena cronologicamente (ano desc, depois mês desc) para mensalidade;
-- patronal ('AAAA') já ordena certo como string.
create or replace function public.competencias(p_tipo text)
returns table(competencia text) language sql stable as $$
  select c from (
    select distinct (case when p_tipo = 'mensalidade' then mes_referencia else exercicio end) as c
    from public.recebimentos
    where tipo = p_tipo
      and (case when p_tipo = 'mensalidade' then mes_referencia else exercicio end) is not null
      and (case when p_tipo = 'mensalidade' then mes_referencia else exercicio end) <> ''
  ) s
  order by
    case when p_tipo = 'mensalidade' then right(c, 4) else c end desc,
    case when p_tipo = 'mensalidade' then left(c, 2) else '' end desc;
$$;

revoke execute on function public.competencias(text) from anon;
