-- ╔══════════════════════════════════════════════════════════════╗
-- ║ SindiTrack — reclassifica patronal "errada" como mensalidade   ║
-- ║ Patronais com valor fora de {800,1200,2400} não são patronal   ║
-- ║ (semestralidade, CCT, negociação…). Por decisão do chefe, vão  ║
-- ║ para mensalidade NO ESPELHO da ferramenta. A origem (High      ║
-- ║ Gestor) não muda — a API não troca cobrança e há boletos pagos.║
-- ║ A coluna gerada `ano` se recalcula sozinha (usa mes_referencia).║
-- ╚══════════════════════════════════════════════════════════════╝
update public.recebimentos r
set tipo = 'mensalidade'
from public.config c
where c.id = 1
  and r.tipo = 'patronal'
  and r.valor is not null
  and not (r.valor = any(c.valores_patronal_validos));
