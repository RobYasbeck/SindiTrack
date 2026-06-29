-- ╔══════════════════════════════════════════════════════════════╗
-- ║ SindiTrack — Fase 3: montar lote (rascunho, set-based no banco) ║
-- ║ Seleciona quem DEVE ser cobrado e ainda NÃO tem boleto da       ║
-- ║ competência → separa naturalmente 2026 (corrente) de 2025.     ║
-- ║   mensalidade: associadas ativas, por mes_referencia 'MM/AAAA' ║
-- ║   patronal:    não-associadas ativas, por exercicio 'AAAA'     ║
-- ╚══════════════════════════════════════════════════════════════╝
create or replace function public.montar_lote(
  p_tipo text, p_competencia text, p_data_vencimento date
) returns json language plpgsql security definer set search_path = public as $$
declare v_lote uuid; v_valor numeric; v_status text; n int;
begin
  if public.meu_papel() <> 'admin' then raise exception 'apenas admin pode montar lote'; end if;
  if p_tipo not in ('mensalidade','patronal') then raise exception 'tipo inválido'; end if;

  select case when p_tipo = 'mensalidade' then valor_mensalidade else valor_patronal end
    into v_valor from public.config where id = 1;
  if v_valor is null then raise exception 'valor de % não configurado em config', p_tipo; end if;

  -- lote da competência: cria rascunho ou reaproveita se ainda for rascunho
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

  -- itens: quem deve pagar, tem CNPJ e ainda não tem recebimento (não-cancelado) dessa competência
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

-- Aprova o lote (rascunho → aprovado): trava a edição e libera a geração.
create or replace function public.aprovar_lote(p_lote_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.meu_papel() <> 'admin' then raise exception 'apenas admin pode aprovar'; end if;
  update public.lotes set status = 'aprovado', aprovado_at = now()
    where id = p_lote_id and status = 'rascunho';
  if not found then raise exception 'lote inexistente ou não está em rascunho'; end if;
end $$;

revoke execute on function public.aprovar_lote(uuid) from anon;
