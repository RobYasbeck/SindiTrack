-- ╔══════════════════════════════════════════════════════════════╗
-- ║ SindiTrack — override de exercício (correção manual persistente)║
-- ║ Alguns patronais vêm com exercício errado da origem. O sync NÃO║
-- ║ escreve exercicio_corrigido → a correção sobrevive a re-syncs.  ║
-- ║ A coluna gerada `ano` passa a respeitar o override (patronal).  ║
-- ╚══════════════════════════════════════════════════════════════╝
alter table public.recebimentos
  add column if not exists exercicio_corrigido int;

-- Recria a coluna gerada `ano` considerando o override (patronal)
drop index if exists idx_receb_tipo_ano;
alter table public.recebimentos drop column if exists ano;
alter table public.recebimentos
  add column ano int generated always as (
    case
      when tipo = 'mensalidade' and mes_referencia ~ '/\d{4}$' then right(mes_referencia, 4)::int
      when tipo = 'patronal' then coalesce(
        exercicio_corrigido,
        case when exercicio ~ '^\d{4}$' then exercicio::int else null end
      )
      else null
    end
  ) stored;
create index if not exists idx_receb_tipo_ano on public.recebimentos(tipo, ano, status);

-- Correção dos 5 patronais com exercício errado (2026 → 2025)
update public.recebimentos set exercicio_corrigido = 2025
where higestor_id in (14985443, 14985472, 15246074, 15246072, 15246073);
