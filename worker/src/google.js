// Fonte de dados: Google Shopping, pela SerpApi (serpapi.com).
// Uma busca traz ofertas de várias lojas (Amazon, Mercado Livre, Magalu, farmácias...).
import { lerTitulo, lerNumero } from '../../app/src/core.js';
import { ErroDeFonte } from './mercadolivre.js';
import { limparFiltrosGoogle } from '../../app/src/facetas.js';

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
    // Prefere a foto maior que o Google oferece; a miniatura fica de reserva
    foto: (Array.isArray(r.serpapi_thumbnails) && r.serpapi_thumbnails[0]) || (Array.isArray(r.thumbnails) && r.thumbnails[0]) || r.thumbnail || null,
    lojaIcone: r.source_icon || null,
    // Link direto para a loja só vem em alguns resultados; os outros abrem a página do Google
    link: r.link || r.product_link || null,
    linkDireto: Boolean(r.link),
    // Código para abrir a página do produto, com todas as lojas e links diretos (gasta 1 busca)
    token: r.immersive_product_page_token || null,
    variasLojas: Boolean(r.multiple_sources),
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

/** Busca no Google Shopping do Brasil. Devolve { itens, filtros } (filtros do Google: marca, cor, tipo...). */
export async function buscarGoogle(q, { env, fetcher = fetch, location = 'Brazil' } = {}) {
  if (!env.SERPAPI_KEY) throw new ErroDeFonte('O servidor ainda não tem a chave da SerpApi (SERPAPI_KEY).', 503);
  const url = `${SERPAPI}?${new URLSearchParams({
    engine: 'google_shopping',
    q,
    gl: 'br',
    hl: 'pt-br',
    google_domain: 'google.com.br',
    location: location || 'Brazil',
    api_key: env.SERPAPI_KEY,
  })}`;
  const r = await fetcher(url, { headers: { accept: 'application/json' } });
  const j = await r.json().catch(() => null);
  if (!r.ok || j?.error) {
    const motivo = j?.error || `HTTP ${r.status}`;
    if (/run out of searches|plan|limit/i.test(motivo)) {
      throw new ErroDeFonte('As buscas gratuitas do mês acabaram. Elas voltam no próximo ciclo da SerpApi.', 429);
    }
    if (/hasn't returned any results/i.test(motivo)) return { itens: [], filtros: [] };
    throw new ErroDeFonte(`A busca no Google Shopping falhou (${motivo}).`, 502);
  }
  const resultados = [...(j.shopping_results || []), ...(j.inline_shopping_results || [])];
  const vistos = new Set();
  const itens = resultados
    .map(normalizarResultadoGoogle)
    .filter((i) => {
      if (i.condicao === 'used' || !(i.preco > 0)) return false;
      const chave = `${i.loja}|${i.titulo}|${i.preco}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
  return { itens, filtros: limparFiltrosGoogle(j.filters) };
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

// ---------------------------------------------------------------------------
// Página do produto: todas as lojas que vendem o item, com link direto
// ---------------------------------------------------------------------------

const textos = (lista) =>
  (Array.isArray(lista) ? lista : [])
    .map((d) => (typeof d === 'string' ? d : d?.text || d?.title || ''))
    .map((t) => String(t).trim())
    .filter(Boolean);

/** Uma loja da página do produto, no formato do app. */
export function normalizarLojaGoogle(s) {
  const preco = typeof s.extracted_price === 'number' ? s.extracted_price : lerNumero(s.price, null);
  const detalhes = textos(s.details_and_offers);
  let frete = typeof s.shipping_extracted === 'number' ? s.shipping_extracted : null;
  let freteGratis = frete === 0;
  if (frete === null) {
    const lido = lerFrete([s.shipping, ...detalhes].filter(Boolean).join(' · '));
    frete = lido.frete;
    freteGratis = lido.freteGratis;
  }
  const totalInformado = typeof s.extracted_total === 'number' ? s.extracted_total : null;
  return {
    loja: s.name || 'Loja',
    icone: s.logo || null,
    link: s.link || null,
    titulo: s.title || null,
    preco,
    precoOriginal: typeof s.extracted_original_price === 'number' ? s.extracted_original_price : null,
    frete,
    freteGratis,
    total: totalInformado ?? (preco != null && frete != null ? Math.round((preco + frete) * 100) / 100 : null),
    detalhes,
    cupom: s.coupon || null,
    desconto: s.discount || null,
    parcelas: s.installments_description || null,
    pagamento: textos(s.payment_methods),
    avaliacao: typeof s.rating === 'number' ? s.rating : null,
    avaliacoes: typeof s.reviews === 'number' ? s.reviews : null,
    destaque: s.tag || null,
  };
}

/** Busca a página do produto (1 busca da cota) e devolve o produto e as lojas, da menor para a maior. */
export async function buscarLojasDoProduto(token, { env, fetcher = fetch } = {}) {
  if (!env.SERPAPI_KEY) throw new ErroDeFonte('O servidor ainda não tem a chave da SerpApi (SERPAPI_KEY).', 503);
  const url = `${SERPAPI}?${new URLSearchParams({
    engine: 'google_immersive_product',
    page_token: token,
    more_stores: 'true',
    gl: 'br',
    hl: 'pt-br',
    api_key: env.SERPAPI_KEY,
  })}`;
  const r = await fetcher(url, { headers: { accept: 'application/json' } });
  const j = await r.json().catch(() => null);
  if (!r.ok || j?.error) {
    const motivo = j?.error || `HTTP ${r.status}`;
    if (/run out of searches|plan|limit/i.test(motivo)) {
      throw new ErroDeFonte('As buscas gratuitas do mês acabaram. Elas voltam no próximo ciclo da SerpApi.', 429);
    }
    throw new ErroDeFonte(`Não consegui abrir as lojas deste produto (${motivo}).`, 502);
  }
  const p = j.product_results || {};
  const lojas = (p.stores || [])
    .map(normalizarLojaGoogle)
    .filter((l) => l.preco > 0)
    .sort((a, b) => (a.total ?? a.preco) - (b.total ?? b.preco));
  return {
    produto: {
      titulo: p.title || null,
      marca: p.brand || null,
      fotos: (p.thumbnails || []).filter((t) => typeof t === 'string').slice(0, 6),
      avaliacao: typeof p.rating === 'number' ? p.rating : null,
      avaliacoes: typeof p.reviews === 'number' ? p.reviews : null,
      sobre: typeof p.about_the_product?.description === 'string' ? p.about_the_product.description.slice(0, 600) : null,
    },
    lojas,
  };
}
