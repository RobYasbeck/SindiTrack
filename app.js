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
