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

/** Busca anúncios novos e devolve no formato comum. */
export async function buscarML(q, { env, cep, limite = 30, fetcher = fetch } = {}) {
  const token = await obterToken(env, fetcher);
  const url = `${API}/sites/MLB/search?${new URLSearchParams({ q, limit: String(Math.min(limite, 50)), condition: 'new' })}`;
  const r = await fetcher(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
  if (r.status === 401) limparTokenEmCache();
  if (!r.ok) throw new ErroDeFonte(`A busca do Mercado Livre falhou (HTTP ${r.status}).`, 502);
  const j = await r.json();
  const itens = (j.results || []).filter((i) => i.condition !== 'used').map(normalizarItemML);

  // Com CEP, calcula o frete dos anúncios que não têm frete grátis (até 12, em paralelo)
  const cepLimpo = String(cep || '').replace(/\D/g, '');
  if (cepLimpo.length === 8) {
    const semFrete = itens.filter((i) => !i.freteGratis).slice(0, 12);
    await Promise.all(
      semFrete.map(async (i) => {
        try {
          const id = i.id.slice(3);
          const rf = await fetcher(`${API}/items/${id}/shipping_options?zip_code=${cepLimpo}`, {
            headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
          });
          if (!rf.ok) return;
          const jf = await rf.json();
          const custos = (jf.options || []).map((o) => o.cost).filter((c) => typeof c === 'number');
          if (custos.length) i.frete = Math.min(...custos);
        } catch (_) {
          /* frete fica como "a calcular" */
        }
      })
    );
  }
  return itens;
}
