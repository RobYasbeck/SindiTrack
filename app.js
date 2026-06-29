// SindiTrack — App (front vanilla, Supabase). Projeto dedicado vtlcmevnanymdibvaeam.
const sb = window.supabase.createClient(
  SINDITRACK_CONFIG.supabase.url,
  SINDITRACK_CONFIG.supabase.anonKey
);
const $ = (id) => document.getElementById(id);

const PAPEL_LABEL = { admin: 'Admin', operador: 'Operador' };
const VIEW_TITLE = {
  mensalidades: 'Mensalidades',
  patronais: 'Contribuição patronal',
  geracao: 'Geração de boletos',
  empresas: 'Empresas',
  config: 'Configurações',
  usuarios: 'Usuários',
};

let currentUser = null;
let currentPapel = null;

// ── Sessão ──────────────────────────────────────────────
async function checkSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) await loadProfile(session.user);
  else showLogin();
}

async function loadProfile(user) {
  currentUser = user;
  const { data, error } = await sb
    .from('usuarios')
    .select('id, nome, papel, ativo')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !data || !data.ativo) { showNoAccess(); return; }
  currentPapel = data.papel;
  showApp(data.nome || user.email, data.papel);
}

function showApp(nome, papel) {
  $('login-screen').classList.add('hidden');
  $('no-access').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('user-display').textContent = nome;
  const badge = $('user-papel');
  badge.textContent = PAPEL_LABEL[papel] || papel;
  badge.className = 'papel-badge papel-' + papel;
  $('user-initial').textContent = (nome || 'U').trim()[0].toUpperCase();
  applyRoleGating(papel);
  go('mensalidades');
}

function showLogin() {
  $('app').classList.add('hidden');
  $('no-access').classList.add('hidden');
  $('login-screen').classList.remove('hidden');
}
function showNoAccess() {
  $('app').classList.add('hidden');
  $('login-screen').classList.add('hidden');
  $('no-access').classList.remove('hidden');
}

// Esconde itens de menu fora do papel do usuário
function applyRoleGating(papel) {
  document.querySelectorAll('[data-roles]').forEach((el) => {
    const roles = el.getAttribute('data-roles').split(',');
    el.classList.toggle('hidden', !roles.includes(papel));
  });
}

// ── Navegação ───────────────────────────────────────────
function go(view) {
  document.querySelectorAll('main section[id^="view-"]').forEach((s) => s.classList.add('hidden'));
  $('view-' + view)?.classList.remove('hidden');
  document.querySelectorAll('.sidebar-item').forEach((a) =>
    a.classList.toggle('active', a.getAttribute('data-view') === view));
  $('view-title').textContent = VIEW_TITLE[view] || view;
  $('view-actions').innerHTML = '';
  if (view === 'usuarios') loadUsuarios();
  if (view === 'geracao') loadLotes();
  if (view === 'mensalidades') {
    $('view-actions').innerHTML =
      `<button id="btn-sync-r" onclick="syncRecebimentos('mensalidade')" class="bg-teal hover:bg-teal-dark text-white rounded-lg px-4 py-2 text-sm font-medium">↻ Sincronizar</button>`;
    loadMensal();
  }
  if (view === 'patronais') {
    $('view-actions').innerHTML =
      `<button id="btn-sync-r" onclick="syncRecebimentos('patronal')" class="bg-teal hover:bg-teal-dark text-white rounded-lg px-4 py-2 text-sm font-medium">↻ Sincronizar</button>`;
    loadDash('patronal');
  }
  if (view === 'empresas') {
    $('view-actions').innerHTML =
      '<button id="btn-sync" onclick="syncEmpresas()" class="bg-teal hover:bg-teal-dark text-white rounded-lg px-4 py-2 text-sm font-medium">↻ Sincronizar</button>';
    empPage = 0;
    loadEmpContadores();
    loadEmpresas();
  }
}

// ── Empresas ────────────────────────────────────────────
const EMP_PAGE_SIZE = 25;
let empPage = 0;
let empTotal = 0;

// Aplica filtro (associada/não) + busca a uma query base
function empQuery(base) {
  const filtro = $('emp-filtro').value;
  const termo = $('emp-busca').value.trim();
  if (filtro === 'assoc') base = base.eq('associado', true);
  else if (filtro === 'nao') base = base.eq('associado', false);
  if (termo) base = base.or(`razao_social.ilike.%${termo}%,cpf_cnpj.ilike.%${termo}%`);
  return base;
}

async function loadEmpContadores() {
  const totalQ = sb.from('empresas').select('*', { count: 'exact', head: true });
  const assocQ = sb.from('empresas').select('*', { count: 'exact', head: true }).eq('associado', true);
  const naoQ = sb.from('empresas').select('*', { count: 'exact', head: true }).eq('associado', false);
  const [t, a, n] = await Promise.all([totalQ, assocQ, naoQ]);
  $('emp-c-total').textContent = (t.count ?? 0).toLocaleString('pt-BR');
  $('emp-c-assoc').textContent = (a.count ?? 0).toLocaleString('pt-BR');
  $('emp-c-nao').textContent = (n.count ?? 0).toLocaleString('pt-BR');
}

async function loadEmpresas() {
  const tbody = $('empresas-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="px-5 py-6 text-center"><span class="loader"></span></td></tr>';
  const from = empPage * EMP_PAGE_SIZE;
  const to = from + EMP_PAGE_SIZE - 1;
  let q = sb.from('empresas')
    .select('razao_social, cpf_cnpj, email, celular, telefone, associado, filiado, ativo', { count: 'exact' })
    .order('razao_social', { nullsFirst: false })
    .range(from, to);
  q = empQuery(q);
  const { data, count, error } = await q;
  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-6 text-center text-red-500">${error.message}</td></tr>`; return; }
  empTotal = count ?? 0;
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="5" class="px-5 py-6 text-center text-mist">Nenhuma empresa encontrada.</td></tr>'; }
  else tbody.innerHTML = data.map((e) => {
    const contato = e.email || e.celular || e.telefone || '—';
    const cobranca = e.associado
      ? '<span class="pill pill-pago">Mensalidade</span>'
      : '<span class="pill pill-aberto">Patronal</span>';
    return `<tr class="table-row">
      <td class="px-5 py-3 text-ink">${e.razao_social || '—'}</td>
      <td class="px-5 py-3 text-mist">${e.cpf_cnpj || '—'}</td>
      <td class="px-5 py-3 text-mist">${contato}</td>
      <td class="px-5 py-3">${cobranca}</td>
      <td class="px-5 py-3">${e.ativo ? '<span class="pill pill-pago">Ativa</span>' : '<span class="pill pill-vencido">Inativa</span>'}</td>
    </tr>`;
  }).join('');
  const ini = empTotal ? from + 1 : 0;
  const fim = Math.min(to + 1, empTotal);
  $('emp-range').textContent = `${ini.toLocaleString('pt-BR')}–${fim.toLocaleString('pt-BR')} de ${empTotal.toLocaleString('pt-BR')}`;
  $('emp-prev').disabled = empPage === 0;
  $('emp-next').disabled = to + 1 >= empTotal;
}

function empPrev() { if (empPage > 0) { empPage--; loadEmpresas(); } }
function empNext() { if ((empPage + 1) * EMP_PAGE_SIZE < empTotal) { empPage++; loadEmpresas(); } }

// Sincroniza empresas com o High Gestor (chunks via Edge Function, em loop)
async function syncEmpresas() {
  const btn = $('btn-sync');
  btn.disabled = true;
  const { data: { session } } = await sb.auth.getSession();
  let offset = 0, total = 0;
  try {
    while (true) {
      btn.textContent = `↻ Sincronizando… ${total.toLocaleString('pt-BR')}`;
      const res = await fetch(`${SINDITRACK_CONFIG.supabase.url}/functions/v1/higestor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'sync-empresas', offset, pages: 10 }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || res.status);
      total += out.processadas || 0;
      if (out.next_offset == null) break;
      offset = out.next_offset;
    }
    btn.textContent = `✓ ${total.toLocaleString('pt-BR')} sincronizadas`;
    loadEmpContadores();
    loadEmpresas();
  } catch (e) {
    btn.textContent = '✕ Erro ao sincronizar';
    console.error(e);
  } finally {
    setTimeout(() => { btn.disabled = false; btn.textContent = '↻ Sincronizar'; }, 4000);
  }
}

// ── Login ───────────────────────────────────────────────
async function doLogin() {
  const email = $('login-email').value.trim();
  const pass = $('login-pass').value;
  const err = $('login-error');
  err.classList.add('hidden');
  if (!email || !pass) { err.textContent = 'Informe e-mail e senha.'; err.classList.remove('hidden'); return; }
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) { err.textContent = 'E-mail ou senha inválidos.'; err.classList.remove('hidden'); return; }
  await loadProfile(data.user);
}

// ── Usuários (admin) ────────────────────────────────────
async function loadUsuarios() {
  const tbody = $('usuarios-tbody');
  tbody.innerHTML = '<tr><td colspan="4" class="px-5 py-6 text-center"><span class="loader"></span></td></tr>';
  const { data, error } = await sb.from('usuarios')
    .select('nome, email, papel, ativo').order('created_at');
  if (error) { tbody.innerHTML = `<tr><td colspan="4" class="px-5 py-6 text-center text-red-500">${error.message}</td></tr>`; return; }
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="4" class="px-5 py-6 text-center text-mist">Nenhum usuário cadastrado.</td></tr>'; return; }
  tbody.innerHTML = data.map((u) => `
    <tr class="table-row">
      <td class="px-5 py-3 text-ink">${u.nome}</td>
      <td class="px-5 py-3 text-mist">${u.email}</td>
      <td class="px-5 py-3"><span class="papel-badge papel-${u.papel}">${PAPEL_LABEL[u.papel] || u.papel}</span></td>
      <td class="px-5 py-3">${u.ativo ? '<span class="pill pill-pago">Ativo</span>' : '<span class="pill pill-vencido">Inativo</span>'}</td>
    </tr>`).join('');
}

// Cadastro de novo usuário — chama a Edge Function add-user (criada na Fase 1).
async function abrirNovoUsuario() {
  const nome = prompt('Nome do usuário:');
  if (!nome) return;
  const email = prompt('E-mail:');
  if (!email) return;
  const papel = (prompt('Papel (admin / operador):', 'operador') || '').trim();
  if (!['admin', 'operador'].includes(papel)) { alert('Papel inválido.'); return; }
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${SINDITRACK_CONFIG.supabase.url}/functions/v1/add-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ nome, email, papel }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) { alert('Erro: ' + (out.error || res.status)); return; }
  alert(out.novo ? 'Usuário criado. Senha temporária enviada por e-mail de recuperação.' : 'Perfil atualizado.');
  loadUsuarios();
}

// ── Dashboards (mensalidade / patronal) ────────────────
const DASH = { mensalidade: { p: 'men' }, patronal: { p: 'pat' } };
const PSIZE = 25;
const ANO_CORRENTE = 2026;
let men_page = 0, pat_page = 0;
let men_escopo = 'corrente', pat_escopo = 'corrente';
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const STATUS_PILL = {
  pago: '<span class="pill pill-pago">Pago</span>',
  aberto: '<span class="pill pill-aberto">Em aberto</span>',
  vencido: '<span class="pill pill-vencido">Vencido</span>',
  cancelado: '<span class="pill" style="background:#E4ECEB;color:#5E7A78">Cancelado</span>',
  expirado: '<span class="pill" style="background:#E4ECEB;color:#5E7A78">Expirado</span>',
};
const dashPage = (t) => (t === 'mensalidade' ? men_page : pat_page);
const dashSetPage = (t, v) => { if (t === 'mensalidade') men_page = v; else pat_page = v; };
const dashEscopo = (t) => (t === 'mensalidade' ? men_escopo : pat_escopo);

const ESCOPOS = [
  ['corrente', `Corrente (${ANO_CORRENTE})`],
  ['atrasado', 'Atrasados'],
  ['todos', 'Todos'],
];
function setEscopo(tipo, esc) {
  if (tipo === 'mensalidade') men_escopo = esc; else pat_escopo = esc;
  dashSetPage(tipo, 0);
  loadDash(tipo);
}

function renderEscopo(tipo) {
  const p = DASH[tipo].p;
  $(`${p}-escopo`).innerHTML = ESCOPOS.map(([v, label]) => {
    const on = dashEscopo(tipo) === v;
    return `<button onclick="setEscopo('${tipo}','${v}')" class="px-4 py-2 ${on ? 'bg-teal text-white' : 'bg-white text-mist'} border-r border-line last:border-r-0">${label}</button>`;
  }).join('');
}

async function loadDash(tipo) {
  renderEscopo(tipo);
  loadDashResumo(tipo);
  loadDashList(tipo);
}

async function loadDashResumo(tipo) {
  const p = DASH[tipo].p;
  const { data } = await sb.rpc('resumo_por_escopo', { p_tipo: tipo, p_escopo: dashEscopo(tipo) });
  const r = data || {};
  const card = (label, qtd, valor, cls) => `<div class="bg-white rounded-xl border border-line p-4">
      <div class="text-mist text-xs uppercase tracking-wider">${label}</div>
      <div class="brand text-2xl font-semibold ${cls} mt-1">${brl(valor)}</div>
      <div class="text-mist text-xs mt-0.5">${(qtd || 0).toLocaleString('pt-BR')} boletos</div></div>`;
  $(`${p}-cards`).innerHTML =
    card('Total', r.total_qtd, r.total_valor, 'text-ink') +
    card('Pago', r.pago_qtd, r.pago_valor, 'text-teal') +
    card('Em aberto', r.aberto_qtd, r.aberto_valor, 'text-amber') +
    card('Vencido', r.vencido_qtd, r.vencido_valor, 'text-red-600');
}

async function loadDashList(tipo) {
  const p = DASH[tipo].p;
  const tbody = $(`${p}-tbody`);
  tbody.innerHTML = '<tr><td colspan="5" class="px-5 py-6 text-center"><span class="loader"></span></td></tr>';
  const escopo = dashEscopo(tipo);
  const status = $(`${p}-status`).value;
  const termo = $(`${p}-busca`).value.trim();
  const from = dashPage(tipo) * PSIZE, to = from + PSIZE - 1;
  let q = sb.from('recebimentos')
    .select('empresa_razao_social, referencia, mes_referencia, exercicio, valor, data_vencimento, status', { count: 'exact' })
    .eq('tipo', tipo)
    .order('data_vencimento', { ascending: false, nullsFirst: false })
    .range(from, to);
  if (escopo === 'corrente') q = q.eq('ano', ANO_CORRENTE);
  else if (escopo === 'atrasado') q = q.lt('ano', ANO_CORRENTE);
  if (status) q = q.eq('status', status);
  if (termo) q = q.ilike('empresa_razao_social', `%${termo}%`);
  const { data, count, error } = await q;
  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-6 text-center text-red-500">${error.message}</td></tr>`; return; }
  const total = count ?? 0;
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="5" class="px-5 py-6 text-center text-mist">Nenhum recebimento.</td></tr>'; }
  else tbody.innerHTML = data.map((x) => {
    const ref = (tipo === 'mensalidade' ? x.mes_referencia : x.exercicio) || x.referencia || '—';
    const venc = x.data_vencimento ? x.data_vencimento.split('-').reverse().join('/') : '—';
    return `<tr class="table-row">
      <td class="px-5 py-3 text-ink">${x.empresa_razao_social || '—'}</td>
      <td class="px-5 py-3 text-mist">${ref}</td>
      <td class="px-5 py-3 text-ink">${brl(x.valor)}</td>
      <td class="px-5 py-3 text-mist">${venc}</td>
      <td class="px-5 py-3">${STATUS_PILL[x.status] || x.status || '—'}</td>
    </tr>`;
  }).join('');
  const ini = total ? from + 1 : 0, fim = Math.min(to + 1, total);
  $(`${p}-range`).textContent = `${ini.toLocaleString('pt-BR')}–${fim.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')}`;
  $(`${p}-prev`).disabled = dashPage(tipo) === 0;
  $(`${p}-next`).disabled = to + 1 >= total;
}

function dashPrev(tipo) { if (dashPage(tipo) > 0) { dashSetPage(tipo, dashPage(tipo) - 1); loadDashList(tipo); } }
function dashNext(tipo) { dashSetPage(tipo, dashPage(tipo) + 1); loadDashList(tipo); }

// Sincroniza recebimentos com o High Gestor (chunks via Edge Function, em loop)
async function syncRecebimentos(tipo) {
  const btn = $('btn-sync-r');
  btn.disabled = true;
  const cobranca = tipo === 'mensalidade' ? null : null; // sync completo (cobre todos os tipos)
  const { data: { session } } = await sb.auth.getSession();
  let offset = 0, total = 0;
  try {
    while (true) {
      btn.textContent = `↻ Sincronizando… ${total.toLocaleString('pt-BR')}`;
      const res = await fetch(`${SINDITRACK_CONFIG.supabase.url}/functions/v1/higestor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'sync-recebimentos', offset, pages: 10, cobranca }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || res.status);
      total += out.processadas || 0;
      if (out.next_offset == null) break;
      offset = out.next_offset;
    }
    btn.textContent = `✓ ${total.toLocaleString('pt-BR')} sincronizados`;
    loadDash(tipo);
  } catch (e) {
    btn.textContent = '✕ Erro ao sincronizar';
    console.error(e);
  } finally {
    setTimeout(() => { btn.disabled = false; btn.textContent = '↻ Sincronizar'; }, 4000);
  }
}

// ── Geração de boletos (Fase 3 + envio Fase 4) ──────────
async function callFn(payload) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${SINDITRACK_CONFIG.supabase.url}/functions/v1/higestor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(payload),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || res.status);
  return out;
}

function gerTipoChange() {
  const t = $('ger-tipo').value;
  $('ger-comp-ano').classList.toggle('hidden', t !== 'patronal');
  $('ger-comp-mes').classList.toggle('hidden', t !== 'mensalidade');
}

async function montarLote() {
  const tipo = $('ger-tipo').value;
  const venc = $('ger-venc').value;
  const msg = $('ger-msg');
  if (!venc) { msg.innerHTML = '<span class="text-red-500">Informe a data de vencimento.</span>'; return; }
  let competencia;
  if (tipo === 'patronal') competencia = $('ger-exercicio').value.trim();
  else {
    const m = $('ger-mes').value; // 'YYYY-MM'
    if (!m) { msg.innerHTML = '<span class="text-red-500">Informe o mês.</span>'; return; }
    const [y, mm] = m.split('-'); competencia = `${mm}/${y}`;
  }
  msg.innerHTML = '<span class="loader"></span> Montando…';
  const { data, error } = await sb.rpc('montar_lote', { p_tipo: tipo, p_competencia: competencia, p_data_vencimento: venc });
  if (error) { msg.innerHTML = `<span class="text-red-500">${error.message}</span>`; return; }
  msg.innerHTML = `<span class="text-teal">✓ Rascunho pronto: ${data.total_itens.toLocaleString('pt-BR')} boletos de ${Number(data.valor_unitario).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.</span>`;
  loadLotes();
}

async function loadLotes() {
  const tbody = $('lotes-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="px-5 py-6 text-center"><span class="loader"></span></td></tr>';
  const { data, error } = await sb.from('lotes')
    .select('id, tipo, competencia, status, total_itens').order('created_at', { ascending: false });
  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-6 text-center text-red-500">${error.message}</td></tr>`; return; }
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="5" class="px-5 py-6 text-center text-mist">Nenhum lote ainda.</td></tr>'; return; }
  const STAT = {
    rascunho: '<span class="pill pill-aberto">Rascunho</span>',
    aprovado: '<span class="pill" style="background:#D9E7FB;color:#1B5FB0">Aprovado</span>',
    gerado: '<span class="pill pill-pago">Gerado</span>',
    cancelado: '<span class="pill pill-vencido">Cancelado</span>',
  };
  tbody.innerHTML = data.map((l) => {
    let acoes = '';
    if (l.status === 'rascunho') acoes = `<button onclick="aprovarGerar('${l.id}')" class="bg-teal hover:bg-teal-dark text-white rounded-lg px-3 py-1.5 text-xs font-medium">Aprovar e emitir</button>`;
    else if (l.status === 'aprovado') acoes = `<button onclick="gerarLote('${l.id}')" class="bg-teal hover:bg-teal-dark text-white rounded-lg px-3 py-1.5 text-xs font-medium">Continuar emissão</button>`;
    else if (l.status === 'gerado') acoes = `<button onclick="enviarLote('${l.id}')" class="bg-amber hover:bg-amber-light text-white rounded-lg px-3 py-1.5 text-xs font-medium">Enviar boletos</button>`;
    return `<tr class="table-row">
      <td class="px-5 py-3 text-ink">${l.tipo === 'patronal' ? 'Patronal' : 'Mensalidade'}</td>
      <td class="px-5 py-3 text-mist">${l.competencia}</td>
      <td class="px-5 py-3 text-ink">${(l.total_itens || 0).toLocaleString('pt-BR')}</td>
      <td class="px-5 py-3">${STAT[l.status] || l.status}</td>
      <td class="px-5 py-3 text-right">${acoes}</td>
    </tr>`;
  }).join('');
}

async function aprovarGerar(loteId) {
  if (!confirm('Isso vai EMITIR os boletos no High Gestor (ação real). Confirmar?')) return;
  const { error } = await sb.rpc('aprovar_lote', { p_lote_id: loteId });
  if (error) { alert('Erro ao aprovar: ' + error.message); return; }
  gerarLote(loteId);
}

async function gerarLote(loteId) {
  const prog = $('ger-prog');
  prog.classList.remove('hidden');
  let gerados = 0, erros = 0;
  try {
    while (true) {
      const out = await callFn({ action: 'gerar-lote', lote_id: loteId, batch: 50 });
      gerados += out.gerados; erros += out.erros;
      prog.innerHTML = `Emitindo… <b>${gerados.toLocaleString('pt-BR')}</b> gerados, ${erros} erros, ${out.restantes.toLocaleString('pt-BR')} restantes.`;
      if (out.restantes === 0) break;
    }
    prog.innerHTML = `✓ Lote emitido: <b>${gerados.toLocaleString('pt-BR')}</b> boletos${erros ? `, ${erros} com erro` : ''}.`;
    loadLotes();
  } catch (e) {
    prog.innerHTML = `<span class="text-red-500">Erro na emissão: ${e.message}</span> (${gerados} já gerados — dá pra continuar)`;
    loadLotes();
  }
}

// Canais de envio ativos. WhatsApp desligado por ora (números frios → erro 463);
// religar é só incluir 'whatsapp' aqui.
const CANAIS_ENVIO = ['email'];

async function enviarLote(loteId) {
  if (!confirm('Enviar o boleto por e-mail para todos os itens gerados deste lote?')) return;
  const prog = $('ger-prog');
  prog.classList.remove('hidden');
  const { data: itens, error } = await sb.from('lote_itens')
    .select('recebimento_id').eq('lote_id', loteId).eq('status', 'gerado').not('recebimento_id', 'is', null);
  if (error) { prog.innerHTML = `<span class="text-red-500">${error.message}</span>`; return; }
  let ok = 0, falha = 0;
  for (let i = 0; i < itens.length; i++) {
    try {
      const out = await callFn({ action: 'enviar-boleto', recebimento_id: itens[i].recebimento_id, canais: CANAIS_ENVIO });
      out.ok ? ok++ : falha++;
    } catch { falha++; }
    if (i % 10 === 0 || i === itens.length - 1)
      prog.innerHTML = `Enviando… ${i + 1}/${itens.length} — ${ok} ok, ${falha} falha.`;
  }
  prog.innerHTML = `✓ Envio concluído: ${ok} enviados, ${falha} falhas.`;
}

// ── Mensalidades — visão mensal (linha do tempo 12 meses) ──
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_LONGO = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
let men_ano = ANO_CORRENTE;
let men_mes = null;        // null = ano todo; 1-12 = mês selecionado
let men_dados = [];        // resumo por mês do ano selecionado

async function loadMensal() {
  // popula o seletor de ano (uma vez)
  const selAno = $('men-ano');
  if (selAno.dataset.loaded !== '1') {
    const { data } = await sb.rpc('anos_mensalidade');
    const anos = (data || []).map((r) => r.ano);
    if (!anos.includes(ANO_CORRENTE)) anos.unshift(ANO_CORRENTE);
    selAno.innerHTML = anos.map((a) => `<option value="${a}">${a}</option>`).join('');
    selAno.value = String(men_ano);
    selAno.dataset.loaded = '1';
  }
  men_ano = Number(selAno.value);
  // dados mensais
  const { data } = await sb.rpc('resumo_mensal', { p_ano: men_ano });
  men_dados = Array.from({ length: 12 }, (_, i) => {
    const r = (data || []).find((x) => x.mes === i + 1);
    return r || { mes: i + 1, total_qtd: 0, total_valor: 0, pago_qtd: 0, pago_valor: 0, aberto_qtd: 0, aberto_valor: 0, vencido_qtd: 0, vencido_valor: 0 };
  });
  renderTimeline();
  loadMensalDetalhe();
}

function renderTimeline() {
  $('men-timeline').innerHTML = men_dados.map((m) => {
    const sel = men_mes === m.mes;
    const temVencido = m.vencido_qtd > 0;
    const borda = sel ? 'border-teal ring-2 ring-teal/30' : (temVencido ? 'border-red-200' : 'border-line');
    return `<button onclick="selMes(${m.mes})" class="text-left bg-white border ${borda} rounded-xl p-3 hover:border-teal transition-colors">
      <div class="flex items-center justify-between">
        <span class="brand font-semibold text-ink">${MESES[m.mes - 1]}</span>
        <span class="text-mist text-xs">${m.total_qtd}</span>
      </div>
      <div class="mt-2 flex gap-1 h-1.5 rounded-full overflow-hidden bg-cream">
        <div style="width:${pct(m.pago_qtd, m.total_qtd)}%" class="bg-teal"></div>
        <div style="width:${pct(m.aberto_qtd, m.total_qtd)}%" class="bg-amber"></div>
        <div style="width:${pct(m.vencido_qtd, m.total_qtd)}%" class="bg-red-500"></div>
      </div>
      <div class="mt-2 text-xs text-mist">${m.pago_qtd} pg · ${m.vencido_qtd} vc</div>
    </button>`;
  }).join('');
}
const pct = (n, t) => (t ? (n / t) * 100 : 0);

function selMes(m) {
  men_mes = (men_mes === m ? null : m);  // clicar de novo desmarca
  men_page = 0;
  renderTimeline();
  loadMensalDetalhe();
}

function loadMensalDetalhe() {
  $('men-anotodo').classList.toggle('hidden', men_mes === null);
  $('men-detalhe-titulo').textContent = men_mes
    ? `${MESES_LONGO[men_mes - 1]} de ${men_ano}` : `Ano de ${men_ano} (todos os meses)`;
  // cards: mês selecionado, ou soma do ano
  let r;
  if (men_mes) r = men_dados[men_mes - 1];
  else r = men_dados.reduce((a, m) => ({
    total_qtd: a.total_qtd + m.total_qtd, total_valor: a.total_valor + Number(m.total_valor),
    pago_qtd: a.pago_qtd + m.pago_qtd, pago_valor: a.pago_valor + Number(m.pago_valor),
    aberto_qtd: a.aberto_qtd + m.aberto_qtd, aberto_valor: a.aberto_valor + Number(m.aberto_valor),
    vencido_qtd: a.vencido_qtd + m.vencido_qtd, vencido_valor: a.vencido_valor + Number(m.vencido_valor),
  }), { total_qtd: 0, total_valor: 0, pago_qtd: 0, pago_valor: 0, aberto_qtd: 0, aberto_valor: 0, vencido_qtd: 0, vencido_valor: 0 });
  const card = (label, qtd, valor, cls) => `<div class="bg-white rounded-xl border border-line p-4">
      <div class="text-mist text-xs uppercase tracking-wider">${label}</div>
      <div class="brand text-2xl font-semibold ${cls} mt-1">${brl(valor)}</div>
      <div class="text-mist text-xs mt-0.5">${(qtd || 0).toLocaleString('pt-BR')} boletos</div></div>`;
  $('men-cards').innerHTML =
    card('Total', r.total_qtd, r.total_valor, 'text-ink') +
    card('Pago', r.pago_qtd, r.pago_valor, 'text-teal') +
    card('Em aberto', r.aberto_qtd, r.aberto_valor, 'text-amber') +
    card('Vencido', r.vencido_qtd, r.vencido_valor, 'text-red-600');
  loadMensalLista();
}

async function loadMensalLista() {
  const tbody = $('men-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="px-5 py-6 text-center"><span class="loader"></span></td></tr>';
  const status = $('men-status').value;
  const termo = $('men-busca').value.trim();
  const from = men_page * PSIZE, to = from + PSIZE - 1;
  let q = sb.from('recebimentos')
    .select('empresa_razao_social, referencia, mes_referencia, valor, data_vencimento, status', { count: 'exact' })
    .eq('tipo', 'mensalidade').eq('ano', men_ano)
    .order('data_vencimento', { ascending: false, nullsFirst: false })
    .range(from, to);
  if (men_mes) q = q.eq('mes_referencia', `${String(men_mes).padStart(2, '0')}/${men_ano}`);
  if (status) q = q.eq('status', status);
  if (termo) q = q.ilike('empresa_razao_social', `%${termo}%`);
  const { data, count, error } = await q;
  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-6 text-center text-red-500">${error.message}</td></tr>`; return; }
  const total = count ?? 0;
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="5" class="px-5 py-6 text-center text-mist">Nenhuma mensalidade.</td></tr>'; }
  else tbody.innerHTML = data.map((x) => {
    const venc = x.data_vencimento ? x.data_vencimento.split('-').reverse().join('/') : '—';
    return `<tr class="table-row">
      <td class="px-5 py-3 text-ink">${x.empresa_razao_social || '—'}</td>
      <td class="px-5 py-3 text-mist">${x.mes_referencia || x.referencia || '—'}</td>
      <td class="px-5 py-3 text-ink">${brl(x.valor)}</td>
      <td class="px-5 py-3 text-mist">${venc}</td>
      <td class="px-5 py-3">${STATUS_PILL[x.status] || x.status || '—'}</td>
    </tr>`;
  }).join('');
  const ini = total ? from + 1 : 0, fim = Math.min(to + 1, total);
  $('men-range').textContent = `${ini.toLocaleString('pt-BR')}–${fim.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')}`;
  $('men-prev').disabled = men_page === 0;
  $('men-next').disabled = to + 1 >= total;
}
function menPrev() { if (men_page > 0) { men_page--; loadMensalLista(); } }
function menNext() { men_page++; loadMensalLista(); }

checkSession();
