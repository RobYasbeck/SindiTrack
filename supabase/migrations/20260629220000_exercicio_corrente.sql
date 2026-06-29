-- ╔══════════════════════════════════════════════════════════════╗
-- ║ SindiTrack — Exercício corrente (separar 2025 atrasado de 2026)║
-- ║ Virou o ano: 2026 é o exercício corrente; anos anteriores são  ║
-- ║ "atrasados". Usado nos dashboards e na geração de lotes.       ║
-- ╚══════════════════════════════════════════════════════════════╝

alter table public.config
  add column if not exists exercicio_corrente int not null default 2026;

-- Resumo por "escopo": 'corrente' (= exercicio_corrente), 'atrasado' (< corrente) ou 'todos'.
-- Para mensalidade, o ano sai de right(mes_referencia,4); para patronal, de exercicio.
create or replace function public.resumo_por_escopo(p_tipo text, p_escopo text default 'corrente')
returns json language plpgsql stable as $$
declare ano int; res json;
begin
  select exercicio_corrente into ano from public.config where id = 1;
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
      when p_escopo = 'atrasado' then
        (case when p_tipo = 'mensalidade' then nullif(right(mes_referencia,4),'')::int else nullif(exercicio,'')::int end) < ano
      else -- 'corrente'
        (case when p_tipo = 'mensalidade' then nullif(right(mes_referencia,4),'')::int else nullif(exercicio,'')::int end) = ano
    end;
  return res;
end $$;

revoke execute on function public.resumo_por_escopo(text, text) from anon;
