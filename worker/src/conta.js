// Conta da pessoa: entrar com Google, sessão, dados salvos (favoritos, listas, preferências).
// Banco: Cloudflare D1 (binding DB). Códigos de uso único e "state" do login: KV (binding TOKENS).
//
// Fluxo de login:
//  1. app abre  /api/auth/google?volta=<endereço do app>
//  2. Google volta em /api/auth/google/retorno → o servidor cria a conta (se for nova) e um código
//     de uso único (2 min), e manda a pessoa de volta para  <app>#login=<código>
//  3. app troca o código por uma sessão:  POST /api/auth/trocar  { codigo }  → { sessao, usuario }
//  4. app usa  Authorization: Bearer <sessao>  em /api/conta e /api/conta/dados

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const SESSAO_DIAS = 90;
const LIMITE_DADOS = 300_000; // caracteres de JSON por conta

const ESQUEMA = [
  'CREATE TABLE IF NOT EXISTS usuarios (id TEXT PRIMARY KEY, google_sub TEXT UNIQUE NOT NULL, email TEXT, nome TEXT, foto TEXT, criado_em INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS sessoes (token_hash TEXT PRIMARY KEY, usuario_id TEXT NOT NULL, criada_em INTEGER NOT NULL, expira_em INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS sessoes_usuario ON sessoes (usuario_id)',
  'CREATE TABLE IF NOT EXISTS dados (usuario_id TEXT PRIMARY KEY, conteudo TEXT NOT NULL, versao INTEGER NOT NULL, atualizado_em INTEGER NOT NULL)',
];
const bancosPreparados = new WeakSet();

async function prepararBanco(db) {
  if (bancosPreparados.has(db)) return;
  await db.batch(ESQUEMA.map((sql) => db.prepare(sql)));
  bancosPreparados.add(db);
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const aleatorio = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function sha256(texto) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Lê o conteúdo de um JWT (o id_token veio direto do Google por HTTPS, com a nossa chave secreta). */
export function lerJwt(jwt) {
  const parte = String(jwt || '').split('.')[1];
  if (!parte) return null;
  const base64 = parte.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parte.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (_) {
    return null;
  }
}

class ErroConta extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.status = status;
  }
}

/** Endereços do app para onde o login pode voltar (evita mandar a pessoa para um site estranho). */
function origensDoApp(env, url) {
  const lista = String(env.ORIGENS_APP || 'https://minhas-compras.marlenildo.online')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...lista, url.origin]);
}

function voltaPermitida(volta, env, url) {
  try {
    const u = new URL(volta);
    return origensDoApp(env, url).has(u.origin) ? `${u.origin}${u.pathname}` : null;
  } catch (_) {
    return null;
  }
}

function faltaConfiguracao(env) {
  const faltam = [];
  if (!env.GOOGLE_CLIENT_ID) faltam.push('GOOGLE_CLIENT_ID');
  if (!env.GOOGLE_CLIENT_SECRET) faltam.push('GOOGLE_CLIENT_SECRET');
  if (!env.DB) faltam.push('banco D1 com o nome DB');
  if (!env.TOKENS) faltam.push('KV com o nome TOKENS');
  return faltam;
}

// ---------------------------------------------------------------------------
// Banco
// ---------------------------------------------------------------------------

async function salvarUsuarioGoogle(db, perfil) {
  const atual = await db.prepare('SELECT id FROM usuarios WHERE google_sub = ?').bind(perfil.sub).first();
  if (atual) {
    await db
      .prepare('UPDATE usuarios SET email = ?, nome = ?, foto = ? WHERE id = ?')
      .bind(perfil.email || null, perfil.name || null, perfil.picture || null, atual.id)
      .run();
    return atual.id;
  }
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO usuarios (id, google_sub, email, nome, foto, criado_em) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, perfil.sub, perfil.email || null, perfil.name || null, perfil.picture || null, Date.now())
    .run();
  return id;
}

async function criarSessao(db, usuarioId) {
  const token = aleatorio(32);
  const agora = Date.now();
  await db
    .prepare('INSERT INTO sessoes (token_hash, usuario_id, criada_em, expira_em) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), usuarioId, agora, agora + SESSAO_DIAS * 86400_000)
    .run();
  return token;
}

const publico = (u) => ({ id: u.id, nome: u.nome, email: u.email, foto: u.foto });

/** Usuário da sessão no cabeçalho Authorization, ou null. */
async function usuarioDaSessao(req, db) {
  const m = (req.headers.get('authorization') || '').match(/^Bearer\s+([\w-]{20,})$/);
  if (!m) return null;
  const linha = await db
    .prepare(
      'SELECT u.id, u.nome, u.email, u.foto, s.token_hash FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ? AND s.expira_em > ?'
    )
    .bind(await sha256(m[1]), Date.now())
    .first();
  return linha || null;
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

const json = (dados, status, cabecalhos) =>
  new Response(JSON.stringify(dados), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cabecalhos } });

const ROTAS = new Set(['/api/auth/google', '/api/auth/google/retorno', '/api/auth/trocar', '/api/auth/sair', '/api/conta', '/api/conta/dados']);

/** Trata as rotas de conta; devolve null se o endereço não for de conta. */
export async function tratarConta(req, env, url, fetcher = fetch, cabecalhos = {}) {
  if (!ROTAS.has(url.pathname)) return null;
  const faltam = faltaConfiguracao(env);
  if (faltam.length) return json({ erro: `A conta ainda não está configurada no servidor. Falta: ${faltam.join(', ')}.` }, 503, cabecalhos);

  try {
    await prepararBanco(env.DB);
    const redirectUri = `${url.origin}/api/auth/google/retorno`;

    // 1. Começa o login com Google
    if (url.pathname === '/api/auth/google' && req.method === 'GET') {
      const volta = voltaPermitida(url.searchParams.get('volta') || '', env, url);
      if (!volta) throw new ErroConta('Endereço de volta não permitido.', 400);
      const estado = aleatorio(24);
      await env.TOKENS.put(`oauth:${estado}`, volta, { expirationTtl: 600 });
      const destino = `${GOOGLE_AUTH}?${new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state: estado,
        prompt: 'select_account',
      })}`;
      return Response.redirect(destino, 302);
    }

    // 2. Volta do Google
    if (url.pathname === '/api/auth/google/retorno' && req.method === 'GET') {
      const estado = url.searchParams.get('state') || '';
      const volta = estado ? await env.TOKENS.get(`oauth:${estado}`) : null;
      if (!volta) throw new ErroConta('Este login venceu. Volte ao app e toque em “Entrar com Google” de novo.', 400);
      await env.TOKENS.delete(`oauth:${estado}`);
      if (url.searchParams.get('error')) return Response.redirect(`${volta}#login_erro=cancelado`, 302);

      const r = await fetcher(GOOGLE_TOKEN, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({
          code: url.searchParams.get('code') || '',
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      const j = await r.json().catch(() => null);
      const perfil = lerJwt(j?.id_token);
      const valido =
        r.ok &&
        perfil &&
        perfil.aud === env.GOOGLE_CLIENT_ID &&
        ['accounts.google.com', 'https://accounts.google.com'].includes(perfil.iss) &&
        perfil.exp * 1000 > Date.now() &&
        perfil.sub &&
        perfil.email_verified !== false;
      if (!valido) return Response.redirect(`${volta}#login_erro=google`, 302);

      const usuarioId = await salvarUsuarioGoogle(env.DB, perfil);
      const codigo = aleatorio(24);
      await env.TOKENS.put(`login:${await sha256(codigo)}`, usuarioId, { expirationTtl: 120 });
      return Response.redirect(`${volta}#login=${codigo}`, 302);
    }

    // 3. Troca o código de uso único por uma sessão
    if (url.pathname === '/api/auth/trocar' && req.method === 'POST') {
      const corpo = await req.json().catch(() => ({}));
      const chave = `login:${await sha256(String(corpo.codigo || ''))}`;
      const usuarioId = await env.TOKENS.get(chave);
      if (!usuarioId) throw new ErroConta('Este código de login venceu. Entre de novo.', 401);
      await env.TOKENS.delete(chave);
      const sessao = await criarSessao(env.DB, usuarioId);
      const u = await env.DB.prepare('SELECT id, nome, email, foto FROM usuarios WHERE id = ?').bind(usuarioId).first();
      return json({ sessao, usuario: publico(u) }, 200, cabecalhos);
    }

    // Daqui para baixo, precisa estar logado
    const usuario = await usuarioDaSessao(req, env.DB);
    if (!usuario) return json({ erro: 'Sua sessão terminou. Entre de novo.' }, 401, cabecalhos);

    if (url.pathname === '/api/auth/sair' && req.method === 'POST') {
      await env.DB.prepare('DELETE FROM sessoes WHERE token_hash = ?').bind(usuario.token_hash).run();
      return json({ ok: true }, 200, cabecalhos);
    }

    if (url.pathname === '/api/conta' && req.method === 'GET') {
      const d = await env.DB.prepare('SELECT conteudo, versao, atualizado_em FROM dados WHERE usuario_id = ?').bind(usuario.id).first();
      return json(
        { usuario: publico(usuario), dados: d ? { conteudo: JSON.parse(d.conteudo), versao: d.versao, atualizadoEm: d.atualizado_em } : null },
        200,
        cabecalhos
      );
    }

    if (url.pathname === '/api/conta' && req.method === 'DELETE') {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM dados WHERE usuario_id = ?').bind(usuario.id),
        env.DB.prepare('DELETE FROM sessoes WHERE usuario_id = ?').bind(usuario.id),
        env.DB.prepare('DELETE FROM usuarios WHERE id = ?').bind(usuario.id),
      ]);
      return json({ ok: true, apagada: true }, 200, cabecalhos);
    }

    // Guarda os dados. "versaoBase" é a versão que o aparelho tinha: se outro aparelho salvou antes,
    // devolve 409 com o que está no banco, para o app juntar e mandar de novo.
    if (url.pathname === '/api/conta/dados' && req.method === 'PUT') {
      const texto = await req.text();
      if (texto.length > LIMITE_DADOS) throw new ErroConta('Seus salvos passaram do limite. Apague alguns e tente de novo.', 413);
      let corpo;
      try {
        corpo = JSON.parse(texto);
      } catch (_) {
        throw new ErroConta('Dados inválidos.', 400);
      }
      if (!corpo || typeof corpo.conteudo !== 'object') throw new ErroConta('Dados inválidos.', 400);
      const atual = await env.DB.prepare('SELECT conteudo, versao FROM dados WHERE usuario_id = ?').bind(usuario.id).first();
      const versaoAtual = atual?.versao || 0;
      if ((corpo.versaoBase || 0) !== versaoAtual) {
        return json({ erro: 'conflito', conteudo: atual ? JSON.parse(atual.conteudo) : null, versao: versaoAtual }, 409, cabecalhos);
      }
      const nova = versaoAtual + 1;
      const agora = Date.now();
      await env.DB
        .prepare(
          'INSERT INTO dados (usuario_id, conteudo, versao, atualizado_em) VALUES (?, ?, ?, ?) ON CONFLICT (usuario_id) DO UPDATE SET conteudo = excluded.conteudo, versao = excluded.versao, atualizado_em = excluded.atualizado_em'
        )
        .bind(usuario.id, JSON.stringify(corpo.conteudo), nova, agora)
        .run();
      return json({ ok: true, versao: nova, atualizadoEm: agora }, 200, cabecalhos);
    }

    return json({ erro: 'Use outro método neste endereço.' }, 405, cabecalhos);
  } catch (e) {
    const status = e instanceof ErroConta ? e.status : 500;
    const mensagem = e instanceof ErroConta ? e.message : 'Erro inesperado na conta.';
    // Na volta do Google a pessoa está no navegador: mostra uma página, não JSON
    if (url.pathname === '/api/auth/google/retorno' || url.pathname === '/api/auth/google') {
      return new Response(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 16px"><h1 style="font-size:22px">Não deu para entrar</h1><p>${mensagem}</p></body>`,
        { status, headers: { 'content-type': 'text/html; charset=utf-8' } }
      );
    }
    return json({ erro: mensagem }, status, cabecalhos);
  }
}
