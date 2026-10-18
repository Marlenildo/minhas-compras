// Servidor de busca do Minhas Compras (Cloudflare Worker).
// GET /api/buscar?q=sabonete+liquido&cep=58397000  → ofertas no formato comum
// GET /api/saude                                    → confere se o servidor está de pé
// GET /api/diagnostico                              → testa cada fonte de preços
import { buscarML, diagnosticarML, iniciarConexao, concluirConexao, ErroDeFonte } from './mercadolivre.js';
import { buscarGoogle, diagnosticarGoogle, buscarLojasDoProduto } from './google.js';
import { localDoCep } from './cep.js';
import { tratarConta } from './conta.js';

/** Fonte usada nas buscas: Google Shopping quando há chave da SerpApi; senão, Mercado Livre. */
const fonteAtiva = (env) => (env.SERPAPI_KEY ? 'google' : env.ML_CLIENT_ID && env.ML_CLIENT_SECRET ? 'mercadolivre' : null);

function cors(env, req) {
  const permitidas = String(env.ORIGENS_PERMITIDAS || '*').split(',').map((s) => s.trim());
  const origem = req.headers.get('origin') || '';
  const permitida = permitidas.includes('*') ? '*' : permitidas.includes(origem) ? origem : permitidas[0];
  return {
    'access-control-allow-origin': permitida,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

const json = (dados, status, extra) =>
  new Response(JSON.stringify(dados), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });

export async function tratar(req, env, ctx = {}, fetcher = fetch) {
  const url = new URL(req.url);
  const cabecalhos = cors(env, req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cabecalhos });

  // Conta: entrar com Google, sessão e dados salvos
  const daConta = await tratarConta(req, env, url, fetcher, cabecalhos);
  if (daConta) return daConta;

  if (req.method !== 'GET') return json({ erro: 'Use GET.' }, 405, cabecalhos);

  // Fora de /api/*, o endereço é do app: com os arquivos publicados junto (ASSETS), entrega a página
  if (env.ASSETS && !url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
  if (url.pathname === '/' || url.pathname === '') {
    return json({ servico: 'Minhas Compras', rotas: ['/api/saude', '/api/buscar?q=produto', '/api/lojas?token=...', '/api/diagnostico', '/api/auth/google', '/api/conta'] }, 200, cabecalhos);
  }

  // Conexão da conta do dono ao Mercado Livre (feita uma vez)
  if (url.pathname === '/api/conectar' || url.pathname === '/api/retorno') {
    const pagina = (titulo, texto, status = 200) =>
      new Response(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title>` +
          `<body style="font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px"><h1 style="font-size:22px">${titulo}</h1><p>${texto}</p></body>`,
        { status, headers: { 'content-type': 'text/html; charset=utf-8' } }
      );
    if (!env.TOKENS) return pagina('Falta o armazenamento', 'Crie um namespace KV e ligue ao servidor com o nome TOKENS.', 503);
    if (!env.ADMIN_CHAVE) return pagina('Falta a senha de administrador', 'Cadastre o segredo ADMIN_CHAVE no servidor.', 503);
    const redirectUri = `${url.origin}/api/retorno`;
    if (url.pathname === '/api/conectar') {
      if (url.searchParams.get('chave') !== env.ADMIN_CHAVE) return pagina('Senha incorreta', 'Use /api/conectar?chave=SUA_SENHA, com a senha cadastrada em ADMIN_CHAVE.', 403);
      return Response.redirect(await iniciarConexao(env, redirectUri), 302);
    }
    try {
      await concluirConexao(env, { code: url.searchParams.get('code'), state: url.searchParams.get('state'), redirectUri }, fetcher);
      return pagina('Conectado ao Mercado Livre', 'Pronto. O servidor vai renovar este acesso sozinho. Pode fechar esta página e voltar para o chat.');
    } catch (e) {
      return pagina('A conexão não deu certo', e instanceof ErroDeFonte ? e.message : 'Erro inesperado.', e.status || 500);
    }
  }

  if (url.pathname === '/api/diagnostico') {
    const passos = [...(await diagnosticarGoogle(env, fetcher))];
    if (env.ML_CLIENT_ID) passos.push(...(await diagnosticarML(env, fetcher)));
    return json({ fontePrincipal: fonteAtiva(env), passos }, 200, cabecalhos);
  }

  if (url.pathname === '/api/saude') {
    return json(
      {
        ok: true, fonte: fonteAtiva(env), google: Boolean(env.SERPAPI_KEY), mercadolivre: Boolean(env.ML_CLIENT_ID && env.ML_CLIENT_SECRET),
        conta: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.DB && env.TOKENS),
      },
      200,
      cabecalhos
    );
  }

  // Todas as lojas de um produto, com link direto (Google Shopping)
  if (url.pathname === '/api/lojas') {
    const token = (url.searchParams.get('token') || '').trim();
    if (token.length < 10 || token.length > 4000) return json({ erro: 'Código do produto inválido.' }, 400, cabecalhos);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const chaveCache = `lojas:${hash}`;
    if (env.TOKENS) {
      const salvo = await env.TOKENS.get(chaveCache, 'json').catch(() => null);
      if (salvo) return json({ ...salvo, doCache: true }, 200, cabecalhos);
    }
    try {
      const corpo = { ...(await buscarLojasDoProduto(token, { env, fetcher })), verificadoEm: new Date().toISOString() };
      if (env.TOKENS) {
        const horas = Math.max(0.1, Number(env.CACHE_HORAS) || 6);
        const gravar = env.TOKENS.put(chaveCache, JSON.stringify(corpo), { expirationTtl: Math.max(60, Math.round(horas * 3600)) });
        if (ctx.waitUntil) ctx.waitUntil(gravar);
        else await gravar;
      }
      return json(corpo, 200, cabecalhos);
    } catch (e) {
      const status = e instanceof ErroDeFonte ? e.status : 500;
      return json({ erro: e instanceof ErroDeFonte ? e.message : 'Erro inesperado no servidor.' }, status, cabecalhos);
    }
  }

  if (url.pathname === '/api/buscar') {
    const q = (url.searchParams.get('q') || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (q.length < 2) return json({ erro: 'Digite pelo menos 2 letras para buscar.' }, 400, cabecalhos);
    const cep = (url.searchParams.get('cep') || '').replace(/\D/g, '').slice(0, 8);
    const fonte = fonteAtiva(env);
    if (!fonte) return json({ erro: 'O servidor ainda não tem nenhuma fonte de preços configurada.' }, 503, cabecalhos);

    // O Google não usa o CEP; o Mercado Livre usa para o frete
    // Com CEP, a busca do Google é feita para a cidade (ou o estado) da pessoa
    const local = cep.length === 8 ? await localDoCep(cep, { env, fetcher }).catch(() => null) : null;
    const location = local?.location || 'Brazil';
    const chaveCache = `busca:${fonte}:${q.toLowerCase()}:${fonte === 'mercadolivre' ? cep : location}`;
    const horas = Math.max(0.1, Number(env.CACHE_HORAS) || 6);

    // 1. Cache no KV: vale para o mundo todo e poupa a cota de buscas
    if (env.TOKENS) {
      const salvo = await env.TOKENS.get(chaveCache, 'json').catch(() => null);
      if (salvo) return json({ ...salvo, doCache: true }, 200, { ...cabecalhos, 'cache-control': 'public, max-age=300' });
    }

    try {
      const { itens, filtros } =
        fonte === 'google' ? await buscarGoogle(q, { env, fetcher, location }) : { itens: await buscarML(q, { env, cep, fetcher }), filtros: [] };
      const corpo = { q, cep: cep || null, local, verificadoEm: new Date().toISOString(), fontes: [fonte], itens, filtros };
      if (env.TOKENS) {
        const gravar = env.TOKENS.put(chaveCache, JSON.stringify(corpo), { expirationTtl: Math.max(60, Math.round(horas * 3600)) });
        if (ctx.waitUntil) ctx.waitUntil(gravar);
        else await gravar;
      }
      return json(corpo, 200, { ...cabecalhos, 'cache-control': 'public, max-age=300' });
    } catch (e) {
      const status = e instanceof ErroDeFonte ? e.status : 500;
      return json({ erro: e instanceof ErroDeFonte ? e.message : 'Erro inesperado no servidor.' }, status, cabecalhos);
    }
  }

  return json({ erro: 'Endereço não encontrado.' }, 404, cabecalhos);
}

export default {
  fetch: (req, env, ctx) => tratar(req, env, ctx),
};
