-- ╔══════════════════════════════════════════════════════════════╗
-- ║ SindiTrack — patronal: só valores válidos (800/1200/2400)      ║
-- ║ Recebimentos patronais com outros valores estão cadastrados    ║
-- ║ errados na origem (não são patronal) → ignorados na visão e na ║
-- ║ geração. Lista configurável em config.valores_patronal_validos.║
-- ╚══════════════════════════════════════════════════════════════╝
alter table public.config
  add column if not exists valores_patronal_validos numeric[] not null default '{800,1200,2400}';

-- Resumo por escopo: para patronal, considera só valores válidos
create or replace function public.resumo_por_escopo(p_tipo text, p_escopo text default 'corrente')
returns json language plpgsql stable as $$
declare v_ano int; v_validos numeric[]; res json;
begin
  select exercicio_corrente, valores_patronal_validos into v_ano, v_validos from public.config where id = 1;
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
    and case
      when p_escopo = 'todos' then true
      when p_escopo = 'atrasado' then ano < v_ano
      else ano = v_ano
    end;
  return res;
end $$;
revoke execute on function public.resumo_por_escopo(text, text) from anon;

-- montar_lote: ao checar se a empresa já tem patronal da competência, contar só
-- recebimento com valor válido (assim um cadastro errado não bloqueia a geração).
create or replace function public.montar_lote(
  p_tipo text, p_competencia text, p_data_vencimento date
) returns json language plpgsql security definer set search_path = public as $$
declare v_lote uuid; v_valor numeric; v_status text; v_validos numeric[]; n int;
begin
  if public.meu_papel() <> 'admin' then raise exception 'apenas admin pode montar lote'; end if;
  if p_tipo not in ('mensalidade','patronal') then raise exception 'tipo inválido'; end if;

  select case when p_tipo = 'mensalidade' then valor_mensalidade else valor_patronal end,
         valores_patronal_validos
    into v_valor, v_validos from public.config where id = 1;
  if v_valor is null then raise exception 'valor de % não configurado em config', p_tipo; end if;

  select id, status into v_lote, v_status from public.lotes
    where tipo = p_tipo and competencia = p_competencia;
  if v_lote is null then
    insert into public.lotes(tipo, competencia, status, criado_por)
      values (p_tipo, p_competencia, 'rascunho', auth.uid()) returning id into v_lote;
  elsif v_status <> 'rascunho' then
    raise exception 'lote % % já está %', p_tipo, p_competencia, v_status;
  else
    delete from public.lote_itens where lote_id = v_lote and status = 'pendente';
  end if;

  insert into public.lote_itens(lote_id, empresa_id, valor, data_vencimento)
  select v_lote, e.id, v_valor, p_data_vencimento
  from public.empresas e
  where e.ativo
    and e.cpf_cnpj is not null and e.cpf_cnpj <> ''
    and (case when p_tipo = 'mensalidade' then e.associado else not e.associado end)
    and not exists (
      select 1 from public.recebimentos r
      where r.empresa_higestor_id = e.higestor_id
        and r.tipo = p_tipo
        and (case when p_tipo = 'mensalidade' then r.mes_referencia else r.exercicio end) = p_competencia
        and r.status <> 'cancelado'
        and (p_tipo <> 'patronal' or r.valor = any(v_validos))
    )
  on conflict (lote_id, empresa_id) do nothing;

  get diagnostics n = row_count;
  update public.lotes set total_itens = (select count(*) from public.lote_itens where lote_id = v_lote)
    where id = v_lote;

  return json_build_object('lote_id', v_lote, 'novos_itens', n,
    'total_itens', (select count(*) from public.lote_itens where lote_id = v_lote),
    'valor_unitario', v_valor);
end $$;
revoke execute on function public.montar_lote(text, text, date) from anon;
