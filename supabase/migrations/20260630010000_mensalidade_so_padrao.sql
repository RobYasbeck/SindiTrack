-- ╔══════════════════════════════════════════════════════════════╗
-- ║ SindiTrack — mensalidade só para "cliente padrão R$120"        ║
-- ║ Entra associado ativo cujo valor de mensalidade MAIS RECENTE   ║
-- ║ é ≤ R$120 (cobra R$120). Clientes maiores (>120) ficam de fora ║
-- ║ — são tratados à parte. (Filiado NÃO entra no critério.)       ║
-- ╚══════════════════════════════════════════════════════════════╝
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
  -- valor de mensalidade mais recente do associado (p/ separar padrão de cliente maior)
  left join lateral (
    select r.valor from public.recebimentos r
    where r.empresa_higestor_id = e.higestor_id and r.tipo = 'mensalidade'
      and r.status <> 'cancelado' and r.valor > 0
    order by r.data_vencimento desc nulls last limit 1
  ) vb on true
  where e.ativo
    and e.cpf_cnpj is not null and e.cpf_cnpj <> ''
    and (case when p_tipo = 'mensalidade' then e.associado else not e.associado end)
    -- mensalidade: só cliente padrão (valor recente conhecido e ≤ 120)
    and (p_tipo <> 'mensalidade' or (vb.valor is not null and vb.valor <= 120))
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
