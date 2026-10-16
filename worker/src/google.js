// Fonte de dados: Google Shopping, pela SerpApi (serpapi.com).
// Uma busca traz ofertas de várias lojas (Amazon, Mercado Livre, Magalu, farmácias...).
import { lerTitulo, lerNumero } from '../../src/core.js';
import { ErroDeFonte } from './mercadolivre.js';

const SERPAPI = 'https://serpapi.com/search.json';

/** Lê o frete do texto do Google: "Frete grátis", "Frete: R$ 12,90", "+R$ 9,99 de frete". */
export function lerFrete(texto) {
  if (!texto) return { freteGratis: false, frete: null };
  const t = String(texto).toLowerCase();
  if (/(frete|entrega)\s*(gr[aá]tis|gratuit)|free (delivery|shipping)/.test(t)) return { freteGratis: true, frete: 0 };
  const m = t.match(/r\$\s*([\d.]+,\d{2}|\d+(?:[.,]\d+)?)/);
  if (m && /(frete|entrega|envio|delivery|shipping)/.test(t)) return { freteGratis: false, frete: lerNumero(m[1], null) };
  return { freteGratis: false, frete: null };
}

function textoDeFrete(r) {
  const partes = [r.delivery, r.shipping, ...(Array.isArray(r.extensions) ? r.extensions : [])];
  return partes.filter(Boolean).join(' · ');
}

/** Um resultado do Google Shopping no formato comum do app. */
export function normalizarResultadoGoogle(r, i = 0) {
  const tamanho = lerTitulo(r.title);
  const frete = lerFrete(textoDeFrete(r));
  const preco = typeof r.extracted_price === 'number' ? r.extracted_price : lerNumero(r.price, null);
  return {
    id: `gs:${r.product_id || r.position || i}:${String(r.source || '').slice(0, 30)}`,
    fonte: 'google',
    loja: r.source || 'Loja não informada',
    vendedor: null,
    lojaOficial: false,
    titulo: r.title,
    preco,
    precoOriginal: typeof r.extracted_old_price === 'number' ? r.extracted_old_price : null,
    foto: r.thumbnail || (Array.isArray(r.thumbnails) ? r.thumbnails[0] : null) || null,
    link: r.link || r.product_link || null,
    condicao: r.second_hand_condition ? 'used' : 'new',
    freteGratis: frete.freteGratis,
    frete: frete.frete,
    full: false,
    avaliacao: typeof r.rating === 'number' ? r.rating : null,
    avaliacoes: typeof r.reviews === 'number' ? r.reviews : null,
    embalagens: tamanho?.embalagens ?? null,
    conteudo: tamanho?.conteudo ?? null,
    unidade: tamanho?.unidade ?? null,
    fonteConteudo: tamanho ? 'titulo' : null,
  };
}

/** Busca no Google Shopping do Brasil. */
export async function buscarGoogle(q, { env, fetcher = fetch } = {}) {
  if (!env.SERPAPI_KEY) throw new ErroDeFonte('O servidor ainda não tem a chave da SerpApi (SERPAPI_KEY).', 503);
  const url = `${SERPAPI}?${new URLSearchParams({
    engine: 'google_shopping',
    q,
    gl: 'br',
    hl: 'pt-br',
    google_domain: 'google.com.br',
    location: 'Brazil',
    api_key: env.SERPAPI_KEY,
  })}`;
  const r = await fetcher(url, { headers: { accept: 'application/json' } });
  const j = await r.json().catch(() => null);
  if (!r.ok || j?.error) {
    const motivo = j?.error || `HTTP ${r.status}`;
    if (/run out of searches|plan|limit/i.test(motivo)) {
      throw new ErroDeFonte('As buscas gratuitas do mês acabaram. Elas voltam no próximo ciclo da SerpApi.', 429);
    }
    if (/hasn't returned any results/i.test(motivo)) return [];
    throw new ErroDeFonte(`A busca no Google Shopping falhou (${motivo}).`, 502);
  }
  const resultados = [...(j.shopping_results || []), ...(j.inline_shopping_results || [])];
  const vistos = new Set();
  return resultados
    .map(normalizarResultadoGoogle)
    .filter((i) => {
      if (i.condicao === 'used' || !(i.preco > 0)) return false;
      const chave = `${i.loja}|${i.titulo}|${i.preco}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
}

/** Confere a chave sem gastar busca: a conta da SerpApi diz quantas buscas restam. */
export async function diagnosticarGoogle(env, fetcher = fetch) {
  if (!env.SERPAPI_KEY) return [{ etapa: 'Google Shopping (SerpApi)', ok: false, mensagem: 'Falta o segredo SERPAPI_KEY.' }];
  const r = await fetcher(`https://serpapi.com/account.json?api_key=${encodeURIComponent(env.SERPAPI_KEY)}`, {
    headers: { accept: 'application/json' },
  }).catch(() => null);
  const j = r ? await r.json().catch(() => null) : null;
  if (!r || !r.ok || j?.error) {
    return [{ etapa: 'Google Shopping (SerpApi)', ok: false, status: r?.status || 0, mensagem: j?.error || 'Não consegui falar com a SerpApi.' }];
  }
  return [
    {
      etapa: 'Google Shopping (SerpApi)',
      ok: true,
      status: 200,
      plano: j.plan_name || null,
      buscasRestantes: j.total_searches_left ?? j.plan_searches_left ?? null,
    },
  ];
}
