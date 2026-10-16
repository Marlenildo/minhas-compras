// src/core.js
var num = (v, padrao = 0) => {
  if (v === null || v === void 0 || v === "") return padrao;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : padrao;
};
function lerNumero(v, padrao = 0) {
  if (typeof v === "number") return Number.isFinite(v) ? v : padrao;
  if (v === null || v === void 0) return padrao;
  const s = String(v).trim().replace(/^r\$\s*/i, "");
  if (s === "") return padrao;
  if (s.includes(",")) return num(s, padrao);
  const n = Number(s);
  return Number.isFinite(n) ? n : padrao;
}
var RX_UNIDADE = "(ml|mililitros?|l|lt|litros?|g|gr|gramas?|kg|quilos?)";
var MAPA_UNIDADE = (u) => {
  u = u.toLowerCase();
  if (u.startsWith("ml") || u.startsWith("mili")) return "ml";
  if (u === "l" || u === "lt" || u.startsWith("litro")) return "l";
  if (u === "kg" || u.startsWith("quilo")) return "kg";
  return "g";
};
var FIM = "(?![a-z\xE0-\xFA])";
function lerTitulo(titulo) {
  if (!titulo) return null;
  const t = String(titulo).toLowerCase().replace(/\s+/g, " ");
  const mx = t.match(new RegExp(`(\\d+)\\s*(?:un\\w*\\s*)?[x\xD7]\\s*(\\d+(?:[.,]\\d+)?)\\s*${RX_UNIDADE}${FIM}`));
  if (mx) {
    return { embalagens: Number(mx[1]), conteudo: lerNumero(mx[2]), unidade: MAPA_UNIDADE(mx[3]) };
  }
  const mx2 = t.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${RX_UNIDADE}${FIM}\\s*[x\xD7]\\s*(\\d+)`));
  if (mx2) {
    return { embalagens: Number(mx2[3]), conteudo: lerNumero(mx2[1]), unidade: MAPA_UNIDADE(mx2[2]) };
  }
  const mv = t.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${RX_UNIDADE}${FIM}`));
  if (!mv) return null;
  const conteudo = lerNumero(mv[1]);
  const unidade = MAPA_UNIDADE(mv[2]);
  let embalagens = 1;
  const padroes = [
    /\bkit\s*(?:com|c\/|de)?\s*(\d+)/,
    /\b(?:pack|combo|caixa|cx)\s*(?:com|c\/|de)?\s*(\d+)/,
    /\bleve\s*(\d+)/,
    /\b(\d+)\s*(?:unidades|unidade|unids?|uns?|un\b|pe[cç]as|frascos|refis|refil|sach[eê]s|embalagens|pacotes|latas|garrafas)/,
    /\bc\/\s*(\d+)/
  ];
  for (const p of padroes) {
    const m = t.match(p);
    if (m && Number(m[1]) > 0 && Number(m[1]) < 200) {
      embalagens = Number(m[1]);
      break;
    }
  }
  return { embalagens, conteudo, unidade };
}

// worker/src/mercadolivre.js
var API = "https://api.mercadolibre.com";
var ATRIB_CONTEUDO = ["NET_VOLUME", "VOLUME", "CAPACITY", "NET_WEIGHT", "WEIGHT", "PACKAGE_WEIGHT"];
var ATRIB_QTD = ["UNITS_PER_PACK", "UNITS_PER_PACKAGE", "PACKAGE_UNITS", "SALE_FORMAT_UNITS"];
function valorAtributo(item, ids) {
  for (const id of ids) {
    const a = (item.attributes || []).find((x) => x.id === id);
    if (a && (a.value_name || a.value_struct)) return a;
  }
  return null;
}
function conteudoDoAtributo(a) {
  if (!a) return null;
  if (a.value_struct && a.value_struct.number) {
    const lido = lerTitulo(`${a.value_struct.number} ${a.value_struct.unit}`);
    if (lido) return lido;
  }
  return a.value_name ? lerTitulo(a.value_name) : null;
}
function fotoGrande(url) {
  if (!url) return null;
  return String(url).replace(/^http:/, "https:").replace(/-[A-Z]\.(jpe?g|webp|png)$/i, "-O.$1");
}
function normalizarItemML(item) {
  const pelotitulo = lerTitulo(item.title);
  const atrib = conteudoDoAtributo(valorAtributo(item, ATRIB_CONTEUDO));
  const qtdAtrib = valorAtributo(item, ATRIB_QTD);
  let conteudo = null;
  let fonteConteudo = null;
  if (pelotitulo) {
    conteudo = pelotitulo;
    fonteConteudo = "titulo";
  } else if (atrib) {
    conteudo = { ...atrib, embalagens: Math.max(1, Math.round(lerNumero(qtdAtrib?.value_name, 1))) };
    fonteConteudo = "atributo";
  }
  return {
    id: `ml:${item.id}`,
    fonte: "mercadolivre",
    loja: "Mercado Livre",
    vendedor: item.official_store_name || item.seller?.nickname || null,
    lojaOficial: Boolean(item.official_store_id),
    titulo: item.title,
    preco: item.price,
    precoOriginal: item.original_price || null,
    foto: fotoGrande(item.thumbnail),
    link: item.permalink,
    condicao: item.condition,
    freteGratis: Boolean(item.shipping?.free_shipping),
    frete: item.shipping?.free_shipping ? 0 : null,
    // null = ainda não calculado
    full: item.shipping?.logistic_type === "fulfillment",
    embalagens: conteudo?.embalagens ?? null,
    conteudo: conteudo?.conteudo ?? null,
    unidade: conteudo?.unidade ?? null,
    fonteConteudo
  };
}
var tokenEmCache = null;
async function obterToken(env, fetcher = fetch) {
  if (tokenEmCache && tokenEmCache.expira > Date.now()) return tokenEmCache.valor;
  if (!env.ML_CLIENT_ID || !env.ML_CLIENT_SECRET) {
    throw new ErroDeFonte("O servidor ainda n\xE3o tem as chaves do Mercado Livre (ML_CLIENT_ID e ML_CLIENT_SECRET).", 503);
  }
  const r = await fetcher(`${API}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.ML_CLIENT_ID,
      client_secret: env.ML_CLIENT_SECRET
    })
  });
  if (!r.ok) throw new ErroDeFonte(`O Mercado Livre recusou as chaves do aplicativo (HTTP ${r.status}).`, 502);
  const j = await r.json();
  tokenEmCache = { valor: j.access_token, expira: Date.now() + Math.max(60, (j.expires_in || 21600) - 300) * 1e3 };
  return tokenEmCache.valor;
}
function limparTokenEmCache() {
  tokenEmCache = null;
}
var ErroDeFonte = class extends Error {
  constructor(mensagem, status = 502) {
    super(mensagem);
    this.status = status;
  }
};
var cabecalhos = (token) => ({ authorization: `Bearer ${token}`, accept: "application/json" });
async function chamar(caminho, token, fetcher) {
  const r = await fetcher(`${API}${caminho}`, { headers: cabecalhos(token) });
  const json2 = await r.json().catch(() => null);
  return { status: r.status, ok: r.ok, json: json2 };
}
var mensagemML = (j) => j && (j.message || j.error) || "";
async function buscarML(q, { env, cep, limite = 30, fetcher = fetch } = {}) {
  const token = await obterToken(env, fetcher);
  const anuncios = await chamar(
    `/sites/MLB/search?${new URLSearchParams({ q, limit: String(Math.min(limite, 50)), condition: "new" })}`,
    token,
    fetcher
  );
  if (anuncios.status === 401) limparTokenEmCache();
  let itens;
  if (anuncios.ok) {
    itens = (anuncios.json?.results || []).filter((i) => i.condition !== "used").map(normalizarItemML);
  } else if (anuncios.status === 403 || anuncios.status === 401) {
    itens = await buscarCatalogo(q, { token, fetcher });
  } else {
    throw new ErroDeFonte(`A busca do Mercado Livre falhou (HTTP ${anuncios.status}).`, 502);
  }
  await calcularFretes(itens, cep, { token, fetcher });
  return itens;
}
async function buscarCatalogo(q, { token, fetcher = fetch, maxProdutos = 15 } = {}) {
  const busca = await chamar(
    `/products/search?${new URLSearchParams({ status: "active", site_id: "MLB", q, limit: String(maxProdutos) })}`,
    token,
    fetcher
  );
  if (!busca.ok) {
    throw new ErroDeFonte(
      `O Mercado Livre bloqueou a busca de an\xFAncios e a do cat\xE1logo (HTTP ${busca.status}${mensagemML(busca.json) ? `: ${mensagemML(busca.json)}` : ""}).`,
      502
    );
  }
  const produtos = (busca.json?.results || []).slice(0, maxProdutos);
  const grupos = await Promise.all(
    produtos.map(async (p) => {
      const r = await chamar(`/products/${p.id}/items?limit=20`, token, fetcher).catch(() => null);
      const ofertas = (r?.ok ? r.json?.results || [] : []).filter((o) => o.condition !== "used" && typeof o.price === "number");
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
function normalizarOfertaCatalogo(produto, oferta) {
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
    attributes: produto.attributes || []
  });
  return { ...n, produtoCatalogo: produto.id };
}
async function calcularFretes(itens, cep, { token, fetcher }) {
  const cepLimpo = String(cep || "").replace(/\D/g, "");
  if (cepLimpo.length !== 8) return;
  const semFrete = itens.filter((i) => !i.freteGratis).slice(0, 12);
  await Promise.all(
    semFrete.map(async (i) => {
      try {
        const r = await chamar(`/items/${i.id.slice(3)}/shipping_options?zip_code=${cepLimpo}`, token, fetcher);
        if (!r.ok) return;
        const custos = (r.json?.options || []).map((o) => o.cost).filter((c) => typeof c === "number");
        if (custos.length) i.frete = Math.min(...custos);
      } catch (_) {
      }
    })
  );
}
async function diagnosticarML(env, fetcher = fetch) {
  const passos = [];
  let token;
  try {
    token = await obterToken(env, fetcher);
    passos.push({ etapa: "chaves do aplicativo (token)", status: 200, ok: true });
  } catch (e) {
    passos.push({ etapa: "chaves do aplicativo (token)", ok: false, mensagem: e.message });
    return passos;
  }
  const teste = async (etapa, caminho) => {
    const r = await chamar(caminho, token, fetcher).catch((e) => ({ status: 0, ok: false, json: { message: String(e) } }));
    passos.push({ etapa, status: r.status, ok: r.ok, mensagem: r.ok ? "" : mensagemML(r.json) });
    return r;
  };
  await teste("busca de an\xFAncios", "/sites/MLB/search?q=sabonete&limit=1");
  const cat = await teste("busca no cat\xE1logo", "/products/search?status=active&site_id=MLB&q=sabonete&limit=1");
  const prod = cat.json?.results?.[0]?.id;
  if (prod) {
    const ofs = await teste("ofertas de um produto do cat\xE1logo", `/products/${prod}/items?limit=1`);
    const item = ofs.json?.results?.[0]?.item_id;
    if (item) {
      await teste("detalhes de um an\xFAncio", `/items/${item}`);
      await teste("frete de um an\xFAncio (CEP de exemplo)", `/items/${item}/shipping_options?zip_code=01310100`);
    }
  }
  return passos;
}

// worker/src/index.js
var CACHE_SEGUNDOS = 600;
function cors(env, req) {
  const permitidas = String(env.ORIGENS_PERMITIDAS || "*").split(",").map((s) => s.trim());
  const origem = req.headers.get("origin") || "";
  const permitida = permitidas.includes("*") ? "*" : permitidas.includes(origem) ? origem : permitidas[0];
  return {
    "access-control-allow-origin": permitida,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin"
  };
}
var json = (dados, status, extra) => new Response(JSON.stringify(dados), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...extra }
});
async function tratar(req, env, ctx = {}, fetcher = fetch) {
  const url = new URL(req.url);
  const cabecalhos2 = cors(env, req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cabecalhos2 });
  if (req.method !== "GET") return json({ erro: "Use GET." }, 405, cabecalhos2);
  if (url.pathname === "/" || url.pathname === "") {
    return json({ servico: "Minhas Compras", rotas: ["/api/saude", "/api/buscar?q=produto&cep=00000000", "/api/diagnostico"] }, 200, cabecalhos2);
  }
  if (url.pathname === "/api/diagnostico") {
    return json({ passos: await diagnosticarML(env, fetcher) }, 200, cabecalhos2);
  }
  if (url.pathname === "/api/saude") {
    return json({ ok: true, mercadolivre: Boolean(env.ML_CLIENT_ID && env.ML_CLIENT_SECRET) }, 200, cabecalhos2);
  }
  if (url.pathname === "/api/buscar") {
    const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
    if (q.length < 2) return json({ erro: "Digite pelo menos 2 letras para buscar." }, 400, cabecalhos2);
    const cep = (url.searchParams.get("cep") || "").replace(/\D/g, "").slice(0, 8);
    const chave = new Request(`https://cache.minhas-compras/buscar?q=${encodeURIComponent(q.toLowerCase())}&cep=${cep}`);
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const salvo = cache ? await cache.match(chave) : null;
    if (salvo) {
      const r = new Response(salvo.body, salvo);
      for (const [k, v] of Object.entries(cabecalhos2)) r.headers.set(k, v);
      return r;
    }
    try {
      const itens = await buscarML(q, { env, cep, fetcher });
      const corpo = { q, cep: cep || null, verificadoEm: (/* @__PURE__ */ new Date()).toISOString(), fontes: ["mercadolivre"], itens };
      const resposta = json(corpo, 200, { ...cabecalhos2, "cache-control": `public, max-age=${CACHE_SEGUNDOS}` });
      if (cache && ctx.waitUntil) ctx.waitUntil(cache.put(chave, resposta.clone()));
      return resposta;
    } catch (e) {
      const status = e instanceof ErroDeFonte ? e.status : 500;
      return json({ erro: e instanceof ErroDeFonte ? e.message : "Erro inesperado no servidor." }, status, cabecalhos2);
    }
  }
  return json({ erro: "Endere\xE7o n\xE3o encontrado." }, 404, cabecalhos2);
}
var src_default = {
  fetch: (req, env, ctx) => tratar(req, env, ctx)
};
export {
  src_default as default,
  tratar
};
