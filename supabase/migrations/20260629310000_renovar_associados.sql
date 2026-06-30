-- ╔══════════════════════════════════════════════════════════════╗
-- ║ SindiTrack — "Renovar associados": gera as 12 mensalidades do  ║
-- ║ ano que faltam a cada associado ativo. Valor = mensalidade MAIS ║
-- ║ RECENTE do associado (≤120 → 120; maior → mantém, pois paga    ║
-- ║ mais por ter mais unidades). Idempotente: só gera o que falta. ║
-- ╚══════════════════════════════════════════════════════════════╝

-- Itens passam a guardar o mês (um item por mês na renovação)
alter table public.lote_itens add column if not exists mes_referencia text;
update public.lote_itens li set mes_referencia = l.competencia
  from public.lotes l where li.lote_id = l.id and li.mes_referencia is null;
alter table public.lote_itens alter column mes_referencia set not null;
alter table public.lote_itens drop constraint if exists lote_itens_lote_id_empresa_id_key;
alter table public.lote_itens drop constraint if exists lote_itens_uniq;
alter table public.lote_itens add constraint lote_itens_uniq unique (lote_id, empresa_id, mes_referencia);

-- Lote pode ser do tipo 'renovacao'
alter table public.lotes drop constraint if exists lotes_tipo_check;
alter table public.lotes add constraint lotes_tipo_check check (tipo in ('mensalidade','patronal','renovacao'));

-- montar_lote (mensalidade/patronal): agora seta mes_referencia=competencia no item
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

  insert into public.lote_itens(lote_id, empresa_id, valor, data_vencimento, mes_referencia)
  select v_lote, e.id, v_valor, p_data_vencimento, p_competencia
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
  on conflict (lote_id, empresa_id, mes_referencia) do nothing;

  get diagnostics n = row_count;
  update public.lotes set total_itens = (select count(*) from public.lote_itens where lote_id = v_lote)
    where id = v_lote;
  return json_build_object('lote_id', v_lote, 'novos_itens', n,
    'total_itens', (select count(*) from public.lote_itens where lote_id = v_lote),
    'valor_unitario', v_valor);
end $$;
revoke execute on function public.montar_lote(text, text, date) from anon;

-- montar_renovacao: 12 meses faltantes por associado, valor por associado.
-- Só associados ATIVOS RECENTES: que têm mensalidade não-cancelada de p_desde
-- (default 06/2025) pra frente — ignora quem parou antes disso.
create or replace function public.montar_renovacao(p_ano int, p_desde date default '2025-06-01')
returns json language plpgsql security definer set search_path = public as $$
declare v_lote uuid; v_status text; v_dia int; n int;
begin
  if public.meu_papel() <> 'admin' then raise exception 'apenas admin pode montar lote'; end if;
  select dia_vencimento into v_dia from public.config where id = 1;

  select id, status into v_lote, v_status from public.lotes
    where tipo = 'renovacao' and competencia = p_ano::text;
  if v_lote is null then
    insert into public.lotes(tipo, competencia, status, criado_por)
      values ('renovacao', p_ano::text, 'rascunho', auth.uid()) returning id into v_lote;
  elsif v_status <> 'rascunho' then
    raise exception 'lote renovação % já está %', p_ano, v_status;
  else
    delete from public.lote_itens where lote_id = v_lote and status = 'pendente';
  end if;

  insert into public.lote_itens(lote_id, empresa_id, valor, data_vencimento, mes_referencia)
  select v_lote, e.id,
         case when vb.valor is null or vb.valor <= 120 then 120 else vb.valor end,
         make_date(p_ano, g.m, v_dia),
         lpad(g.m::text, 2, '0') || '/' || p_ano
  from public.empresas e
  cross join generate_series(1, 12) g(m)
  left join lateral (
    select r.valor from public.recebimentos r
    where r.empresa_higestor_id = e.higestor_id and r.tipo = 'mensalidade'
      and r.status <> 'cancelado' and r.valor > 0
    order by r.data_vencimento desc nulls last limit 1
  ) vb on true
  where e.ativo and e.associado and e.cpf_cnpj is not null and e.cpf_cnpj <> ''
    -- só associados com mensalidade recente (de p_desde pra frente)
    and exists (
      select 1 from public.recebimentos r3
      where r3.empresa_higestor_id = e.higestor_id and r3.tipo = 'mensalidade'
        and r3.status <> 'cancelado' and r3.data_vencimento >= p_desde
    )
    and not exists (
      select 1 from public.recebimentos r2
      where r2.empresa_higestor_id = e.higestor_id and r2.tipo = 'mensalidade'
        and r2.mes_referencia = lpad(g.m::text, 2, '0') || '/' || p_ano
        and r2.status <> 'cancelado'
    )
  on conflict (lote_id, empresa_id, mes_referencia) do nothing;

  get diagnostics n = row_count;
  update public.lotes set total_itens = (select count(*) from public.lote_itens where lote_id = v_lote)
    where id = v_lote;
  return json_build_object('lote_id', v_lote, 'novos_itens', n,
    'total_itens', (select count(*) from public.lote_itens where lote_id = v_lote));
end $$;
revoke execute on function public.montar_renovacao(int, date) from anon;
