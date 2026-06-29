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

checkSession();
