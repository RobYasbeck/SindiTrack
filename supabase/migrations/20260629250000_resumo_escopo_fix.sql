-- Corrige ambiguidade: a variável plpgsql "ano" colidia com a coluna gerada
-- recebimentos.ano. Renomeia para v_ano e usa a coluna ano (mais simples/rápido).
create or replace function public.resumo_por_escopo(p_tipo text, p_escopo text default 'corrente')
returns json language plpgsql stable as $$
declare v_ano int; res json;
begin
  select exercicio_corrente into v_ano from public.config where id = 1;
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
    and case
      when p_escopo = 'todos' then true
      when p_escopo = 'atrasado' then ano < v_ano
      else ano = v_ano
    end;
  return res;
end $$;

revoke execute on function public.resumo_por_escopo(text, text) from anon;
