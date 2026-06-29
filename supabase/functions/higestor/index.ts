// SindiTrack — proxy autenticado da API High Gestor.
// O Auth-Token do High Gestor fica SÓ aqui (secret HIGESTOR_TOKEN), nunca no browser.
// Toda chamada exige um usuário SindiTrack autenticado e ativo.
//
// Ações (body { action, ... }):
//   sync-empresas  → puxa /empresas paginado (chunk) e faz upsert em public.empresas.
//                    params: offset (default 0), pages (default 5), pageSize (default 200).
//                    devolve { processadas, total, next_offset } — chame em loop até next_offset=null.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const HG_BASE = 'https://app.higestor.com.br/api';
const HG_ACCEPT = 'application/vnd.api+json';

async function hgGet(path: string, token: string) {
  const res = await fetch(`${HG_BASE}${path}`, {
    headers: { 'Auth-Token': token, Accept: HG_ACCEPT },
  });
  if (!res.ok) throw new Error(`High Gestor ${path} → HTTP ${res.status}`);
  return res.json();
}

// offset do recurso na URL de paginação "last" (…&page[offset]=N)
function lastOffset(links: Record<string, string> | undefined): number | null {
  const last = links?.last;
  if (!last) return null;
  const m = decodeURIComponent(last).match(/page\[offset\]=(\d+)/);
  return m ? Number(m[1]) : null;
}

function mapEmpresa(r: any) {
  const a = r.attributes ?? {};
  const status = String(a.status ?? '').toLowerCase();
  return {
    higestor_id: Number(r.id),
    cpf_cnpj: a.cnpj ?? null,
    razao_social: a.razao_social ?? null,
    nome_fantasia: a.nome ?? null,
    email: a.email || null,
    celular: a.celular || null,
    telefone: a.telefone || null,
    associado: !!a.associado,
    filiado: !!a.filiado,
    ativo: status ? !['inativo', 'baixado', 'excluido', 'cancelado'].includes(status) : true,
    last_sync: new Date().toISOString(),
  };
}

const num = (v: any) => (v == null || v === '' ? null : Number(v));

function mapRecebimento(r: any, tipoPorCobranca: Record<number, string>) {
  const a = r.attributes ?? {};
  const ent = a.entidade ?? {};
  const cobId = a.cobranca?.id != null ? Number(a.cobranca.id) : null;
  // A API não devolve "status" no objeto (só aceita como filtro) → derivar das datas.
  const hoje = new Date().toISOString().slice(0, 10);
  let st: string;
  if (a.data_cancelamento) st = 'cancelado';
  else if (a.data_pagamento) st = 'pago';
  else if (a.data_vencimento && a.data_vencimento < hoje) st = 'vencido';
  else st = 'aberto';
  return {
    higestor_id: Number(r.id),
    empresa_higestor_id: ent.id != null ? Number(ent.id) : null,
    empresa_cpf_cnpj: ent.cpf_cnpj ?? null,
    empresa_razao_social: ent.razao_social ?? null,
    empresa_associado: !!ent.associado,
    tipo: cobId != null ? (tipoPorCobranca[cobId] ?? null) : null,
    cobranca_id: cobId,
    referencia: a.referencia ?? null,
    mes_referencia: a.mes_referencia || null,
    exercicio: a.exercicio ? String(a.exercicio) : null,
    valor: num(a.valor),
    valor_pago: num(a.valor_pago) ?? 0,
    status: st,
    data_emissao: a.data_emissao || null,
    data_vencimento: a.data_vencimento || null,
    data_pagamento: a.data_pagamento || null,
    link_boleto: a.link_boleto ?? null,
    linha_digitavel: a.linha_digitavel ?? null,
    codigo_barra: a.codigo_barra ?? null,
    codigo_pix: a.codigo_pix ?? null,
    nosso_numero: a.nosso_numero ?? null,
    last_sync: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const token = Deno.env.get('HIGESTOR_TOKEN');
    if (!token) return json({ error: 'HIGESTOR_TOKEN não configurado' }, 500);

    const admin = createClient(url, service);

    // Autorização: ou um usuário SindiTrack ativo, ou a chamada do cron (x-cron-secret).
    const cronSecret = Deno.env.get('CRON_SECRET');
    const isCron = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret;
    if (!isCron) {
      const asUser = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
      const { data: { user } } = await asUser.auth.getUser();
      if (!user) return json({ error: 'Não autenticado' }, 401);
      const { data: me } = await admin.from('usuarios').select('ativo').eq('user_id', user.id).maybeSingle();
      if (!me?.ativo) return json({ error: 'Sem permissão' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === 'sync-empresas') {
      const pageSize = Math.min(Number(body.pageSize) || 200, 200);
      const pages = Math.min(Number(body.pages) || 5, 20);
      let offset = Number(body.offset) || 0;
      let total: number | null = null;
      let processadas = 0;

      for (let i = 0; i < pages; i++) {
        const data = await hgGet(`/empresas?page[limit]=${pageSize}&page[offset]=${offset}`, token);
        const rows = data.data ?? [];
        if (total === null) total = lastOffset(data.links);
        if (rows.length === 0) { offset = -1; break; }

        const mapped = rows.map(mapEmpresa);
        const { error } = await admin.from('empresas').upsert(mapped, { onConflict: 'higestor_id' });
        if (error) return json({ error: 'upsert empresas: ' + error.message, processadas }, 500);
        processadas += mapped.length;

        if (rows.length < pageSize) { offset = -1; break; }   // última página
        offset += pageSize;
      }

      return json({
        ok: true,
        processadas,
        total_estimado: total,
        next_offset: offset < 0 ? null : offset,
      });
    }

    if (action === 'sync-recebimentos') {
      // Mapa cobranca_id → tipo, a partir da config (mensalidade eletrônica 7590 também conta como mensalidade)
      const { data: cfg } = await admin.from('config')
        .select('cobranca_id_mensalidade, cobranca_id_patronal').eq('id', 1).maybeSingle();
      const tipoPorCobranca: Record<number, string> = {};
      if (cfg?.cobranca_id_mensalidade) tipoPorCobranca[Number(cfg.cobranca_id_mensalidade)] = 'mensalidade';
      if (cfg?.cobranca_id_patronal) tipoPorCobranca[Number(cfg.cobranca_id_patronal)] = 'patronal';
      tipoPorCobranca[7590] = 'mensalidade';

      // Filtros opcionais. Cron incremental: dias_pagamento define a janela de pagamentos recentes.
      const f: string[] = [];
      if (body.cobranca) f.push(`filter[cobranca]=${Number(body.cobranca)}`);
      if (body.status) f.push(`filter[status]=${encodeURIComponent(body.status)}`);
      let dpi = body.data_pagamento_inicio;
      if (!dpi && body.dias_pagamento) dpi = new Date(Date.now() - Number(body.dias_pagamento) * 864e5).toISOString().slice(0, 10);
      if (dpi) f.push(`filter[data_pagamento][inicio]=${dpi}`);
      const filtros = f.length ? f.join('&') + '&' : '';

      const pageSize = Math.min(Number(body.pageSize) || 200, 200);
      const pages = Math.min(Number(body.pages) || 5, 20);
      const loop = !!body.loop;                       // pagina internamente até o fim (uso do cron)
      const maxIters = loop ? 80 : pages;
      let offset = Number(body.offset) || 0;
      let total: number | null = null;
      let processadas = 0;

      for (let i = 0; i < maxIters; i++) {
        const data = await hgGet(`/recebimentos?${filtros}page[limit]=${pageSize}&page[offset]=${offset}`, token);
        const rows = data.data ?? [];
        if (total === null) total = lastOffset(data.links);
        if (rows.length === 0) { offset = -1; break; }

        const mapped = rows.map((r: any) => mapRecebimento(r, tipoPorCobranca));
        const { error } = await admin.from('recebimentos').upsert(mapped, { onConflict: 'higestor_id' });
        if (error) return json({ error: 'upsert recebimentos: ' + error.message, processadas }, 500);
        processadas += mapped.length;

        if (rows.length < pageSize) { offset = -1; break; }
        offset += pageSize;
      }

      return json({ ok: true, processadas, total_estimado: total, next_offset: offset < 0 ? null : offset });
    }

    return json({ error: 'Ação desconhecida: ' + action }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
