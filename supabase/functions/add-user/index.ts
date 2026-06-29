// SindiTrack — cadastro de usuário do painel (papéis admin / operador).
// Bootstrap: enquanto a tabela `usuarios` está vazia, a 1ª chamada cria o primeiro
// admin SEM exigir autenticação (resolve o ovo-galinha do primeiro acesso). Depois
// disso, só um admin autenticado pode criar/atualizar usuários.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const PAPEIS = ['admin', 'operador'];
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const admin = createClient(url, service);

    // A tabela está vazia? Então estamos no bootstrap do primeiro admin.
    const { count } = await admin.from('usuarios').select('*', { count: 'exact', head: true });
    const bootstrap = (count ?? 0) === 0;

    let papelForcado: string | null = null;
    if (bootstrap) {
      papelForcado = 'admin'; // o primeiro usuário é sempre admin
    } else {
      // fluxo normal: exige admin ativo
      const authHeader = req.headers.get('Authorization') ?? '';
      const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await asUser.auth.getUser();
      if (!user) return json({ error: 'Não autenticado' }, 401);
      const { data: me } = await admin.from('usuarios')
        .select('papel, ativo').eq('user_id', user.id).maybeSingle();
      if (!me || !me.ativo || me.papel !== 'admin')
        return json({ error: 'Sem permissão' }, 403);
    }

    const { nome, email, papel, senha } = await req.json();
    const papelFinal = papelForcado ?? papel;
    if (!nome || !email || !PAPEIS.includes(papelFinal))
      return json({ error: 'Dados inválidos' }, 400);

    // Encontra o login existente ou cria um novo
    let targetId: string | undefined;
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = list?.users?.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase());
    if (found) {
      targetId = found.id;
      if (senha) await admin.auth.admin.updateUserById(found.id, { password: senha });
    } else {
      const pass = senha || (crypto.randomUUID() + 'Aa1!');
      const { data: created, error: cerr } = await admin.auth.admin.createUser({
        email, password: pass, email_confirm: true,
      });
      if (cerr || !created?.user) return json({ error: 'Erro ao criar login: ' + (cerr?.message ?? '') }, 400);
      targetId = created.user.id;
    }

    const { error: ierr } = await admin.from('usuarios')
      .upsert({ user_id: targetId, nome, email, papel: papelFinal, ativo: true }, { onConflict: 'user_id' });
    if (ierr) return json({ error: ierr.message }, 400);

    return json({ ok: true, novo: !found, bootstrap });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
