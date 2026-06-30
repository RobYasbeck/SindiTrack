-- Descartar um lote que ainda não foi emitido (rascunho/aprovado/cancelado).
-- Só admin. Lote já 'gerado' não pode ser descartado (boletos reais emitidos).
create or replace function public.descartar_lote(p_lote uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.meu_papel() <> 'admin' then raise exception 'apenas admin pode descartar'; end if;
  if exists (select 1 from public.lotes where id = p_lote and status = 'gerado') then
    raise exception 'lote já gerado não pode ser descartado';
  end if;
  delete from public.lotes where id = p_lote;  -- lote_itens caem por ON DELETE CASCADE
end $$;
revoke execute on function public.descartar_lote(uuid) from anon;
