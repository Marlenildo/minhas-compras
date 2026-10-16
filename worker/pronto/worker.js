// app/src/core.js
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
var AUTORIZACAO = "https://auth.mercadolivre.com.br/authorization";
async function pedirToken(campos, env, fetcher) {
  const r = await fetcher(`${API}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: env.ML_CLIENT_ID, client_secret: env.ML_CLIENT_SECRET, ...campos })
  });
  const json2 = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, json: json2 };
}
function guardarEmCache(j, tipo) {
  tokenEmCache = { valor: j.access_token, tipo, expira: Date.now() + Math.max(60, (j.expires_in || 21600) - 300) * 1e3 };
  return tokenEmCache;
}
async function obterToken(env, fetcher = fetch) {
  if (tokenEmCache && tokenEmCache.expira > Date.now()) return tokenEmCache.valor;
  if (!env.ML_CLIENT_ID || !env.ML_CLIENT_SECRET) {
    throw new ErroDeFonte("O servidor ainda n\xE3o tem as chaves do Mercado Livre (ML_CLIENT_ID e ML_CLIENT_SECRET).", 503);
  }
  if (env.TOKENS) {
    const salvo = await env.TOKENS.get("ml_acesso", "json").catch(() => null);
    if (salvo && salvo.expira > Date.now()) {
      tokenEmCache = salvo;
      return salvo.valor;
    }
    const refresh = await env.TOKENS.get("ml_refresh").catch(() => null);
    if (refresh) {
      const r2 = await pedirToken({ grant_type: "refresh_token", refresh_token: refresh }, env, fetcher);
      if (r2.ok && r2.json?.access_token) {
        const t = guardarEmCache(r2.json, "usuario");
        if (r2.json.refresh_token) await env.TOKENS.put("ml_refresh", r2.json.refresh_token);
        await env.TOKENS.put("ml_acesso", JSON.stringify(t), { expirationTtl: Math.max(60, Math.floor((t.expira - Date.now()) / 1e3)) });
        return t.valor;
      }
    }
  }
  const r = await pedirToken({ grant_type: "client_credentials" }, env, fetcher);
  if (!r.ok) throw new ErroDeFonte(`O Mercado Livre recusou as chaves do aplicativo (HTTP ${r.status}).`, 502);
  return guardarEmCache(r.json, "aplicativo").valor;
}
var tipoDoToken = () => tokenEmCache?.tipo || null;
function limparTokenEmCache() {
  tokenEmCache = null;
}
async function iniciarConexao(env, redirectUri) {
  const estado = crypto.randomUUID();
  await env.TOKENS.put(`estado:${estado}`, "1", { expirationTtl: 600 });
  return `${AUTORIZACAO}?${new URLSearchParams({ response_type: "code", client_id: env.ML_CLIENT_ID, redirect_uri: redirectUri, state: estado })}`;
}
async function concluirConexao(env, { code, state, redirectUri }, fetcher = fetch) {
  if (!state || !await env.TOKENS.get(`estado:${state}`)) {
    throw new ErroDeFonte("Este link de autoriza\xE7\xE3o venceu ou n\xE3o foi gerado por este servidor. Comece de novo pelo /api/conectar.", 400);
  }
  await env.TOKENS.delete(`estado:${state}`);
  const r = await pedirToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri }, env, fetcher);
  if (!r.ok || !r.json?.refresh_token) {
    const detalhe = r.json?.message || r.json?.error || `HTTP ${r.status}`;
    throw new ErroDeFonte(
      `O Mercado Livre n\xE3o entregou a autoriza\xE7\xE3o (${detalhe}). Confira se o fluxo "Refresh Token" est\xE1 marcado no aplicativo e se a URI de redirecionamento \xE9 exatamente ${redirectUri}.`,
      502
    );
  }
  await env.TOKENS.put("ml_refresh", r.json.refresh_token);
  const t = guardarEmCache(r.json, "usuario");
  await env.TOKENS.put("ml_acesso", JSON.stringify(t), { expirationTtl: Math.max(60, Math.floor((t.expira - Date.now()) / 1e3)) });
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
    passos.push({ etapa: `chaves do aplicativo (token de ${tipoDoToken() === "usuario" ? "usu\xE1rio" : "aplicativo"})`, status: 200, ok: true });
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

// app/src/facetas.js
var GRUPO_IGNORADO = /pre[cç]o|price|loja|store|seller|vendedor|merchant|frete|shipping|entrega|delivery|promo|sale|deal|oferta|avalia|rating|review|condi|used|usado|refine|refinar|nearby|perto|hoje|today|small business/i;
function limparFiltrosGoogle(filtros) {
  return (Array.isArray(filtros) ? filtros : []).filter((f) => f && f.type && !GRUPO_IGNORADO.test(f.type)).map((f) => ({
    nome: String(f.type).trim(),
    opcoes: [...new Set((f.options || []).map((o) => String(o?.text || "").trim()).filter((t) => t && t.length <= 40 && !GRUPO_IGNORADO.test(t)))].slice(0, 30)
  })).filter((f) => f.opcoes.length >= 2).slice(0, 6);
}

// worker/src/google.js
var SERPAPI = "https://serpapi.com/search.json";
function lerFrete(texto) {
  if (!texto) return { freteGratis: false, frete: null };
  const t = String(texto).toLowerCase();
  if (/(frete|entrega)\s*(gr[aá]tis|gratuit)|free (delivery|shipping)/.test(t)) return { freteGratis: true, frete: 0 };
  const m = t.match(/r\$\s*([\d.]+,\d{2}|\d+(?:[.,]\d+)?)/);
  if (m && /(frete|entrega|envio|delivery|shipping)/.test(t)) return { freteGratis: false, frete: lerNumero(m[1], null) };
  return { freteGratis: false, frete: null };
}
function textoDeFrete(r) {
  const partes = [r.delivery, r.shipping, ...Array.isArray(r.extensions) ? r.extensions : []];
  return partes.filter(Boolean).join(" \xB7 ");
}
function normalizarResultadoGoogle(r, i = 0) {
  const tamanho = lerTitulo(r.title);
  const frete = lerFrete(textoDeFrete(r));
  const preco = typeof r.extracted_price === "number" ? r.extracted_price : lerNumero(r.price, null);
  return {
    id: `gs:${r.product_id || r.position || i}:${String(r.source || "").slice(0, 30)}`,
    fonte: "google",
    loja: r.source || "Loja n\xE3o informada",
    vendedor: null,
    lojaOficial: false,
    titulo: r.title,
    preco,
    precoOriginal: typeof r.extracted_old_price === "number" ? r.extracted_old_price : null,
    foto: r.thumbnail || (Array.isArray(r.thumbnails) ? r.thumbnails[0] : null) || null,
    lojaIcone: r.source_icon || null,
    // Link direto para a loja só vem em alguns resultados; os outros abrem a página do Google
    link: r.link || r.product_link || null,
    linkDireto: Boolean(r.link),
    // Código para abrir a página do produto, com todas as lojas e links diretos (gasta 1 busca)
    token: r.immersive_product_page_token || null,
    variasLojas: Boolean(r.multiple_sources),
    condicao: r.second_hand_condition ? "used" : "new",
    freteGratis: frete.freteGratis,
    frete: frete.frete,
    full: false,
    avaliacao: typeof r.rating === "number" ? r.rating : null,
    avaliacoes: typeof r.reviews === "number" ? r.reviews : null,
    embalagens: tamanho?.embalagens ?? null,
    conteudo: tamanho?.conteudo ?? null,
    unidade: tamanho?.unidade ?? null,
    fonteConteudo: tamanho ? "titulo" : null
  };
}
async function buscarGoogle(q, { env, fetcher = fetch, location = "Brazil" } = {}) {
  if (!env.SERPAPI_KEY) throw new ErroDeFonte("O servidor ainda n\xE3o tem a chave da SerpApi (SERPAPI_KEY).", 503);
  const url = `${SERPAPI}?${new URLSearchParams({
    engine: "google_shopping",
    q,
    gl: "br",
    hl: "pt-br",
    google_domain: "google.com.br",
    location: location || "Brazil",
    api_key: env.SERPAPI_KEY
  })}`;
  const r = await fetcher(url, { headers: { accept: "application/json" } });
  const j = await r.json().catch(() => null);
  if (!r.ok || j?.error) {
    const motivo = j?.error || `HTTP ${r.status}`;
    if (/run out of searches|plan|limit/i.test(motivo)) {
      throw new ErroDeFonte("As buscas gratuitas do m\xEAs acabaram. Elas voltam no pr\xF3ximo ciclo da SerpApi.", 429);
    }
    if (/hasn't returned any results/i.test(motivo)) return { itens: [], filtros: [] };
    throw new ErroDeFonte(`A busca no Google Shopping falhou (${motivo}).`, 502);
  }
  const resultados = [...j.shopping_results || [], ...j.inline_shopping_results || []];
  const vistos = /* @__PURE__ */ new Set();
  const itens = resultados.map(normalizarResultadoGoogle).filter((i) => {
    if (i.condicao === "used" || !(i.preco > 0)) return false;
    const chave = `${i.loja}|${i.titulo}|${i.preco}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
  return { itens, filtros: limparFiltrosGoogle(j.filters) };
}
async function diagnosticarGoogle(env, fetcher = fetch) {
  if (!env.SERPAPI_KEY) return [{ etapa: "Google Shopping (SerpApi)", ok: false, mensagem: "Falta o segredo SERPAPI_KEY." }];
  const r = await fetcher(`https://serpapi.com/account.json?api_key=${encodeURIComponent(env.SERPAPI_KEY)}`, {
    headers: { accept: "application/json" }
  }).catch(() => null);
  const j = r ? await r.json().catch(() => null) : null;
  if (!r || !r.ok || j?.error) {
    return [{ etapa: "Google Shopping (SerpApi)", ok: false, status: r?.status || 0, mensagem: j?.error || "N\xE3o consegui falar com a SerpApi." }];
  }
  return [
    {
      etapa: "Google Shopping (SerpApi)",
      ok: true,
      status: 200,
      plano: j.plan_name || null,
      buscasRestantes: j.total_searches_left ?? j.plan_searches_left ?? null
    }
  ];
}
var textos = (lista) => (Array.isArray(lista) ? lista : []).map((d) => typeof d === "string" ? d : d?.text || d?.title || "").map((t) => String(t).trim()).filter(Boolean);
function normalizarLojaGoogle(s) {
  const preco = typeof s.extracted_price === "number" ? s.extracted_price : lerNumero(s.price, null);
  const detalhes = textos(s.details_and_offers);
  let frete = typeof s.shipping_extracted === "number" ? s.shipping_extracted : null;
  let freteGratis = frete === 0;
  if (frete === null) {
    const lido = lerFrete([s.shipping, ...detalhes].filter(Boolean).join(" \xB7 "));
    frete = lido.frete;
    freteGratis = lido.freteGratis;
  }
  const totalInformado = typeof s.extracted_total === "number" ? s.extracted_total : null;
  return {
    loja: s.name || "Loja",
    icone: s.logo || null,
    link: s.link || null,
    titulo: s.title || null,
    preco,
    precoOriginal: typeof s.extracted_original_price === "number" ? s.extracted_original_price : null,
    frete,
    freteGratis,
    total: totalInformado ?? (preco != null && frete != null ? Math.round((preco + frete) * 100) / 100 : null),
    detalhes,
    cupom: s.coupon || null,
    desconto: s.discount || null,
    parcelas: s.installments_description || null,
    pagamento: textos(s.payment_methods),
    avaliacao: typeof s.rating === "number" ? s.rating : null,
    avaliacoes: typeof s.reviews === "number" ? s.reviews : null,
    destaque: s.tag || null
  };
}
async function buscarLojasDoProduto(token, { env, fetcher = fetch } = {}) {
  if (!env.SERPAPI_KEY) throw new ErroDeFonte("O servidor ainda n\xE3o tem a chave da SerpApi (SERPAPI_KEY).", 503);
  const url = `${SERPAPI}?${new URLSearchParams({
    engine: "google_immersive_product",
    page_token: token,
    more_stores: "true",
    gl: "br",
    hl: "pt-br",
    api_key: env.SERPAPI_KEY
  })}`;
  const r = await fetcher(url, { headers: { accept: "application/json" } });
  const j = await r.json().catch(() => null);
  if (!r.ok || j?.error) {
    const motivo = j?.error || `HTTP ${r.status}`;
    if (/run out of searches|plan|limit/i.test(motivo)) {
      throw new ErroDeFonte("As buscas gratuitas do m\xEAs acabaram. Elas voltam no pr\xF3ximo ciclo da SerpApi.", 429);
    }
    throw new ErroDeFonte(`N\xE3o consegui abrir as lojas deste produto (${motivo}).`, 502);
  }
  const p = j.product_results || {};
  const lojas = (p.stores || []).map(normalizarLojaGoogle).filter((l) => l.preco > 0).sort((a, b) => (a.total ?? a.preco) - (b.total ?? b.preco));
  return {
    produto: {
      titulo: p.title || null,
      marca: p.brand || null,
      fotos: (p.thumbnails || []).filter((t) => typeof t === "string").slice(0, 6),
      avaliacao: typeof p.rating === "number" ? p.rating : null,
      avaliacoes: typeof p.reviews === "number" ? p.reviews : null,
      sobre: typeof p.about_the_product?.description === "string" ? p.about_the_product.description.slice(0, 600) : null
    },
    lojas
  };
}

// worker/src/cep.js
var ESTADOS = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapa",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceara",
  DF: "Federal District",
  ES: "Espirito Santo",
  GO: "Goias",
  MA: "Maranhao",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Para",
  PB: "Paraiba",
  PR: "Parana",
  PE: "Pernambuco",
  PI: "Piaui",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondonia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "Sao Paulo",
  SE: "Sergipe",
  TO: "Tocantins"
};
var semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
var limparCep = (cep) => String(cep || "").replace(/\D/g, "").slice(0, 8);
async function cidadeDoCep(cep, fetcher = fetch) {
  const c = limparCep(cep);
  if (c.length !== 8) return null;
  try {
    const r = await fetcher(`https://viacep.com.br/ws/${c}/json/`, { headers: { accept: "application/json" } });
    if (r.ok) {
      const j = await r.json();
      if (j && !j.erro && j.localidade && j.uf) return { cidade: j.localidade, uf: j.uf };
      if (j && j.erro) return null;
    }
  } catch (_) {
  }
  try {
    const r = await fetcher(`https://brasilapi.com.br/api/cep/v1/${c}`, { headers: { accept: "application/json" } });
    if (r.ok) {
      const j = await r.json();
      if (j && j.city && j.state) return { cidade: j.city, uf: j.state };
    }
  } catch (_) {
  }
  return null;
}
async function procurarLocal(q, fetcher) {
  try {
    const r = await fetcher(`https://serpapi.com/locations.json?${new URLSearchParams({ q, limit: "10" })}`, {
      headers: { accept: "application/json" }
    });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j.filter((l) => l.country_code === "BR") : [];
  } catch (_) {
    return [];
  }
}
async function localizacaoGoogle({ cidade, uf }, fetcher = fetch) {
  const estado = ESTADOS[uf];
  const cidadeSA = semAcento(cidade).toLowerCase();
  const daCidade = (await procurarLocal(semAcento(cidade), fetcher)).find(
    (l) => semAcento(l.name).toLowerCase() === cidadeSA && (!estado || semAcento(l.canonical_name).includes(estado))
  );
  if (daCidade) return { location: daCidade.canonical_name, nivel: "cidade" };
  if (estado) {
    const doEstado = (await procurarLocal(estado, fetcher)).find((l) => /state|region|district/i.test(l.target_type || "") && semAcento(l.name) === estado);
    if (doEstado) return { location: doEstado.canonical_name, nivel: "estado" };
  }
  return { location: "Brazil", nivel: "pais" };
}
async function localDoCep(cep, { env, fetcher = fetch } = {}) {
  const c = limparCep(cep);
  if (c.length !== 8) return null;
  const chave = `cep:${c}`;
  if (env.TOKENS) {
    const salvo = await env.TOKENS.get(chave, "json").catch(() => null);
    if (salvo) return salvo;
  }
  const lugar = await cidadeDoCep(c, fetcher);
  if (!lugar) return null;
  const local = { cep: c, ...lugar, ...await localizacaoGoogle(lugar, fetcher) };
  if (env.TOKENS) await env.TOKENS.put(chave, JSON.stringify(local), { expirationTtl: 30 * 24 * 3600 }).catch(() => {
  });
  return local;
}

// worker/src/index.js
var fonteAtiva = (env) => env.SERPAPI_KEY ? "google" : env.ML_CLIENT_ID && env.ML_CLIENT_SECRET ? "mercadolivre" : null;
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
    return json({ servico: "Minhas Compras", rotas: ["/api/saude", "/api/buscar?q=produto", "/api/lojas?token=...", "/api/diagnostico"] }, 200, cabecalhos2);
  }
  if (url.pathname === "/api/conectar" || url.pathname === "/api/retorno") {
    const pagina = (titulo, texto, status = 200) => new Response(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px"><h1 style="font-size:22px">${titulo}</h1><p>${texto}</p></body>`,
      { status, headers: { "content-type": "text/html; charset=utf-8" } }
    );
    if (!env.TOKENS) return pagina("Falta o armazenamento", "Crie um namespace KV e ligue ao servidor com o nome TOKENS.", 503);
    if (!env.ADMIN_CHAVE) return pagina("Falta a senha de administrador", "Cadastre o segredo ADMIN_CHAVE no servidor.", 503);
    const redirectUri = `${url.origin}/api/retorno`;
    if (url.pathname === "/api/conectar") {
      if (url.searchParams.get("chave") !== env.ADMIN_CHAVE) return pagina("Senha incorreta", "Use /api/conectar?chave=SUA_SENHA, com a senha cadastrada em ADMIN_CHAVE.", 403);
      return Response.redirect(await iniciarConexao(env, redirectUri), 302);
    }
    try {
      await concluirConexao(env, { code: url.searchParams.get("code"), state: url.searchParams.get("state"), redirectUri }, fetcher);
      return pagina("Conectado ao Mercado Livre", "Pronto. O servidor vai renovar este acesso sozinho. Pode fechar esta p\xE1gina e voltar para o chat.");
    } catch (e) {
      return pagina("A conex\xE3o n\xE3o deu certo", e instanceof ErroDeFonte ? e.message : "Erro inesperado.", e.status || 500);
    }
  }
  if (url.pathname === "/api/diagnostico") {
    const passos = [...await diagnosticarGoogle(env, fetcher)];
    if (env.ML_CLIENT_ID) passos.push(...await diagnosticarML(env, fetcher));
    return json({ fontePrincipal: fonteAtiva(env), passos }, 200, cabecalhos2);
  }
  if (url.pathname === "/api/saude") {
    return json(
      { ok: true, fonte: fonteAtiva(env), google: Boolean(env.SERPAPI_KEY), mercadolivre: Boolean(env.ML_CLIENT_ID && env.ML_CLIENT_SECRET) },
      200,
      cabecalhos2
    );
  }
  if (url.pathname === "/api/lojas") {
    const token = (url.searchParams.get("token") || "").trim();
    if (token.length < 10 || token.length > 4e3) return json({ erro: "C\xF3digo do produto inv\xE1lido." }, 400, cabecalhos2);
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const chaveCache = `lojas:${hash}`;
    if (env.TOKENS) {
      const salvo = await env.TOKENS.get(chaveCache, "json").catch(() => null);
      if (salvo) return json({ ...salvo, doCache: true }, 200, cabecalhos2);
    }
    try {
      const corpo = { ...await buscarLojasDoProduto(token, { env, fetcher }), verificadoEm: (/* @__PURE__ */ new Date()).toISOString() };
      if (env.TOKENS) {
        const horas = Math.max(0.1, Number(env.CACHE_HORAS) || 6);
        const gravar = env.TOKENS.put(chaveCache, JSON.stringify(corpo), { expirationTtl: Math.max(60, Math.round(horas * 3600)) });
        if (ctx.waitUntil) ctx.waitUntil(gravar);
        else await gravar;
      }
      return json(corpo, 200, cabecalhos2);
    } catch (e) {
      const status = e instanceof ErroDeFonte ? e.status : 500;
      return json({ erro: e instanceof ErroDeFonte ? e.message : "Erro inesperado no servidor." }, status, cabecalhos2);
    }
  }
  if (url.pathname === "/api/buscar") {
    const q = (url.searchParams.get("q") || "").trim().replace(/\s+/g, " ").slice(0, 120);
    if (q.length < 2) return json({ erro: "Digite pelo menos 2 letras para buscar." }, 400, cabecalhos2);
    const cep = (url.searchParams.get("cep") || "").replace(/\D/g, "").slice(0, 8);
    const fonte = fonteAtiva(env);
    if (!fonte) return json({ erro: "O servidor ainda n\xE3o tem nenhuma fonte de pre\xE7os configurada." }, 503, cabecalhos2);
    const local = cep.length === 8 ? await localDoCep(cep, { env, fetcher }).catch(() => null) : null;
    const location = local?.location || "Brazil";
    const chaveCache = `busca:${fonte}:${q.toLowerCase()}:${fonte === "mercadolivre" ? cep : location}`;
    const horas = Math.max(0.1, Number(env.CACHE_HORAS) || 6);
    if (env.TOKENS) {
      const salvo = await env.TOKENS.get(chaveCache, "json").catch(() => null);
      if (salvo) return json({ ...salvo, doCache: true }, 200, { ...cabecalhos2, "cache-control": "public, max-age=300" });
    }
    try {
      const { itens, filtros } = fonte === "google" ? await buscarGoogle(q, { env, fetcher, location }) : { itens: await buscarML(q, { env, cep, fetcher }), filtros: [] };
      const corpo = { q, cep: cep || null, local, verificadoEm: (/* @__PURE__ */ new Date()).toISOString(), fontes: [fonte], itens, filtros };
      if (env.TOKENS) {
        const gravar = env.TOKENS.put(chaveCache, JSON.stringify(corpo), { expirationTtl: Math.max(60, Math.round(horas * 3600)) });
        if (ctx.waitUntil) ctx.waitUntil(gravar);
        else await gravar;
      }
      return json(corpo, 200, { ...cabecalhos2, "cache-control": "public, max-age=300" });
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
