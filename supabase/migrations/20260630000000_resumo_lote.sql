-- Resumo de um lote: nº de itens, valor total e quebra por status do item.
-- Usado na tela de geração para revisar o lote antes de emitir.
create or replace function public.resumo_lote(p_lote uuid)
returns json language sql stable as $$
  select json_build_object(
    'qtd',          count(*),
    'valor',        coalesce(sum(valor), 0),
    'pendente_qtd', count(*) filter (where status = 'pendente'),
    'gerado_qtd',   count(*) filter (where status = 'gerado'),
    'erro_qtd',     count(*) filter (where status = 'erro')
  )
  from public.lote_itens where lote_id = p_lote;
$$;
revoke execute on function public.resumo_lote(uuid) from anon;
