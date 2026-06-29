-- ╔══════════════════════════════════════════════════════════════╗
-- ║ SindiTrack — coluna `ano` gerada p/ separar exercícios rápido  ║
-- ║ mensalidade: ano de mes_referencia 'MM/AAAA'; patronal: exercicio.║
-- ║ Regex-guarded: dado fora do padrão vira NULL, não quebra insert.║
-- ╚══════════════════════════════════════════════════════════════╝
alter table public.recebimentos
  add column if not exists ano int generated always as (
    case
      when tipo = 'mensalidade' and mes_referencia ~ '/\d{4}$' then right(mes_referencia, 4)::int
      when tipo = 'patronal'    and exercicio ~ '^\d{4}$'      then exercicio::int
      else null
    end
  ) stored;

create index if not exists idx_receb_tipo_ano on public.recebimentos(tipo, ano, status);
