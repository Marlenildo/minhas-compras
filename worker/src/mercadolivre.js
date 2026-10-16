// Fonte de dados: API oficial do Mercado Livre.
// Converte os anúncios para o formato comum do app (o mesmo que outras lojas vão usar).
import { lerTitulo, lerNumero } from '../../src/core.js';

const API = 'https://api.mercadolibre.com';

/** Atributos de volume/peso/quantidade que o ML costuma preencher no anúncio. */
const ATRIB_CONTEUDO = ['NET_VOLUME', 'VOLUME', 'CAPACITY', 'NET_WEIGHT', 'WEIGHT', 'PACKAGE_WEIGHT'];
const ATRIB_QTD = ['UNITS_PER_PACK', 'UNITS_PER_PACKAGE', 'PACKAGE_UNITS', 'SALE_FORMAT_UNITS'];

function valorAtributo(item, ids) {
  for (const id of ids) {
    const a = (item.attributes || []).find((x) => x.id === id);
    if (a && (a.value_name || a.value_struct)) return a;
  }
  return null;
}

/** Lê "900 mL", "1.5 L", "500 g" de um atributo do ML. */
function conteudoDoAtributo(a) {
  if (!a) return null;
  if (a.value_struct && a.value_struct.number) {
    const lido = lerTitulo(`${a.value_struct.number} ${a.value_struct.unit}`);
    if (lido) return lido;
  }
  return a.value_name ? lerTitulo(a.value_name) : null;
}

/** Foto em tamanho maior e sempre por https. */
export function fotoGrande(url) {
  if (!url) return null;
  return String(url).replace(/^http:/, 'https:').replace(/-[A-Z]\.(jpe?g|webp|png)$/i, '-O.$1');
}

/** Um anúncio do ML no formato comum do app. */
export function normalizarItemML(item) {
  const pelotitulo = lerTitulo(item.title);
  const atrib = conteudoDoAtributo(valorAtributo(item, ATRIB_CONTEUDO));
  const qtdAtrib = valorAtributo(item, ATRIB_QTD);
  let conteudo = null;
  let fonteConteudo = null;
  if (pelotitulo) {
    conteudo = pelotitulo;
    fonteConteudo = 'titulo';
  } else if (atrib) {
    conteudo = { ...atrib, embalagens: Math.max(1, Math.round(lerNumero(qtdAtrib?.value_name, 1))) };
    fonteConteudo = 'atributo';
  }
  return {
    id: `ml:${item.id}`,
    fonte: 'mercadolivre',
    loja: 'Mercado Livre',
    vendedor: item.official_store_name || item.seller?.nickname || null,
    lojaOficial: Boolean(item.official_store_id),
    titulo: item.title,
    preco: item.price,
    precoOriginal: item.original_price || null,
    foto: fotoGrande(item.thumbnail),
    link: item.permalink,
    condicao: item.condition,
    freteGratis: Boolean(item.shipping?.free_shipping),
    frete: item.shipping?.free_shipping ? 0 : null, // null = ainda não calculado
    full: item.shipping?.logistic_type === 'fulfillment',
    embalagens: conteudo?.embalagens ?? null,
    conteudo: conteudo?.conteudo ?? null,
    unidade: conteudo?.unidade ?? null,
    fonteConteudo,
  };
}

// ---------------------------------------------------------------------------
// Chamadas à API
// ---------------------------------------------------------------------------

let tokenEmCache = null;

/** Token de aplicativo (client credentials). Dura ~6 h; renovamos com folga. */
export async function obterToken(env, fetcher = fetch) {
  if (tokenEmCache && tokenEmCache.expira > Date.now()) return tokenEmCache.valor;
  if (!env.ML_CLIENT_ID || !env.ML_CLIENT_SECRET) {
    throw new ErroDeFonte('O servidor ainda não tem as chaves do Mercado Livre (ML_CLIENT_ID e ML_CLIENT_SECRET).', 503);
  }
  const r = await fetcher(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.ML_CLIENT_ID,
      client_secret: env.ML_CLIENT_SECRET,
    }),
  });
  if (!r.ok) throw new ErroDeFonte(`O Mercado Livre recusou as chaves do aplicativo (HTTP ${r.status}).`, 502);
  const j = await r.json();
  tokenEmCache = { valor: j.access_token, expira: Date.now() + Math.max(60, (j.expires_in || 21600) - 300) * 1000 };
  return tokenEmCache.valor;
}

export function limparTokenEmCache() {
  tokenEmCache = null;
}

export class ErroDeFonte extends Error {
  constructor(mensagem, status = 502) {
    super(mensagem);
    this.status = status;
  }
}

const cabecalhos = (token) => ({ authorization: `Bearer ${token}`, accept: 'application/json' });

/** Chama a API e devolve { status, json }, sem lançar erro. */
async function chamar(caminho, token, fetcher) {
  const r = await fetcher(`${API}${caminho}`, { headers: cabecalhos(token) });
  const json = await r.json().catch(() => null);
  return { status: r.status, ok: r.ok, json };
}

const mensagemML = (j) => (j && (j.message || j.error)) || '';

/** Busca no Mercado Livre e devolve no formato comum. Tenta a busca de anúncios; se for bloqueada, usa o catálogo. */
export async function buscarML(q, { env, cep, limite = 30, fetcher = fetch } = {}) {
  const token = await obterToken(env, fetcher);
  const anuncios = await chamar(
    `/sites/MLB/search?${new URLSearchParams({ q, limit: String(Math.min(limite, 50)), condition: 'new' })}`,
    token,
    fetcher
  );
  if (anuncios.status === 401) limparTokenEmCache();

  let itens;
  if (anuncios.ok) {
    itens = (anuncios.json?.results || []).filter((i) => i.condition !== 'used').map(normalizarItemML);
  } else if (anuncios.status === 403 || anuncios.status === 401) {
    itens = await buscarCatalogo(q, { token, fetcher });
  } else {
    throw new ErroDeFonte(`A busca do Mercado Livre falhou (HTTP ${anuncios.status}).`, 502);
  }
  await calcularFretes(itens, cep, { token, fetcher });
  return itens;
}

/**
 * Busca no catálogo: cada produto do catálogo junta o mesmo item de vários vendedores.
 * Para cada produto, pega a oferta mais barata e, se for outra, a mais barata com frete grátis.
 */
export async function buscarCatalogo(q, { token, fetcher = fetch, maxProdutos = 15 } = {}) {
  const busca = await chamar(
    `/products/search?${new URLSearchParams({ status: 'active', site_id: 'MLB', q, limit: String(maxProdutos) })}`,
    token,
    fetcher
  );
  if (!busca.ok) {
    throw new ErroDeFonte(
      `O Mercado Livre bloqueou a busca de anúncios e a do catálogo (HTTP ${busca.status}${mensagemML(busca.json) ? `: ${mensagemML(busca.json)}` : ''}).`,
      502
    );
  }
  const produtos = (busca.json?.results || []).slice(0, maxProdutos);
  const grupos = await Promise.all(
    produtos.map(async (p) => {
      const r = await chamar(`/products/${p.id}/items?limit=20`, token, fetcher).catch(() => null);
      const ofertas = (r?.ok ? r.json?.results || [] : []).filter((o) => o.condition !== 'used' && typeof o.price === 'number');
      if (!ofertas.length) return [];
      ofertas.sort((a, b) => a.price - b.price);
      const escolhidas = [ofertas[0]];
      const gratis = ofertas.find((o) => o.shipping?.free_shipping);
      if (gratis && gratis !== ofertas[0]) escolhidas.push(gratis);
      return escolhidas.map((o) => normalizarOfertaCatalogo(p, o));
    })
  );
  return grupos.flat();
}

/** Uma oferta de um produto do catálogo, no formato comum. */
export function normalizarOfertaCatalogo(produto, oferta) {
  const n = normalizarItemML({
    id: oferta.item_id,
    title: produto.name,
    price: oferta.price,
    original_price: oferta.original_price,
    condition: oferta.condition,
    thumbnail: produto.pictures?.[0]?.url || produto.pictures?.[0]?.secure_url || null,
    permalink: `https://www.mercadolivre.com.br/p/${produto.id}`,
    shipping: oferta.shipping,
    official_store_id: oferta.official_store_id,
    attributes: produto.attributes || [],
  });
  return { ...n, produtoCatalogo: produto.id };
}

/** Com CEP, calcula o frete das ofertas sem frete grátis (até 12, em paralelo). */
async function calcularFretes(itens, cep, { token, fetcher }) {
  const cepLimpo = String(cep || '').replace(/\D/g, '');
  if (cepLimpo.length !== 8) return;
  const semFrete = itens.filter((i) => !i.freteGratis).slice(0, 12);
  await Promise.all(
    semFrete.map(async (i) => {
      try {
        const r = await chamar(`/items/${i.id.slice(3)}/shipping_options?zip_code=${cepLimpo}`, token, fetcher);
        if (!r.ok) return;
        const custos = (r.json?.options || []).map((o) => o.cost).filter((c) => typeof c === 'number');
        if (custos.length) i.frete = Math.min(...custos);
      } catch (_) {
        /* frete fica como "a calcular" */
      }
    })
  );
}

/** Testa cada rota da API e diz qual funciona com as chaves deste servidor. Não mostra as chaves. */
export async function diagnosticarML(env, fetcher = fetch) {
  const passos = [];
  let token;
  try {
    token = await obterToken(env, fetcher);
    passos.push({ etapa: 'chaves do aplicativo (token)', status: 200, ok: true });
  } catch (e) {
    passos.push({ etapa: 'chaves do aplicativo (token)', ok: false, mensagem: e.message });
    return passos;
  }
  const teste = async (etapa, caminho) => {
    const r = await chamar(caminho, token, fetcher).catch((e) => ({ status: 0, ok: false, json: { message: String(e) } }));
    passos.push({ etapa, status: r.status, ok: r.ok, mensagem: r.ok ? '' : mensagemML(r.json) });
    return r;
  };
  await teste('busca de anúncios', '/sites/MLB/search?q=sabonete&limit=1');
  const cat = await teste('busca no catálogo', '/products/search?status=active&site_id=MLB&q=sabonete&limit=1');
  const prod = cat.json?.results?.[0]?.id;
  if (prod) {
    const ofs = await teste('ofertas de um produto do catálogo', `/products/${prod}/items?limit=1`);
    const item = ofs.json?.results?.[0]?.item_id;
    if (item) {
      await teste('detalhes de um anúncio', `/items/${item}`);
      await teste('frete de um anúncio (CEP de exemplo)', `/items/${item}/shipping_options?zip_code=01310100`);
    }
  }
  return passos;
}
