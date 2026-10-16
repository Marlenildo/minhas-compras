// Servidor de busca do Minhas Compras (Cloudflare Worker).
// GET /api/buscar?q=sabonete+liquido&cep=58397000  → anúncios no formato comum
// GET /api/saude                                    → confere se o servidor está de pé
import { buscarML, diagnosticarML, ErroDeFonte } from './mercadolivre.js';

const CACHE_SEGUNDOS = 600;

function cors(env, req) {
  const permitidas = String(env.ORIGENS_PERMITIDAS || '*').split(',').map((s) => s.trim());
  const origem = req.headers.get('origin') || '';
  const permitida = permitidas.includes('*') ? '*' : permitidas.includes(origem) ? origem : permitidas[0];
  return {
    'access-control-allow-origin': permitida,
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
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
  if (req.method !== 'GET') return json({ erro: 'Use GET.' }, 405, cabecalhos);

  if (url.pathname === '/' || url.pathname === '') {
    return json({ servico: 'Minhas Compras', rotas: ['/api/saude', '/api/buscar?q=produto&cep=00000000', '/api/diagnostico'] }, 200, cabecalhos);
  }

  if (url.pathname === '/api/diagnostico') {
    return json({ passos: await diagnosticarML(env, fetcher) }, 200, cabecalhos);
  }

  if (url.pathname === '/api/saude') {
    return json({ ok: true, mercadolivre: Boolean(env.ML_CLIENT_ID && env.ML_CLIENT_SECRET) }, 200, cabecalhos);
  }

  if (url.pathname === '/api/buscar') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 120);
    if (q.length < 2) return json({ erro: 'Digite pelo menos 2 letras para buscar.' }, 400, cabecalhos);
    const cep = (url.searchParams.get('cep') || '').replace(/\D/g, '').slice(0, 8);

    // Cache compartilhado do Cloudflare: a mesma busca não bate na loja de novo por 10 min
    const chave = new Request(`https://cache.minhas-compras/buscar?q=${encodeURIComponent(q.toLowerCase())}&cep=${cep}`);
    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const salvo = cache ? await cache.match(chave) : null;
    if (salvo) {
      const r = new Response(salvo.body, salvo);
      for (const [k, v] of Object.entries(cabecalhos)) r.headers.set(k, v);
      return r;
    }

    try {
      const itens = await buscarML(q, { env, cep, fetcher });
      const corpo = { q, cep: cep || null, verificadoEm: new Date().toISOString(), fontes: ['mercadolivre'], itens };
      const resposta = json(corpo, 200, { ...cabecalhos, 'cache-control': `public, max-age=${CACHE_SEGUNDOS}` });
      if (cache && ctx.waitUntil) ctx.waitUntil(cache.put(chave, resposta.clone()));
      return resposta;
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
