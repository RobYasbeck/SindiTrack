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

function mapRecebimento(r: any, tipoPorCobranca: Record<number, string>, validosPatronal: number[]) {
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
  // Regra: patronal só vale com valor válido; senão é cadastro errado → mensalidade.
  let tipo = cobId != null ? (tipoPorCobranca[cobId] ?? null) : null;
  const v = num(a.valor);
  if (tipo === 'patronal' && v != null && !validosPatronal.includes(v)) tipo = 'mensalidade';
  return {
    higestor_id: Number(r.id),
    empresa_higestor_id: ent.id != null ? Number(ent.id) : null,
    empresa_cpf_cnpj: ent.cpf_cnpj ?? null,
    empresa_razao_social: ent.razao_social ?? null,
    empresa_associado: !!ent.associado,
    tipo,
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

// ── Envio (Fase 4): WhatsApp via Evolution + e-mail via Resend ──
const EVO_URL = (Deno.env.get('EVOLUTION_API_URL') ?? 'https://luna.yaslabs.dev.br').replace(/\/$/, '');
const EVO_KEY = Deno.env.get('EVOLUTION_API_KEY') ?? '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? '';

const brl = (v: any) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (d: string | null) => (d ? d.split('-').reverse().join('/') : '');

// Substitui {placeholders} do template pelos dados do recebimento.
// Linhas cujo ÚNICO placeholder está vazio são removidas (ex.: "Boleto: {link_boleto}"
// some quando não há link), evitando rótulos órfãos.
function preencheTemplate(tpl: string, r: any) {
  const map: Record<string, string> = {
    nome: r.empresa_razao_social ?? '',
    referencia: r.referencia ?? '',
    valor: brl(r.valor),
    vencimento: dataBR(r.data_vencimento),
    linha_digitavel: r.linha_digitavel ?? '',
    codigo_pix: r.codigo_pix ?? '',
    link_boleto: r.link_boleto ?? '',
  };
  const linhas = tpl.split('\n').filter((linha) => {
    const phs = linha.match(/\{(\w+)\}/g);
    if (phs && phs.length === 1) return !!map[phs[0].slice(1, -1)];
    return true;
  });
  return linhas.join('\n').replace(/\{(\w+)\}/g, (_, k) => map[k] ?? '');
}

// Só dígitos + DDI 55 para o JID do WhatsApp
function toJid(celular: string | null): string | null {
  if (!celular) return null;
  let d = celular.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (!d.startsWith('55')) d = '55' + d;
  return `${d}@s.whatsapp.net`;
}

async function sendWhatsApp(instance: string, jid: string, text: string) {
  const res = await fetch(`${EVO_URL}/message/sendText/${instance}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVO_KEY },
    body: JSON.stringify({ number: jid, text }),
  });
  if (!res.ok) throw new Error(`Evolution HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
}

async function sendEmail(to: string, subject: string, text: string, html?: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, text, ...(html ? { html } : {}) }),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
}

const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

// Monta o corpo HTML do e-mail de cobrança (CSS inline — exigência de e-mail).
function emailHtml(r: any): string {
  const linha = r.linha_digitavel ? `
    <p style="margin:24px 0 6px;font-size:12px;color:#5E7A78;text-transform:uppercase;letter-spacing:.06em">Linha digitável</p>
    <div style="font-family:monospace;font-size:15px;color:#0F2A2A;background:#F3F7F6;border:1px solid #DCE6E5;border-radius:8px;padding:14px 16px;word-break:break-all">${esc(r.linha_digitavel)}</div>` : '';
  const pix = r.codigo_pix ? `
    <p style="margin:20px 0 6px;font-size:12px;color:#5E7A78;text-transform:uppercase;letter-spacing:.06em">PIX copia e cola</p>
    <div style="font-family:monospace;font-size:12px;color:#0F2A2A;background:#F3F7F6;border:1px solid #DCE6E5;border-radius:8px;padding:14px 16px;word-break:break-all">${esc(r.codigo_pix)}</div>` : '';
  const botao = r.link_boleto ? `
    <div style="margin:28px 0 4px"><a href="${esc(r.link_boleto)}" style="display:inline-block;background:#0E7C7B;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 28px;border-radius:10px">Ver boleto completo</a></div>` : '';
  return `<!doctype html><html><body style="margin:0;background:#E4ECEB;padding:24px 0;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #DCE6E5;border-radius:16px;overflow:hidden">
    <div style="background:#0F2A2A;padding:22px 32px;color:#fff;font-size:20px;font-weight:700;letter-spacing:-.3px">Sindi<span style="color:#159392">Track</span></div>
    <div style="padding:32px">
      <p style="margin:0 0 16px;font-size:16px;color:#0F2A2A">Olá, <b>${esc(r.empresa_razao_social || '')}</b>!</p>
      <p style="margin:0 0 20px;font-size:15px;color:#1C3D3C;line-height:1.5">Segue o boleto referente a <b>${esc(r.referencia || '')}</b>.</p>
      <table style="width:100%;border-collapse:collapse;margin:8px 0 4px">
        <tr>
          <td style="padding:14px 16px;background:#F3F7F6;border:1px solid #DCE6E5;border-radius:8px 0 0 8px">
            <div style="font-size:12px;color:#5E7A78;text-transform:uppercase;letter-spacing:.06em">Valor</div>
            <div style="font-size:22px;font-weight:700;color:#0E7C7B;margin-top:2px">${brl(r.valor)}</div>
          </td>
          <td style="padding:14px 16px;background:#F3F7F6;border:1px solid #DCE6E5;border-left:0;border-radius:0 8px 8px 0">
            <div style="font-size:12px;color:#5E7A78;text-transform:uppercase;letter-spacing:.06em">Vencimento</div>
            <div style="font-size:22px;font-weight:700;color:#0F2A2A;margin-top:2px">${dataBR(r.data_vencimento) || '—'}</div>
          </td>
        </tr>
      </table>
      ${linha}${pix}${botao}
      <p style="margin:28px 0 0;font-size:12px;color:#5E7A78;line-height:1.5;border-top:1px solid #DCE6E5;padding-top:16px">Em caso de dúvidas, responda este e-mail. Se o pagamento já foi efetuado, desconsidere.</p>
    </div>
  </div></body></html>`;
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
        .select('cobranca_id_mensalidade, cobranca_id_patronal, valores_patronal_validos').eq('id', 1).maybeSingle();
      const tipoPorCobranca: Record<number, string> = {};
      if (cfg?.cobranca_id_mensalidade) tipoPorCobranca[Number(cfg.cobranca_id_mensalidade)] = 'mensalidade';
      if (cfg?.cobranca_id_patronal) tipoPorCobranca[Number(cfg.cobranca_id_patronal)] = 'patronal';
      tipoPorCobranca[7590] = 'mensalidade';
      const validosPatronal: number[] = (cfg?.valores_patronal_validos ?? [800, 1200, 2400]).map(Number);

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

        const mapped = rows.map((r: any) => mapRecebimento(r, tipoPorCobranca, validosPatronal));
        const { error } = await admin.from('recebimentos').upsert(mapped, { onConflict: 'higestor_id' });
        if (error) return json({ error: 'upsert recebimentos: ' + error.message, processadas }, 500);
        processadas += mapped.length;

        if (rows.length < pageSize) { offset = -1; break; }
        offset += pageSize;
      }

      return json({ ok: true, processadas, total_estimado: total, next_offset: offset < 0 ? null : offset });
    }

    // Emite os boletos de um lote APROVADO no High Gestor (em batch; cliente chama em loop).
    if (action === 'gerar-lote') {
      const loteId = body.lote_id;
      const batch = Math.min(Number(body.batch) || 25, 80);
      const { data: lote } = await admin.from('lotes').select('*').eq('id', loteId).maybeSingle();
      if (!lote) return json({ error: 'Lote não encontrado' }, 404);
      if (!['aprovado', 'gerado'].includes(lote.status)) return json({ error: 'Lote não está aprovado' }, 400);

      // patronal usa a cobrança patronal; mensalidade e renovação usam a de mensalidade
      const isPatronal = lote.tipo === 'patronal';
      const tipoReceb = isPatronal ? 'patronal' : 'mensalidade';
      const { data: cfg } = await admin.from('config').select('cobranca_id_mensalidade, cobranca_id_patronal').eq('id', 1).single();
      const cobranca = isPatronal ? cfg!.cobranca_id_patronal : cfg!.cobranca_id_mensalidade;
      if (!cobranca) return json({ error: 'cobranca_id não configurado para ' + lote.tipo }, 400);

      const { data: items } = await admin.from('lote_itens')
        .select('id, valor, data_vencimento, mes_referencia, empresas(higestor_id, cpf_cnpj, razao_social, associado)')
        .eq('lote_id', loteId).eq('status', 'pendente').limit(batch);

      let gerados = 0, erros = 0;
      for (const it of items ?? []) {
        const emp: any = it.empresas;
        // mensalidade/renovação: mês vem do item; patronal: referência pelo exercício do lote
        const ref = isPatronal ? `Contribuição Patronal ${lote.competencia}` : `Mensalidade ${it.mes_referencia}`;
        const attrs: any = {
          entidade_cpf_cnpj: emp.cpf_cnpj, referencia: ref,
          data_vencimento: it.data_vencimento, valor: Number(it.valor), cobranca_id: Number(cobranca),
        };
        if (!isPatronal) attrs.mes_referencia = it.mes_referencia;
        try {
          const res = await fetch(`${HG_BASE}/recebimentos`, {
            method: 'POST',
            headers: { 'Auth-Token': token, 'Content-Type': 'application/vnd.api+json', Accept: HG_ACCEPT },
            body: JSON.stringify({ data: { type: 'Recebimento', attributes: attrs } }),
          });
          const out = await res.json().catch(() => ({}));
          if (!res.ok || !(out.sucess || out.success)) throw new Error(out.error || `HTTP ${res.status}`);
          const newId = Number(Array.isArray(out.id) ? out.id[0] : out.id);
          const link = Array.isArray(out.links) ? out.links[0] : out.links;

          await admin.from('recebimentos').upsert({
            higestor_id: newId, empresa_higestor_id: emp.higestor_id, empresa_cpf_cnpj: emp.cpf_cnpj,
            empresa_razao_social: emp.razao_social, empresa_associado: emp.associado, tipo: tipoReceb,
            cobranca_id: Number(cobranca), referencia: ref,
            mes_referencia: isPatronal ? null : it.mes_referencia,
            exercicio: isPatronal ? lote.competencia : null,
            valor: Number(it.valor), valor_pago: 0, status: 'aberto',
            data_vencimento: it.data_vencimento, link_boleto: link, last_sync: new Date().toISOString(),
          }, { onConflict: 'higestor_id' });
          const { data: rec } = await admin.from('recebimentos').select('id').eq('higestor_id', newId).single();
          await admin.from('lote_itens').update({ status: 'gerado', recebimento_id: rec!.id, erro: null }).eq('id', it.id);
          gerados++;
        } catch (e) {
          await admin.from('lote_itens').update({ status: 'erro', erro: String((e as Error).message) }).eq('id', it.id);
          erros++;
        }
      }
      const { count: restantes } = await admin.from('lote_itens')
        .select('*', { count: 'exact', head: true }).eq('lote_id', loteId).eq('status', 'pendente');
      if ((restantes ?? 0) === 0) await admin.from('lotes').update({ status: 'gerado', gerado_at: new Date().toISOString() }).eq('id', loteId);
      return json({ ok: true, gerados, erros, restantes: restantes ?? 0 });
    }

    // Encaminha o boleto de UM recebimento (WhatsApp e/ou e-mail) e registra em envios.
    if (action === 'enviar-boleto') {
      const recId = body.recebimento_id;
      const canais: string[] = body.canais ?? ['whatsapp', 'email'];
      const { data: rec } = await admin.from('recebimentos').select('*').eq('id', recId).maybeSingle();
      if (!rec) return json({ error: 'Recebimento não encontrado' }, 404);

      // completa dados do boleto se faltarem (linha digitável/pix/link) via GET /recebimentos/{id}
      if (!rec.linha_digitavel || !rec.link_boleto) {
        try {
          const det = await hgGet(`/recebimentos/${rec.higestor_id}`, token);
          const a = det.data?.attributes ?? {};
          const upd: any = {};
          if (a.linha_digitavel) upd.linha_digitavel = a.linha_digitavel;
          if (a.codigo_pix) upd.codigo_pix = a.codigo_pix;
          if (a.codigo_barra) upd.codigo_barra = a.codigo_barra;
          if (a.nosso_numero) upd.nosso_numero = a.nosso_numero;
          if (Object.keys(upd).length) { await admin.from('recebimentos').update(upd).eq('id', recId); Object.assign(rec, upd); }
        } catch { /* segue com o que tem */ }
      }

      const { data: cfg } = await admin.from('config')
        .select('instancia_evolution, template_whatsapp, template_email_assunto, template_email_corpo').eq('id', 1).single();
      const { data: emp } = await admin.from('empresas')
        .select('email, celular, telefone').eq('higestor_id', rec.empresa_higestor_id).maybeSingle();

      const resultados: any[] = [];
      const logar = async (canal: string, destino: string | null, ok: boolean, erro?: string) => {
        await admin.from('envios').insert({ recebimento_id: recId, canal, destino, status: ok ? 'enviado' : 'erro', erro: erro ?? null });
        resultados.push({ canal, destino, ok, erro });
      };

      if (canais.includes('whatsapp')) {
        const jid = toJid(emp?.celular || emp?.telefone || null);
        try {
          if (!EVO_KEY || !cfg?.instancia_evolution) throw new Error('Evolution não configurado (instância/secret)');
          if (!jid) throw new Error('Sem celular válido');
          await sendWhatsApp(cfg.instancia_evolution, jid, preencheTemplate(cfg.template_whatsapp, rec));
          await logar('whatsapp', jid, true);
        } catch (e) { await logar('whatsapp', jid, false, String((e as Error).message)); }
      }
      if (canais.includes('email')) {
        // modo teste: body.email_to sobrescreve o destinatário (manda pra você, não pra empresa)
        const to = body.email_to || emp?.email || null;
        try {
          if (!RESEND_KEY || !RESEND_FROM) throw new Error('Resend não configurado (RESEND_API_KEY/RESEND_FROM)');
          if (!to) throw new Error('Sem e-mail');
          await sendEmail(to, preencheTemplate(cfg!.template_email_assunto, rec), preencheTemplate(cfg!.template_email_corpo, rec), emailHtml(rec));
          await logar('email', to, true);
        } catch (e) { await logar('email', to, false, String((e as Error).message)); }
      }
      return json({ ok: resultados.some((r) => r.ok), resultados });
    }

    return json({ error: 'Ação desconhecida: ' + action }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
