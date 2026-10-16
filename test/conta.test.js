import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { tratar } from '../worker/src/index.js';
import { lerJwt } from '../worker/src/conta.js';

// D1 de mentira em cima do SQLite do Node: mesmas consultas SQL que rodam no Cloudflare
class D1Falso {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) {
    const db = this.db;
    let cache = null;
    const st = new Proxy({}, { get: (_, k) => (...a) => (cache ||= db.prepare(sql))[k](...a) }); // prepara só ao executar, como o D1
    const preparado = {
      args: [],
      bind(...a) { return { ...preparado, args: a }; },
      async first() { return st.get(...this.args) ?? null; },
      async all() { return { results: st.all(...this.args) }; },
      async run() { st.run(...this.args); return { success: true }; },
    };
    return preparado;
  }
  async batch(lista) { const r = []; for (const s of lista) r.push(await s.run()); return r; }
}
class KVFalso {
  constructor() { this.m = new Map(); }
  async get(k, tipo) { const v = this.m.get(k); return v == null ? null : tipo === 'json' ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (dados) => `${b64({ alg: 'RS256' })}.${b64(dados)}.assinatura`;

function ambiente() {
  return { GOOGLE_CLIENT_ID: 'cliente.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'SEGREDO-GOOGLE', DB: new D1Falso(), TOKENS: new KVFalso(), ORIGENS_APP: 'https://minhas-compras.marlenildo.online' };
}
const APP = 'https://minhas-compras.marlenildo.online/app/';
const API = 'https://api.exemplo';

function googleFalso(perfil) {
  const f = async (url, opcoes) => {
    f.chamadas.push({ url: String(url), corpo: String(opcoes?.body || '') });
    return new Response(JSON.stringify({ id_token: jwt(perfil), access_token: 'x' }), { status: 200 });
  };
  f.chamadas = [];
  return f;
}

const perfilPadrao = () => ({
  iss: 'https://accounts.google.com', aud: 'cliente.apps.googleusercontent.com', sub: '1234567890', email: 'pessoa@exemplo.com',
  email_verified: true, name: 'Ana Souza', picture: 'https://foto/ana.jpg', exp: Math.floor(Date.now() / 1000) + 3600,
});

/** Faz o login completo e devolve a sessão. */
async function entrar(env, perfil = perfilPadrao()) {
  const r1 = await tratar(new Request(`${API}/api/auth/google?volta=${encodeURIComponent(APP)}`), env, {}, googleFalso(perfil));
  assert.equal(r1.status, 302);
  const google = new URL(r1.headers.get('location'));
  const estado = google.searchParams.get('state');
  const f = googleFalso(perfil);
  const r2 = await tratar(new Request(`${API}/api/auth/google/retorno?code=CODIGO-GOOGLE&state=${estado}`), env, {}, f);
  assert.equal(r2.status, 302);
  const volta = r2.headers.get('location');
  const codigo = new URL(volta).hash.match(/login=([\w-]+)/)?.[1];
  const r3 = await tratar(new Request(`${API}/api/auth/trocar`, { method: 'POST', body: JSON.stringify({ codigo }) }), env, {}, f);
  assert.equal(r3.status, 200);
  return { ...(await r3.json()), volta, google, chamadaToken: f.chamadas[0] };
}

const comSessao = (sessao, extra = {}) => ({ ...extra, headers: { authorization: `Bearer ${sessao}`, ...(extra.headers || {}) } });

test('lê o conteúdo do id_token, com acentos', () => {
  assert.equal(lerJwt(jwt({ name: 'João Ávila' })).name, 'João Ávila');
  assert.equal(lerJwt('lixo'), null);
});

test('sem configuração, a conta explica o que falta', async () => {
  const r = await tratar(new Request(`${API}/api/conta`), { TOKENS: new KVFalso() }, {}, googleFalso({}));
  assert.equal(r.status, 503);
  assert.match((await r.json()).erro, /GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET.*DB/);
});

test('login completo com Google cria a conta e a sessão', async () => {
  const env = ambiente();
  const { sessao, usuario, volta, google, chamadaToken } = await entrar(env);
  assert.equal(google.host, 'accounts.google.com');
  assert.equal(google.searchParams.get('scope'), 'openid email profile');
  assert.equal(google.searchParams.get('redirect_uri'), `${API}/api/auth/google/retorno`);
  assert.ok(volta.startsWith(`${APP}#login=`));
  assert.match(chamadaToken.corpo, /grant_type=authorization_code/);
  assert.equal(usuario.nome, 'Ana Souza');
  assert.ok(sessao.length > 30);

  const r = await tratar(new Request(`${API}/api/conta`, comSessao(sessao)), env, {}, googleFalso({}));
  const j = await r.json();
  assert.equal(j.usuario.email, 'pessoa@exemplo.com');
  assert.equal(j.dados, null);

  // A sessão não fica guardada em texto no banco
  const linhas = env.DB.db.prepare('SELECT token_hash FROM sessoes').all();
  assert.ok(linhas.every((l) => l.token_hash !== sessao));
});

test('o código de login só vale uma vez', async () => {
  const env = ambiente();
  const perfil = perfilPadrao();
  const r1 = await tratar(new Request(`${API}/api/auth/google?volta=${encodeURIComponent(APP)}`), env, {}, googleFalso(perfil));
  const estado = new URL(r1.headers.get('location')).searchParams.get('state');
  const r2 = await tratar(new Request(`${API}/api/auth/google/retorno?code=X&state=${estado}`), env, {}, googleFalso(perfil));
  const codigo = new URL(r2.headers.get('location')).hash.split('=')[1];
  const pedir = () => tratar(new Request(`${API}/api/auth/trocar`, { method: 'POST', body: JSON.stringify({ codigo }) }), env, {}, googleFalso({}));
  assert.equal((await pedir()).status, 200);
  assert.equal((await pedir()).status, 401);
  // E o "state" do Google também
  const r3 = await tratar(new Request(`${API}/api/auth/google/retorno?code=X&state=${estado}`), env, {}, googleFalso(perfil));
  assert.equal(r3.status, 400);
});

test('não manda a pessoa para um site estranho', async () => {
  const env = ambiente();
  const r = await tratar(new Request(`${API}/api/auth/google?volta=${encodeURIComponent('https://site-malicioso.com/')}`), env, {}, googleFalso({}));
  assert.equal(r.status, 400);
});

test('recusa id_token de outro aplicativo', async () => {
  const env = ambiente();
  const r1 = await tratar(new Request(`${API}/api/auth/google?volta=${encodeURIComponent(APP)}`), env, {}, googleFalso({}));
  const estado = new URL(r1.headers.get('location')).searchParams.get('state');
  const r2 = await tratar(new Request(`${API}/api/auth/google/retorno?code=X&state=${estado}`), env, {}, googleFalso({ ...perfilPadrao(), aud: 'outro-app' }));
  assert.equal(r2.headers.get('location'), `${APP}#login_erro=google`);
});

test('a mesma pessoa entrando de novo usa a mesma conta', async () => {
  const env = ambiente();
  const a = await entrar(env);
  const b = await entrar(env, { ...perfilPadrao(), name: 'Ana S.' });
  assert.equal(a.usuario.id, b.usuario.id);
  assert.equal(b.usuario.nome, 'Ana S.');
});

test('dados com versão: o segundo aparelho recebe 409 e o conteúdo atual', async () => {
  const env = ambiente();
  const { sessao } = await entrar(env);
  const put = (corpo) =>
    tratar(new Request(`${API}/api/conta/dados`, comSessao(sessao, { method: 'PUT', body: JSON.stringify(corpo) })), env, {}, googleFalso({}));

  const r1 = await put({ versaoBase: 0, conteudo: { salvos: { a: 1 } } });
  assert.deepEqual([r1.status, (await r1.json()).versao], [200, 1]);

  const r2 = await put({ versaoBase: 0, conteudo: { salvos: { b: 1 } } }); // aparelho desatualizado
  assert.equal(r2.status, 409);
  const j2 = await r2.json();
  assert.deepEqual([j2.versao, j2.conteudo], [1, { salvos: { a: 1 } }]);

  const r3 = await put({ versaoBase: 1, conteudo: { salvos: { a: 1, b: 1 } } });
  assert.equal((await r3.json()).versao, 2);

  const conta = await (await tratar(new Request(`${API}/api/conta`, comSessao(sessao)), env, {}, googleFalso({}))).json();
  assert.deepEqual(conta.dados.conteudo, { salvos: { a: 1, b: 1 } });
});

test('sair encerra a sessão; apagar conta apaga tudo', async () => {
  const env = ambiente();
  const a = await entrar(env);
  const b = await entrar(env);
  await tratar(new Request(`${API}/api/conta/dados`, comSessao(a.sessao, { method: 'PUT', body: JSON.stringify({ versaoBase: 0, conteudo: { x: 1 } }) })), env, {}, googleFalso({}));

  const sair = await tratar(new Request(`${API}/api/auth/sair`, comSessao(a.sessao, { method: 'POST' })), env, {}, googleFalso({}));
  assert.equal(sair.status, 200);
  assert.equal((await tratar(new Request(`${API}/api/conta`, comSessao(a.sessao)), env, {}, googleFalso({}))).status, 401);
  assert.equal((await tratar(new Request(`${API}/api/conta`, comSessao(b.sessao)), env, {}, googleFalso({}))).status, 200);

  const apagar = await tratar(new Request(`${API}/api/conta`, comSessao(b.sessao, { method: 'DELETE' })), env, {}, googleFalso({}));
  assert.equal(apagar.status, 200);
  for (const t of ['usuarios', 'sessoes', 'dados']) assert.equal(env.DB.db.prepare(`SELECT count(*) n FROM ${t}`).get().n, 0);
});

test('sem sessão, a conta responde 401', async () => {
  const r = await tratar(new Request(`${API}/api/conta`), ambiente(), {}, googleFalso({}));
  assert.equal(r.status, 401);
});
