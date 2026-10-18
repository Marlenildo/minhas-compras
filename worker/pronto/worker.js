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
  const json3 = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, json: json3 };
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
  const json3 = await r.json().catch(() => null);
  return { status: r.status, ok: r.ok, json: json3 };
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
    // Prefere a foto maior que o Google oferece; a miniatura fica de reserva
    foto: Array.isArray(r.serpapi_thumbnails) && r.serpapi_thumbnails[0] || Array.isArray(r.thumbnails) && r.thumbnails[0] || r.thumbnail || null,
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

// worker/src/conta.js
var GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
var GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
var SESSAO_DIAS = 90;
var LIMITE_DADOS = 3e5;
var ESQUEMA = [
  "CREATE TABLE IF NOT EXISTS usuarios (id TEXT PRIMARY KEY, google_sub TEXT UNIQUE NOT NULL, email TEXT, nome TEXT, foto TEXT, criado_em INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sessoes (token_hash TEXT PRIMARY KEY, usuario_id TEXT NOT NULL, criada_em INTEGER NOT NULL, expira_em INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS sessoes_usuario ON sessoes (usuario_id)",
  "CREATE TABLE IF NOT EXISTS dados (usuario_id TEXT PRIMARY KEY, conteudo TEXT NOT NULL, versao INTEGER NOT NULL, atualizado_em INTEGER NOT NULL)"
];
var bancosPreparados = /* @__PURE__ */ new WeakSet();
async function prepararBanco(db) {
  if (bancosPreparados.has(db)) return;
  await db.batch(ESQUEMA.map((sql) => db.prepare(sql)));
  bancosPreparados.add(db);
}
var b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
var aleatorio = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(texto) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function lerJwt(jwt) {
  const parte = String(jwt || "").split(".")[1];
  if (!parte) return null;
  const base64 = parte.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parte.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (_) {
    return null;
  }
}
var ErroConta = class extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.status = status;
  }
};
function origensDoApp(env, url) {
  const lista = String(env.ORIGENS_APP || "https://minhas-compras.marlenildo.online").split(",").map((s) => s.trim()).filter(Boolean);
  return /* @__PURE__ */ new Set([...lista, url.origin]);
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
  if (!env.GOOGLE_CLIENT_ID) faltam.push("GOOGLE_CLIENT_ID");
  if (!env.GOOGLE_CLIENT_SECRET) faltam.push("GOOGLE_CLIENT_SECRET");
  if (!env.DB) faltam.push("banco D1 com o nome DB");
  if (!env.TOKENS) faltam.push("KV com o nome TOKENS");
  return faltam;
}
async function salvarUsuarioGoogle(db, perfil) {
  const atual = await db.prepare("SELECT id FROM usuarios WHERE google_sub = ?").bind(perfil.sub).first();
  if (atual) {
    await db.prepare("UPDATE usuarios SET email = ?, nome = ?, foto = ? WHERE id = ?").bind(perfil.email || null, perfil.name || null, perfil.picture || null, atual.id).run();
    return atual.id;
  }
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO usuarios (id, google_sub, email, nome, foto, criado_em) VALUES (?, ?, ?, ?, ?, ?)").bind(id, perfil.sub, perfil.email || null, perfil.name || null, perfil.picture || null, Date.now()).run();
  return id;
}
async function criarSessao(db, usuarioId) {
  const token = aleatorio(32);
  const agora = Date.now();
  await db.prepare("INSERT INTO sessoes (token_hash, usuario_id, criada_em, expira_em) VALUES (?, ?, ?, ?)").bind(await sha256(token), usuarioId, agora, agora + SESSAO_DIAS * 864e5).run();
  return token;
}
var publico = (u) => ({ id: u.id, nome: u.nome, email: u.email, foto: u.foto });
async function usuarioDaSessao(req, db) {
  const m = (req.headers.get("authorization") || "").match(/^Bearer\s+([\w-]{20,})$/);
  if (!m) return null;
  const linha = await db.prepare(
    "SELECT u.id, u.nome, u.email, u.foto, s.token_hash FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ? AND s.expira_em > ?"
  ).bind(await sha256(m[1]), Date.now()).first();
  return linha || null;
}
var json = (dados, status, cabecalhos2) => new Response(JSON.stringify(dados), { status, headers: { "content-type": "application/json; charset=utf-8", ...cabecalhos2 } });
var ROTAS = /* @__PURE__ */ new Set(["/api/auth/google", "/api/auth/google/retorno", "/api/auth/trocar", "/api/auth/sair", "/api/conta", "/api/conta/dados"]);
async function tratarConta(req, env, url, fetcher = fetch, cabecalhos2 = {}) {
  if (!ROTAS.has(url.pathname)) return null;
  const faltam = faltaConfiguracao(env);
  if (faltam.length) return json({ erro: `A conta ainda n\xE3o est\xE1 configurada no servidor. Falta: ${faltam.join(", ")}.` }, 503, cabecalhos2);
  try {
    await prepararBanco(env.DB);
    const redirectUri = `${url.origin}/api/auth/google/retorno`;
    if (url.pathname === "/api/auth/google" && req.method === "GET") {
      const volta = voltaPermitida(url.searchParams.get("volta") || "", env, url);
      if (!volta) throw new ErroConta("Endere\xE7o de volta n\xE3o permitido.", 400);
      const estado = aleatorio(24);
      await env.TOKENS.put(`oauth:${estado}`, volta, { expirationTtl: 600 });
      const destino = `${GOOGLE_AUTH}?${new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state: estado,
        prompt: "select_account"
      })}`;
      return Response.redirect(destino, 302);
    }
    if (url.pathname === "/api/auth/google/retorno" && req.method === "GET") {
      const estado = url.searchParams.get("state") || "";
      const volta = estado ? await env.TOKENS.get(`oauth:${estado}`) : null;
      if (!volta) throw new ErroConta("Este login venceu. Volte ao app e toque em \u201CEntrar com Google\u201D de novo.", 400);
      await env.TOKENS.delete(`oauth:${estado}`);
      if (url.searchParams.get("error")) return Response.redirect(`${volta}#login_erro=cancelado`, 302);
      const r = await fetcher(GOOGLE_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          code: url.searchParams.get("code") || "",
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code"
        })
      });
      const j = await r.json().catch(() => null);
      const perfil = lerJwt(j?.id_token);
      const valido = r.ok && perfil && perfil.aud === env.GOOGLE_CLIENT_ID && ["accounts.google.com", "https://accounts.google.com"].includes(perfil.iss) && perfil.exp * 1e3 > Date.now() && perfil.sub && perfil.email_verified !== false;
      if (!valido) return Response.redirect(`${volta}#login_erro=google`, 302);
      const usuarioId = await salvarUsuarioGoogle(env.DB, perfil);
      const codigo = aleatorio(24);
      await env.TOKENS.put(`login:${await sha256(codigo)}`, usuarioId, { expirationTtl: 120 });
      return Response.redirect(`${volta}#login=${codigo}`, 302);
    }
    if (url.pathname === "/api/auth/trocar" && req.method === "POST") {
      const corpo = await req.json().catch(() => ({}));
      const chave = `login:${await sha256(String(corpo.codigo || ""))}`;
      const usuarioId = await env.TOKENS.get(chave);
      if (!usuarioId) throw new ErroConta("Este c\xF3digo de login venceu. Entre de novo.", 401);
      await env.TOKENS.delete(chave);
      const sessao = await criarSessao(env.DB, usuarioId);
      const u = await env.DB.prepare("SELECT id, nome, email, foto FROM usuarios WHERE id = ?").bind(usuarioId).first();
      return json({ sessao, usuario: publico(u) }, 200, cabecalhos2);
    }
    const usuario = await usuarioDaSessao(req, env.DB);
    if (!usuario) return json({ erro: "Sua sess\xE3o terminou. Entre de novo." }, 401, cabecalhos2);
    if (url.pathname === "/api/auth/sair" && req.method === "POST") {
      await env.DB.prepare("DELETE FROM sessoes WHERE token_hash = ?").bind(usuario.token_hash).run();
      return json({ ok: true }, 200, cabecalhos2);
    }
    if (url.pathname === "/api/conta" && req.method === "GET") {
      const d = await env.DB.prepare("SELECT conteudo, versao, atualizado_em FROM dados WHERE usuario_id = ?").bind(usuario.id).first();
      return json(
        { usuario: publico(usuario), dados: d ? { conteudo: JSON.parse(d.conteudo), versao: d.versao, atualizadoEm: d.atualizado_em } : null },
        200,
        cabecalhos2
      );
    }
    if (url.pathname === "/api/conta" && req.method === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM dados WHERE usuario_id = ?").bind(usuario.id),
        env.DB.prepare("DELETE FROM sessoes WHERE usuario_id = ?").bind(usuario.id),
        env.DB.prepare("DELETE FROM usuarios WHERE id = ?").bind(usuario.id)
      ]);
      return json({ ok: true, apagada: true }, 200, cabecalhos2);
    }
    if (url.pathname === "/api/conta/dados" && req.method === "PUT") {
      const texto = await req.text();
      if (texto.length > LIMITE_DADOS) throw new ErroConta("Seus salvos passaram do limite. Apague alguns e tente de novo.", 413);
      let corpo;
      try {
        corpo = JSON.parse(texto);
      } catch (_) {
        throw new ErroConta("Dados inv\xE1lidos.", 400);
      }
      if (!corpo || typeof corpo.conteudo !== "object") throw new ErroConta("Dados inv\xE1lidos.", 400);
      const atual = await env.DB.prepare("SELECT conteudo, versao FROM dados WHERE usuario_id = ?").bind(usuario.id).first();
      const versaoAtual = atual?.versao || 0;
      if ((corpo.versaoBase || 0) !== versaoAtual) {
        return json({ erro: "conflito", conteudo: atual ? JSON.parse(atual.conteudo) : null, versao: versaoAtual }, 409, cabecalhos2);
      }
      const nova = versaoAtual + 1;
      const agora = Date.now();
      await env.DB.prepare(
        "INSERT INTO dados (usuario_id, conteudo, versao, atualizado_em) VALUES (?, ?, ?, ?) ON CONFLICT (usuario_id) DO UPDATE SET conteudo = excluded.conteudo, versao = excluded.versao, atualizado_em = excluded.atualizado_em"
      ).bind(usuario.id, JSON.stringify(corpo.conteudo), nova, agora).run();
      return json({ ok: true, versao: nova, atualizadoEm: agora }, 200, cabecalhos2);
    }
    return json({ erro: "Use outro m\xE9todo neste endere\xE7o." }, 405, cabecalhos2);
  } catch (e) {
    const status = e instanceof ErroConta ? e.status : 500;
    const mensagem = e instanceof ErroConta ? e.message : "Erro inesperado na conta.";
    if (url.pathname === "/api/auth/google/retorno" || url.pathname === "/api/auth/google") {
      return new Response(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 16px"><h1 style="font-size:22px">N\xE3o deu para entrar</h1><p>${mensagem}</p></body>`,
        { status, headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }
    return json({ erro: mensagem }, status, cabecalhos2);
  }
}

// worker/src/index.js
var fonteAtiva = (env) => env.SERPAPI_KEY ? "google" : env.ML_CLIENT_ID && env.ML_CLIENT_SECRET ? "mercadolivre" : null;
function cors(env, req) {
  const permitidas = String(env.ORIGENS_PERMITIDAS || "*").split(",").map((s) => s.trim());
  const origem = req.headers.get("origin") || "";
  const permitida = permitidas.includes("*") ? "*" : permitidas.includes(origem) ? origem : permitidas[0];
  return {
    "access-control-allow-origin": permitida,
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
    vary: "origin"
  };
}
var json2 = (dados, status, extra) => new Response(JSON.stringify(dados), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...extra }
});
async function tratar(req, env, ctx = {}, fetcher = fetch) {
  const url = new URL(req.url);
  const cabecalhos2 = cors(env, req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cabecalhos2 });
  const daConta = await tratarConta(req, env, url, fetcher, cabecalhos2);
  if (daConta) return daConta;
  if (req.method !== "GET") return json2({ erro: "Use GET." }, 405, cabecalhos2);
  if (env.ASSETS && !url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
  if (url.pathname === "/" || url.pathname === "") {
    return json2({ servico: "Minhas Compras", rotas: ["/api/saude", "/api/buscar?q=produto", "/api/lojas?token=...", "/api/diagnostico", "/api/auth/google", "/api/conta"] }, 200, cabecalhos2);
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
    return json2({ fontePrincipal: fonteAtiva(env), passos }, 200, cabecalhos2);
  }
  if (url.pathname === "/api/saude") {
    return json2(
      {
        ok: true,
        fonte: fonteAtiva(env),
        google: Boolean(env.SERPAPI_KEY),
        mercadolivre: Boolean(env.ML_CLIENT_ID && env.ML_CLIENT_SECRET),
        conta: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.DB && env.TOKENS)
      },
      200,
      cabecalhos2
    );
  }
  if (url.pathname === "/api/lojas") {
    const token = (url.searchParams.get("token") || "").trim();
    if (token.length < 10 || token.length > 4e3) return json2({ erro: "C\xF3digo do produto inv\xE1lido." }, 400, cabecalhos2);
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const chaveCache = `lojas:${hash}`;
    if (env.TOKENS) {
      const salvo = await env.TOKENS.get(chaveCache, "json").catch(() => null);
      if (salvo) return json2({ ...salvo, doCache: true }, 200, cabecalhos2);
    }
    try {
      const corpo = { ...await buscarLojasDoProduto(token, { env, fetcher }), verificadoEm: (/* @__PURE__ */ new Date()).toISOString() };
      if (env.TOKENS) {
        const horas = Math.max(0.1, Number(env.CACHE_HORAS) || 6);
        const gravar = env.TOKENS.put(chaveCache, JSON.stringify(corpo), { expirationTtl: Math.max(60, Math.round(horas * 3600)) });
        if (ctx.waitUntil) ctx.waitUntil(gravar);
        else await gravar;
      }
      return json2(corpo, 200, cabecalhos2);
    } catch (e) {
      const status = e instanceof ErroDeFonte ? e.status : 500;
      return json2({ erro: e instanceof ErroDeFonte ? e.message : "Erro inesperado no servidor." }, status, cabecalhos2);
    }
  }
  if (url.pathname === "/api/buscar") {
    const q = (url.searchParams.get("q") || "").trim().replace(/\s+/g, " ").slice(0, 120);
    if (q.length < 2) return json2({ erro: "Digite pelo menos 2 letras para buscar." }, 400, cabecalhos2);
    const cep = (url.searchParams.get("cep") || "").replace(/\D/g, "").slice(0, 8);
    const fonte = fonteAtiva(env);
    if (!fonte) return json2({ erro: "O servidor ainda n\xE3o tem nenhuma fonte de pre\xE7os configurada." }, 503, cabecalhos2);
    const local = cep.length === 8 ? await localDoCep(cep, { env, fetcher }).catch(() => null) : null;
    const location = local?.location || "Brazil";
    const chaveCache = `busca:${fonte}:${q.toLowerCase()}:${fonte === "mercadolivre" ? cep : location}`;
    const horas = Math.max(0.1, Number(env.CACHE_HORAS) || 6);
    if (env.TOKENS) {
      const salvo = await env.TOKENS.get(chaveCache, "json").catch(() => null);
      if (salvo) return json2({ ...salvo, doCache: true }, 200, { ...cabecalhos2, "cache-control": "public, max-age=300" });
    }
    try {
      const { itens, filtros } = fonte === "google" ? await buscarGoogle(q, { env, fetcher, location }) : { itens: await buscarML(q, { env, cep, fetcher }), filtros: [] };
      const corpo = { q, cep: cep || null, local, verificadoEm: (/* @__PURE__ */ new Date()).toISOString(), fontes: [fonte], itens, filtros };
      if (env.TOKENS) {
        const gravar = env.TOKENS.put(chaveCache, JSON.stringify(corpo), { expirationTtl: Math.max(60, Math.round(horas * 3600)) });
        if (ctx.waitUntil) ctx.waitUntil(gravar);
        else await gravar;
      }
      return json2(corpo, 200, { ...cabecalhos2, "cache-control": "public, max-age=300" });
    } catch (e) {
      const status = e instanceof ErroDeFonte ? e.status : 500;
      return json2({ erro: e instanceof ErroDeFonte ? e.message : "Erro inesperado no servidor." }, status, cabecalhos2);
    }
  }
  return json2({ erro: "Endere\xE7o n\xE3o encontrado." }, 404, cabecalhos2);
}
var src_default = {
  fetch: (req, env, ctx) => tratar(req, env, ctx)
};

// dist/minhas-compras.html
var minhas_compras_default = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Minhas Compras</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="Compare pre\xE7os de qualquer produto em v\xE1rias lojas, com frete, promo\xE7\xF5es e pre\xE7o por unidade.">
<meta name="theme-color" content="#f5f6fa">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="assets/logo.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/logo-512.png">
<script>try{var t=localStorage.getItem("minhas-compras:tema");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}<\/script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap">
<style>
/* Minhas Compras \u2014 mesmo desenho do Minhas Entregas e do Meus Investimentos (paleta de marlenildo.online):
   fundo quase preto no escuro, gradiente violeta \u2192 ciano, Sora nos t\xEDtulos e Inter no texto.
   Tema claro e escuro: autom\xE1tico pelo sistema ou escolhido no bot\xE3o do topo (data-theme no <html>).
   Layout: busca no topo; depois da busca, destaques, filtros \xE0 esquerda (painel deslizante no celular) e a grade de ofertas. */
:root {
  --bg: #f5f6fa;
  --surface: #ffffff;
  --surface-2: #f2f3f8;
  --photo: #ffffff;
  --ink: #14161f;
  --muted: #5b6275;
  --line: rgba(18, 20, 28, 0.09);
  --line-forte: rgba(18, 20, 28, 0.18);
  --accent: #6d4cff;
  --accent-ink: #ffffff;
  --accent-soft: rgba(109, 76, 255, 0.10);
  --gradiente: linear-gradient(90deg, #7c5cff, #22d3ee);
  --na-gradiente: #0a0b10;
  --tag: rgba(14, 159, 184, 0.13);
  --tag-ink: #0b6577;
  --good: #16884a;
  --good-bg: rgba(22, 136, 74, 0.10);
  --off: #d0384b;
  --off-bg: rgba(208, 56, 75, 0.09);
  --warn: #a76300;
  --warn-bg: rgba(242, 160, 40, 0.12);
  --danger: #d0384b;
  --skeleton: #e8eaf1;
  --topo-bg: rgba(245, 246, 250, 0.82);
  --shadow: 0 1px 2px rgba(18, 20, 28, 0.04), 0 8px 24px -12px rgba(18, 20, 28, 0.12);
  --font-display: "Sora", "Inter", system-ui, sans-serif;
  --font-body: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  --raio: 18px;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0a0b10; --surface: #12141c; --surface-2: #181b26; --photo: #f4f5f9; --ink: #eef0f6; --muted: #9aa0b4;
    --line: rgba(255, 255, 255, 0.09); --line-forte: rgba(255, 255, 255, 0.18);
    --accent: #9b85ff; --accent-ink: #0a0b10; --accent-soft: rgba(124, 92, 255, 0.20);
    --tag: rgba(34, 211, 238, 0.15); --tag-ink: #67e0f2;
    --good: #5fd18a; --good-bg: rgba(95, 209, 138, 0.14); --off: #ff7b8a; --off-bg: rgba(255, 123, 138, 0.12);
    --warn: #f2b45c; --warn-bg: rgba(242, 180, 92, 0.12); --danger: #ff7b8a; --skeleton: #1b1e2a;
    --topo-bg: rgba(10, 11, 16, 0.80);
    --shadow: 0 20px 50px -24px rgba(0, 0, 0, 0.7);
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0a0b10; --surface: #12141c; --surface-2: #181b26; --photo: #f4f5f9; --ink: #eef0f6; --muted: #9aa0b4;
  --line: rgba(255, 255, 255, 0.09); --line-forte: rgba(255, 255, 255, 0.18);
  --accent: #9b85ff; --accent-ink: #0a0b10; --accent-soft: rgba(124, 92, 255, 0.20);
  --tag: rgba(34, 211, 238, 0.15); --tag-ink: #67e0f2;
  --good: #5fd18a; --good-bg: rgba(95, 209, 138, 0.14); --off: #ff7b8a; --off-bg: rgba(255, 123, 138, 0.12);
  --warn: #f2b45c; --warn-bg: rgba(242, 180, 92, 0.12); --danger: #ff7b8a; --skeleton: #1b1e2a;
  --topo-bg: rgba(10, 11, 16, 0.80);
  --shadow: 0 20px 50px -24px rgba(0, 0, 0, 0.7);
  color-scheme: dark;
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 var(--font-body); -webkit-font-smoothing: antialiased; }
button, input, select { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.envoltorio { max-width: 1240px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
h1, h2, h3 { margin: 0; text-wrap: balance; }
.nd { color: var(--muted); font-weight: 500; }
.link { background: none; border: 0; padding: 0; color: var(--accent); font-weight: 700; font-size: 14px; }
.link:hover { text-decoration: underline; }
.botao {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 0; text-decoration: none;
  background: var(--gradiente); color: var(--na-gradiente); font-weight: 700; padding: 10px 18px; border-radius: 999px; font-size: 14.5px; white-space: nowrap;
  box-shadow: 0 10px 26px -14px rgba(124, 92, 255, 0.7); transition: transform 0.15s ease;
}
.botao:hover:not(:disabled) { transform: translateY(-1px); }
.botao:disabled { opacity: 0.45; cursor: not-allowed; filter: none; }
.botao-sec {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--line); background: var(--surface);
  color: var(--ink); text-decoration: none; font-weight: 700; padding: 9px 16px; border-radius: 999px; font-size: 14px; white-space: nowrap;
}
.botao-sec:hover { border-color: var(--line-forte); }

/* Topo */
.topo { position: sticky; top: 0; z-index: 30; background: var(--topo-bg); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-bottom: 1px solid var(--line); padding-block: calc(10px + env(safe-area-inset-top, 0px)) 10px; }
.icone-btn { width: 36px; height: 36px; flex: none; display: inline-grid; place-items: center; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); padding: 0; }
.icone-btn:hover { color: var(--ink); border-color: var(--line-forte); }
.icone-btn svg { width: 18px; height: 18px; }
.topo .envoltorio { display: flex; align-items: center; justify-content: space-between; gap: 12px; position: relative; }
.marca { display: inline-flex; align-items: center; gap: 10px; color: var(--ink); text-decoration: none; font-family: var(--font-display); font-weight: 700; font-size: 1.05rem; letter-spacing: -0.02em; min-width: 0; flex: 0 1 auto; }
.marca span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.marca:hover, .marca:focus-visible { text-decoration: none; color: var(--ink); }
.topo .envoltorio > .marca { margin-right: auto; }
.topo-acoes { flex: none; }
.marca svg { display: block; flex: none; }
.botao-conta { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 6px 12px 6px 7px; font-size: 13.5px; font-weight: 600; }
.botao-conta .bolinha { width: 24px; height: 24px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; }
.painel-conta { position: absolute; right: max(16px, env(safe-area-inset-right, 0px)); top: calc(100% + 6px); z-index: 40; width: min(340px, calc(100% - 32px)); background: var(--surface); border: 1px solid var(--line); border-radius: var(--raio); box-shadow: var(--shadow); padding: 16px; display: grid; gap: 10px; }
.painel-conta h2 { font-family: var(--font-display); font-size: 18px; }
.painel-conta p { margin: 0; color: var(--muted); font-size: 14px; }
.painel-conta ul { margin: 0; padding-left: 18px; font-size: 14px; display: grid; gap: 4px; }
.botao-conta .bolinha.foto { position: relative; overflow: hidden; font: 800 12px var(--font-body); }
.botao-conta .bolinha.foto .logo, .conta-foto .logo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.girando { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--accent); display: inline-block; }
@media (prefers-reduced-motion: no-preference) { .girando { animation: gira 0.8s linear infinite; } @keyframes gira { to { transform: rotate(360deg); } } }
.conta-cabeca { display: flex; align-items: center; gap: 10px; }
.conta-cabeca > div { display: grid; min-width: 0; flex: 1; }
.conta-cabeca strong { font-size: 16px; }
.conta-cabeca span { font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conta-cabeca .fechar { width: 30px; height: 30px; font-size: 18px; flex: none; }
.conta-foto { position: relative; overflow: hidden; width: 42px; height: 42px; border-radius: 50%; flex: none; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); font-weight: 800; }
.sinc { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ponto { width: 9px; height: 9px; border-radius: 50%; background: var(--good); flex: none; }
.ponto.alerta { background: var(--off); }
.ponto.girando { background: none; }
.conta-acoes { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.botao-google {
  display: inline-flex; align-items: center; justify-content: center; gap: 10px; width: 100%; border: 1px solid #dadce0; background: #fff; color: #1f1f1f;
  border-radius: 999px; padding: 11px 16px; font: 600 15px/1 var(--font-body);
}
.botao-google:hover { background: #f8faf9; box-shadow: 0 1px 3px rgb(0 0 0 / 0.12); }
.nota-conta { font-size: 12.5px !important; }
.nota-conta a { color: var(--accent); }
.em-breve { justify-self: start; font-size: 12px; font-weight: 700; color: var(--warn); background: var(--warn-bg); padding: 2px 10px; border-radius: 999px; }

/* Busca */
.heroi { padding-block: 28px 10px; transition: padding 0.2s; }
.heroi h1 { font-family: var(--font-display); font-weight: 800; font-size: clamp(30px, 5.4vw, 52px); line-height: 1.06; letter-spacing: -0.03em; max-width: 16ch; }
.heroi h1 em { font-style: normal; background: var(--gradiente); -webkit-background-clip: text; background-clip: text; color: transparent; }
.heroi .sub { color: var(--muted); margin: 10px 0 0; max-width: 60ch; font-size: 16px; }
body.buscou .heroi { padding-block: 14px 6px; }
body.buscou .heroi h1, body.buscou .heroi .sub { display: none; }
.caixa-busca { margin-top: 20px; background: var(--surface); border: 1px solid var(--line); border-radius: 18px; box-shadow: var(--shadow); padding: 6px; display: flex; gap: 6px; align-items: stretch; }
body.buscou .caixa-busca { margin-top: 0; }
.campo-q { flex: 1 1 auto; display: flex; align-items: center; gap: 10px; padding: 0 12px; min-width: 0; }
.campo-q svg { color: var(--muted); flex: none; }
.campo-q input { border: 0; background: transparent; width: 100%; min-width: 0; padding: 12px 0; font-size: 16.5px; outline: none; }
.caixa-busca:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow); }
.campo-cep { flex: 0 0 150px; display: flex; align-items: center; gap: 7px; padding: 0 12px; border-left: 1px solid var(--line); color: var(--muted); min-width: 0; }
.campo-cep input { border: 0; background: transparent; width: 100%; min-width: 0; padding: 12px 0; font-size: 15.5px; outline: none; color: var(--ink); font-variant-numeric: tabular-nums; }
#status .regiao { display: block; font-size: 13px; color: var(--muted); margin-top: 2px; }

/* Menu de ordena\xE7\xE3o do pr\xF3prio app */
.ordenar-menu { position: relative; }
#botao-ordem { gap: 7px; }
#botao-ordem strong { font-weight: 800; }
#botao-ordem .ordem-rotulo { color: var(--muted); font-weight: 600; }
#botao-ordem .seta { transition: transform 0.15s; }
#botao-ordem[aria-expanded="true"] .seta { transform: rotate(180deg); }
.menu-ordem {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 35; width: 260px; background: var(--surface); border: 1px solid var(--line);
  border-radius: 14px; box-shadow: var(--shadow); padding: 6px; display: grid; gap: 2px;
}
.menu-cabeca { display: none; }
.opcao-ordem {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; border: 0; background: none; border-radius: 10px;
  padding: 10px 12px; font-size: 14.5px; font-weight: 600; color: var(--ink);
}
.opcao-ordem:hover { background: var(--surface-2); }
.opcao-ordem .marca-ok { width: 18px; height: 18px; flex: none; color: var(--accent); visibility: hidden; }
.opcao-ordem[aria-selected="true"] { color: var(--accent); background: var(--accent-soft); }
.opcao-ordem[aria-selected="true"] .marca-ok { visibility: visible; }
.opcao-ordem small { display: block; font-size: 12px; font-weight: 500; color: var(--muted); }
.caixa-busca .botao { padding-inline: 22px; font-size: 15.5px; }
#sugestoes { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
body.buscou #sugestoes { display: none; }
.sugestao { border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 5px 13px; font-size: 13.5px; color: var(--muted); font-weight: 500; }
.sugestao:hover { color: var(--accent); border-color: var(--accent); }

/* Resultados */
#resultados { padding-block: 16px 120px; display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); }
#resultados > * { min-width: 0; }
.barra-res { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; }
#status { margin: 0; font-size: 15px; }
#status .meta { color: var(--muted); font-size: 13.5px; }
.controles { display: flex; gap: 8px; align-items: center; }
#botao-filtros { display: none; }
.contador { margin-left: 2px; background: var(--gradiente); color: var(--na-gradiente); border-radius: 999px; font-size: 11.5px; min-width: 19px; height: 19px; display: inline-grid; place-items: center; padding: 0 5px; }
#aviso-demo { margin: 0; font-size: 13.5px; color: var(--warn); background: var(--warn-bg); padding: 8px 12px; border-radius: 10px; }
#chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
#chips:empty { display: none; }
.chip-ativo { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--accent); background: var(--accent-soft); color: var(--accent); border-radius: 999px; padding: 4px 8px 4px 12px; font-size: 13px; font-weight: 700; }
.chip-ativo span { font-size: 16px; line-height: 1; }

/* Destaques */
.destaques { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); }
.destaque {
  text-align: left; background: var(--surface); border: 1px solid var(--line); border-radius: var(--raio); padding: 12px 14px;
  display: grid; gap: 2px; align-content: start; transition: border-color 0.15s, transform 0.15s;
}
.destaque:hover { border-color: var(--accent); }
.destaque.principal { background: var(--gradiente); color: var(--na-gradiente); border-color: transparent; }
.d-rotulo { font-size: 11px; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase; opacity: 0.8; }
.d-valor { display: flex; align-items: baseline; gap: 2px; }
.d-valor .por { font-weight: 700; font-size: 14px; }
.d-sub { font-size: 13px; opacity: 0.8; }
.d-loja { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; margin-top: 4px; }

/* Valor com centavos pequenos */
.valor { display: inline-flex; align-items: flex-start; font-family: var(--font-display); font-weight: 800; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.valor .rs { font-size: 0.42em; margin: 0.18em 0.14em 0 0; font-weight: 700; letter-spacing: 0; }
.valor .int { font-size: 1em; }
.valor .cent { font-size: 0.46em; margin-top: 0.1em; font-weight: 700; }
.valor { font-size: 30px; }
.valor.pequeno { font-size: 26px; }
.valor.medio { font-size: 26px; }

/* Layout com filtros */
.layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 20px; align-items: start; }
#filtros { position: sticky; top: calc(env(safe-area-inset-top, 0px) + 12px); background: var(--surface); border: 1px solid var(--line); border-radius: var(--raio); max-height: calc(100vh - 24px); overflow: auto; }
#filtros-conteudo { padding: 14px 16px; display: grid; gap: 18px; }
.f-cabeca { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.f-cabeca h2 { font-family: var(--font-display); font-size: 19px; }
.fechar-sheet { display: none; }
.f-grupo { display: grid; gap: 8px; }
.f-grupo h3 { font-size: 12px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.lista-lojas { display: grid; gap: 2px; max-height: 300px; overflow: auto; margin-inline: -6px; }
.opcao-loja { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 6px; border-radius: 10px; font-size: 14px; cursor: pointer; }
.opcao-loja:hover { background: var(--surface-2); }
.opcao-loja input { width: 16px; height: 16px; accent-color: var(--accent); margin: 0; }
.ol-nome { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ol-info { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.faixa-preco { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.faixa-preco label { display: grid; gap: 4px; font-size: 12px; color: var(--muted); font-weight: 600; }
.faixa-preco input { width: 100%; min-width: 0; border: 1px solid var(--line); background: var(--surface-2); border-radius: 10px; padding: 8px 10px; font-size: 14px; }
.faixa-preco input:focus { border-color: var(--accent); outline: none; }
.interruptor { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; cursor: pointer; padding: 3px 0; }
.interruptor input { position: absolute; opacity: 0; pointer-events: none; }
.trilho { width: 36px; height: 21px; border-radius: 999px; background: var(--skeleton); position: relative; flex: none; transition: background 0.15s; }
.trilho::after { content: ""; position: absolute; top: 3px; left: 3px; width: 15px; height: 15px; border-radius: 50%; background: var(--surface); box-shadow: 0 1px 2px rgb(0 0 0 / 0.25); transition: transform 0.15s; }
.interruptor input:checked + .trilho { background: var(--gradiente); }
.interruptor input:checked + .trilho::after { transform: translateX(15px); }
.interruptor input:focus-visible + .trilho { outline: 2px solid var(--accent); outline-offset: 2px; }
.f-rodape { display: none; }

/* Cart\xF5es */
#grade { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 228px), 1fr)); }
.cartao { background: var(--surface); border: 1px solid var(--line); border-radius: var(--raio); overflow: hidden; display: flex; flex-direction: column; min-width: 0; transition: box-shadow 0.15s, border-color 0.15s; }
.cartao:hover { box-shadow: var(--shadow); }
.cartao.vencedor { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.cartao-foto { position: relative; background: var(--photo); aspect-ratio: 1 / 1; width: 100%; max-width: 100%; overflow: hidden; }
.cartao-foto .foto { position: absolute; inset: 8%; width: 84%; height: 84%; object-fit: contain; object-position: center; display: block; }
.selos { position: absolute; left: 10px; bottom: 10px; right: 10px; display: grid; gap: 4px; justify-items: start; }
.selo { font-size: 11px; font-weight: 800; letter-spacing: 0.02em; padding: 3px 8px; border-radius: 7px; white-space: nowrap; }
.selo.verde { background: #6d4cff; color: #fff; }
.selo.amarelo { background: var(--tag); color: var(--tag-ink); }
.off { position: absolute; left: 10px; top: 10px; background: var(--off); color: #fff; font-weight: 800; font-size: 12.5px; padding: 3px 8px; border-radius: 7px; }
.botao-comparar {
  position: absolute; right: 8px; top: 8px; display: inline-flex; align-items: center; gap: 5px; border: 1px solid #dfe5e2; background: rgb(255 255 255 / 0.92);
  color: #24302a; border-radius: 999px; padding: 4px 10px 4px 8px; font-size: 12px; font-weight: 700; backdrop-filter: blur(4px);
}
.botao-comparar[aria-pressed="true"] { background: #6d4cff; border-color: #6d4cff; color: #fff; }
.cartao-corpo { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
.loja-linha { display: flex; align-items: center; gap: 7px; min-width: 0; }
.loja-nome { font-weight: 800; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mais { font-size: 11.5px; font-weight: 700; color: var(--muted); background: var(--surface-2); border-radius: 999px; padding: 1px 7px; white-space: nowrap; }
.titulo { font-size: 14px; font-weight: 500; line-height: 1.38; color: var(--ink); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.76em; }
.nota { display: inline-flex; align-items: center; gap: 3px; font-size: 13px; font-weight: 700; color: #b7791f; }
.nota svg { color: #f2b01e; }
.qtd-av { color: var(--muted); font-weight: 500; margin-left: 2px; }
.preco-bloco { margin-top: auto; padding-top: 8px; border-top: 1px dashed var(--line); display: grid; gap: 3px; }
.rotulo-preco { font-size: 10.5px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.preco-linha { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.preco-linha s { color: var(--muted); font-size: 13px; }
.frete { font-size: 13px; color: var(--muted); }
.frete strong { color: var(--ink); font-weight: 700; }
.frete.bom { color: var(--good); font-weight: 700; }
.unit {
  justify-self: start; margin-top: 3px; font-size: 12.5px; font-weight: 800; color: var(--tag-ink); background: var(--tag);
  padding: 3px 9px 3px 14px; border-radius: 6px; position: relative; font-variant-numeric: tabular-nums;
}
.unit::before { content: ""; position: absolute; left: 4px; top: 50%; width: 5px; height: 5px; margin-top: -2.5px; border-radius: 50%; background: var(--surface); }
.acoes { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.acoes .botao { flex: 1 1 auto; }
.cartao.esq { min-height: 380px; background: linear-gradient(var(--skeleton) 0 58%, var(--surface) 58%); border-color: var(--line); }
@media (prefers-reduced-motion: no-preference) {
  .cartao.esq { animation: pulsa 1.1s ease-in-out infinite alternate; }
  @keyframes pulsa { to { opacity: 0.55; } }
}
.vazio, .aviso-erro { grid-column: 1 / -1; background: var(--surface); border: 1px dashed var(--line); border-radius: var(--raio); padding: 20px; color: var(--muted); }
.aviso-erro { background: var(--warn-bg); color: var(--warn); border: 0; display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
.aviso-erro a { color: inherit; font-weight: 700; }

/* \xCDcone da loja */
.avatar {
  position: relative; flex: none; width: 22px; height: 22px; border-radius: 6px; overflow: hidden; display: inline-grid; place-items: center;
  background: hsl(var(--h) 70% 92%); color: hsl(var(--h) 55% 32%); font: 800 12px var(--font-body); border: 1px solid rgb(0 0 0 / 0.06);
}
.avatar .logo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #fff; padding: 2px; }
.avatar.mini { width: 18px; height: 18px; font-size: 10px; border-radius: 5px; }
.avatar.medio { width: 34px; height: 34px; font-size: 15px; border-radius: 9px; }

/* Bandeja de compara\xE7\xE3o */
.bandeja { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)); padding-left: max(12px, env(safe-area-inset-left, 0px)); padding-right: max(12px, env(safe-area-inset-right, 0px)); pointer-events: none; }
.bandeja-dentro {
  pointer-events: auto; max-width: 720px; margin: 0 auto; background: var(--ink); color: var(--bg); border-radius: 18px; padding: 10px 10px 10px 12px;
  display: flex; align-items: center; gap: 12px; box-shadow: 0 12px 40px rgb(0 0 0 / 0.3);
}
.bandeja-fotos { display: flex; gap: 6px; }
.mini-foto { width: 40px; height: 40px; border-radius: 10px; background: #fff; overflow: hidden; display: grid; place-items: center; }
.mini-foto .f { width: 100%; height: 100%; object-fit: contain; }
.mini-foto.vaga { background: transparent; border: 1.5px dashed rgb(255 255 255 / 0.3); }
.bandeja-texto { flex: 1; font-size: 14px; font-weight: 600; min-width: 0; }
.bandeja .link { color: var(--bg); opacity: 0.8; }
.bandeja .botao { box-shadow: none; }
@media (max-width: 560px) { .mini-foto.vaga { display: none; } .bandeja-texto { font-size: 13px; } }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .bandeja-dentro { background: #eef0f6; color: #0a0b10; } :root:not([data-theme="light"]) .bandeja .link { color: #0a0b10; } :root:not([data-theme="light"]) .mini-foto.vaga { border-color: rgb(0 0 0 / 0.25); } }
:root[data-theme="dark"] .bandeja-dentro { background: #eef0f6; color: #0a0b10; }
:root[data-theme="dark"] .bandeja .link { color: #0a0b10; }

/* Di\xE1logos */
dialog {
  border: 0; padding: 0; background: var(--surface); color: var(--ink); border-radius: 20px; width: min(760px, calc(100vw - 32px));
  max-height: calc(100dvh - 48px); overflow: auto; box-shadow: 0 24px 80px rgb(0 0 0 / 0.35);
}
dialog::backdrop { background: rgb(10 11 16 / 0.6); backdrop-filter: blur(2px); }
@media (max-width: 640px) {
  dialog { width: 100vw; max-width: 100vw; margin: auto 0 0; border-radius: 20px 20px 0 0; max-height: 92dvh; padding-bottom: env(safe-area-inset-bottom, 0px); }
}
.dlg-cabeca { position: sticky; top: 0; z-index: 2; background: var(--surface); display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line); }
.dlg-cabeca h2 { font-family: var(--font-display); font-size: 20px; }
.fechar, .fechar-sheet { width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line); background: var(--surface-2); font-size: 20px; line-height: 1; }
.det-produto { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 16px; padding: 16px 18px; }
@media (max-width: 480px) { .det-produto { grid-template-columns: 96px minmax(0, 1fr); gap: 12px; } }
.det-foto { width: 100%; aspect-ratio: 1 / 1; object-fit: contain; background: var(--photo); border-radius: 14px; border: 1px solid var(--line); padding: 6px; display: block; }
.det-info { display: grid; gap: 6px; align-content: start; min-width: 0; }
.det-info h3 { font-size: 16.5px; font-weight: 700; line-height: 1.35; }
.det-tamanho, .det-oferta { margin: 0; font-size: 13.5px; color: var(--muted); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.form-tamanho { display: flex; flex-wrap: wrap; gap: 6px; }
.form-tamanho input { flex: 1 1 180px; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; background: var(--surface-2); min-width: 0; }
.erro-campo { margin: 0; width: 100%; color: var(--danger); font-size: 13px; }
.det-sub { font-size: 15px; font-weight: 800; padding: 4px 18px 8px; }
.lojas { list-style: none; margin: 0; padding: 0 18px; display: grid; gap: 8px; }
.lojas li {
  display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto; grid-template-areas: "loja preco ir" "extras extras extras";
  gap: 8px 14px; align-items: center; border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; background: var(--surface);
}
.lojas li.mais-barata { border-color: var(--accent); background: color-mix(in srgb, var(--accent-soft) 45%, var(--surface)); }
.l-loja { grid-area: loja; display: flex; gap: 10px; align-items: center; min-width: 0; }
.l-loja > div { display: grid; gap: 2px; justify-items: start; min-width: 0; }
.l-nome { font-weight: 800; font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.l-preco { grid-area: preco; display: grid; gap: 2px; }
.l-extras { grid-area: extras; display: flex; flex-wrap: wrap; gap: 5px; }
.l-ir { grid-area: ir; }
.chip { font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 999px; background: var(--surface-2); color: var(--muted); border: 1px solid var(--line); }
.chip.cupom { background: var(--tag); color: var(--tag-ink); border-color: transparent; font-weight: 800; }
@media (max-width: 560px) {
  .lojas li { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "loja preco" "extras extras" "ir ir"; }
  .l-ir.botao { width: 100%; }
}
.lojas-carregando { padding: 0 18px; display: grid; gap: 8px; }
.lojas-carregando span { height: 64px; border-radius: 14px; background: var(--skeleton); }
.nota-tabela { margin: 12px 18px 18px; font-size: 12.5px; color: var(--muted); }
.tabela-rolagem { overflow-x: auto; padding: 4px 18px 0; }
.tabela-comparar { border-collapse: separate; border-spacing: 0; width: 100%; min-width: 520px; font-size: 14px; }
.tabela-comparar th, .tabela-comparar td { padding: 10px 10px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
.tabela-comparar tbody th { color: var(--muted); font-weight: 700; font-size: 13px; white-space: nowrap; }
.tabela-comparar td { font-variant-numeric: tabular-nums; }
.tabela-comparar td.melhor { background: var(--good-bg); color: var(--good); font-weight: 700; }
.tc-produto { display: grid; gap: 6px; min-width: 140px; }
.tc-foto { width: 84px; height: 84px; object-fit: contain; background: var(--photo); border-radius: 12px; border: 1px solid var(--line); }
.tc-titulo { font-size: 13px; font-weight: 600; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.tc-loja { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 800; }

.aviso { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(96px + env(safe-area-inset-bottom, 0px)); background: var(--ink); color: var(--bg); padding: 10px 16px; border-radius: 999px; font-size: 14px; z-index: 50; max-width: calc(100% - 32px); }

/* Celular e tablet: filtros num painel que sobe de baixo */
@media (max-width: 900px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  #botao-filtros { display: inline-flex; }
  #filtros {
    position: fixed; left: 0; right: 0; bottom: 0; top: auto; z-index: 45; max-height: 85dvh; border-radius: 20px 20px 0 0; border: 0;
    transform: translateY(105%); transition: transform 0.22s ease; box-shadow: 0 -12px 40px rgb(0 0 0 / 0.25);
    padding-bottom: env(safe-area-inset-bottom, 0px); padding-left: env(safe-area-inset-left, 0px); padding-right: env(safe-area-inset-right, 0px);
  }
  body.filtros-abertos #filtros { transform: none; }
  body.filtros-abertos::after { content: ""; position: fixed; inset: 0; background: rgb(10 11 16 / 0.55); z-index: 44; }
  .fechar-sheet { display: inline-grid; place-items: center; }
  .f-cabeca .link { margin-left: auto; }
  .f-rodape { display: block; position: sticky; bottom: 0; background: var(--surface); padding-top: 8px; }
  .f-rodape .botao { width: 100%; }
  .ordem-rotulo { display: none; }
  .menu-ordem {
    position: fixed; left: 0; right: 0; bottom: 0; top: auto; width: auto; z-index: 46; border-radius: 20px 20px 0 0; border: 0;
    padding: 8px 10px calc(14px + env(safe-area-inset-bottom, 0px)); box-shadow: 0 -12px 40px rgb(0 0 0 / 0.25);
  }
  .menu-cabeca { display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 10px; font-family: var(--font-display); font-size: 19px; font-weight: 800; }
  body.ordem-aberta::after { content: ""; position: fixed; inset: 0; background: rgb(10 11 16 / 0.55); z-index: 44; }
  .opcao-ordem { padding: 13px 12px; font-size: 15.5px; }
}
@media (max-width: 560px) {
  .caixa-busca { flex-wrap: wrap; }
  .campo-q { flex: 1 1 0; }
  .campo-cep { display: none; flex: 1 1 100%; order: 3; border-left: 0; border-top: 1px solid var(--line); padding-block: 2px; }
  .caixa-busca.expandida .campo-cep { display: flex; }
  .caixa-busca.expandida .botao { order: 4; flex: 1 1 100%; padding-block: 12px; }
  #grade { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .cartao-corpo { padding: 10px 10px 12px; }
  .valor { font-size: 25px; }
  .botao-comparar span { display: none; }
  .botao-comparar { padding: 6px; }
  .acoes .botao, .acoes .botao-sec { width: 100%; font-size: 13.5px; padding-inline: 8px; }
  .destaques { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scroll-padding-inline: 16px; margin-inline: -16px; padding-inline: 16px; scrollbar-width: none; }
  .destaques::-webkit-scrollbar { display: none; }
  .destaque { flex: 0 0 72%; scroll-snap-align: start; padding: 10px 12px; }
  .mais { display: none; }
  .selo { font-size: 10.5px; white-space: normal; }
  .valor.pequeno { font-size: 22px; }
  .caixa-busca .botao { padding-inline: 14px; }
}
/* Combina com a busca, parecidos, frete e ofertas suas */
#status .fora { display: block; font-size: 13px; color: var(--muted); margin-top: 2px; }
.seu { color: var(--muted); font-weight: 500; font-size: 12px; }
.link.mini { font-size: 12.5px; text-decoration: underline; text-underline-offset: 2px; }
.parecidos {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 0; background: none; color: var(--muted);
  font-size: 12.5px; font-weight: 700; padding: 4px 0 0;
}
.parecidos:hover, .parecidos.ativo { color: var(--accent); }
.botao-sec.perigo { color: var(--danger); }
.form-frete { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 2px; }
.form-frete span { font-size: 13px; color: var(--muted); font-weight: 700; }
.form-frete input { flex: 1 1 70px; min-width: 0; border: 1px solid var(--line); background: var(--surface-2); border-radius: 9px; padding: 6px 8px; font-size: 14px; }
.form-frete input:focus { border-color: var(--accent); outline: none; }
.form-frete .botao { padding: 6px 12px; font-size: 13px; border-radius: 9px; }
.det-acoes { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.det-acoes .botao-sec { font-size: 13px; padding: 7px 12px; }
.manual { background: var(--surface); border: 1px solid var(--line); border-radius: var(--raio); padding: 0 16px; }
.manual summary { cursor: pointer; padding: 14px 0; font-weight: 700; color: var(--accent); }
.form-manual { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); padding-bottom: 16px; }
.form-manual label { display: grid; gap: 4px; font-size: 13px; font-weight: 600; color: var(--muted); min-width: 0; }
.form-manual input { width: 100%; min-width: 0; border: 1px solid var(--line); background: var(--surface-2); border-radius: 10px; padding: 9px 10px; font-size: 14px; color: var(--ink); }
.form-manual input:focus { border-color: var(--accent); outline: none; }
.form-manual .largo { grid-column: 1 / -1; }
.form-manual .botao { justify-self: start; grid-column: 1 / -1; }
/* Filtros da busca: marca, tamanho, cor, caracter\xEDsticas */
.chips-filtro { display: flex; flex-wrap: wrap; gap: 6px; }
.chip-filtro {
  display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); background: var(--surface); color: var(--ink);
  border-radius: 999px; padding: 5px 11px; font-size: 13px; font-weight: 600; line-height: 1.2; white-space: nowrap;
}
.chip-filtro .n { font-size: 11.5px; color: var(--muted); font-weight: 700; font-variant-numeric: tabular-nums; }
.chip-filtro:hover { border-color: var(--accent); }
.chip-filtro[aria-pressed="true"] { background: var(--gradiente); border-color: transparent; color: var(--na-gradiente); }
.chip-filtro[aria-pressed="true"] .n { color: inherit; opacity: 0.8; }
.chip-filtro.vazio { opacity: 0.4; cursor: default; }
.chip-filtro.vazio:hover { border-color: var(--line); }
.f-grupo .link.mini { justify-self: start; }
#faixa-rapida:empty { display: none; }
.faixa-rapida { display: flex; gap: 6px; align-items: center; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
.faixa-rapida::-webkit-scrollbar { display: none; }
.fr-nome { font-size: 12px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-right: 4px; white-space: nowrap; }
@media (max-width: 560px) { .faixa-rapida { margin-inline: -16px; padding-inline: 16px; } }
/* Topo: salvos */
.topo-acoes { display: flex; gap: 8px; align-items: center; }
.botao-salvos { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 6px 12px; font-size: 13.5px; font-weight: 700; color: var(--ink); }
.botao-salvos svg { color: #e11d48; }
.botao-salvos .contador { margin-left: 0; }
@media (max-width: 420px) { .rotulo-salvos, .rotulo-conta { display: none; } .botao-conta { padding: 6px; } .marca { font-size: 0.98rem; gap: 8px; } .topo-acoes { gap: 6px; } }

/* Cora\xE7\xE3o e varia\xE7\xE3o de pre\xE7o */
.coracao { margin-left: auto; flex: none; width: 34px; height: 34px; margin-block: -6px; margin-right: -6px; border: 0; background: none; color: var(--muted); display: grid; place-items: center; border-radius: 50%; }
.coracao:hover { color: #e11d48; background: var(--surface-2); }
.coracao[aria-pressed="true"] { color: #e11d48; }
@media (prefers-reduced-motion: no-preference) { .coracao[aria-pressed="true"] svg { animation: pulso 0.3s ease-out; } @keyframes pulso { 50% { transform: scale(1.25); } } }
.variacao { justify-self: start; font-size: 12px; font-weight: 800; padding: 2px 8px; border-radius: 6px; }
.variacao.caiu { background: var(--good-bg); color: var(--good); }
.variacao.subiu { background: var(--off-bg); color: var(--off); }
.det-acoes .salvar svg { color: #e11d48; }
.det-acoes .salvar.ativo { border-color: #e11d48; }

/* Meus salvos */
.abas { display: flex; gap: 6px; overflow-x: auto; padding: 12px 18px 4px; scrollbar-width: none; align-items: center; }
.abas::-webkit-scrollbar { display: none; }
.aba { flex: none; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 6px 12px; font-size: 13.5px; font-weight: 700; white-space: nowrap; }
.aba svg { width: 14px; height: 14px; color: #e11d48; }
.aba .n { font-size: 11.5px; color: var(--muted); }
.aba.ativa { background: var(--gradiente); color: var(--na-gradiente); border-color: transparent; }
.aba.ativa svg { color: inherit; }
.aba.ativa .n { color: inherit; opacity: 0.7; }
.nova-lista input { width: 140px; border: 1px dashed var(--line); background: transparent; border-radius: 999px; padding: 6px 12px; font-size: 13.5px; }
.nova-lista input:focus { border-style: solid; border-color: var(--accent); outline: none; width: 180px; }
.salvos-corpo { padding: 8px 18px 0; display: grid; gap: 10px; }
.lista-cabeca { display: flex; justify-content: space-between; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
.lista-cabeca h3 { font-family: var(--font-display); font-size: 20px; }
.lista-acoes { display: flex; gap: 12px; }
.link.perigo { color: var(--danger); }
.botao.perigo { background: var(--danger); color: #fff; }
.form-lista { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.form-lista input { flex: 1 1 180px; min-width: 0; border: 1px solid var(--line); background: var(--surface-2); border-radius: 10px; padding: 8px 10px; font-size: 14px; color: var(--ink); }
.form-lista input:focus { border-color: var(--accent); outline: none; }
.confirma { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; background: var(--warn-bg); color: var(--warn); padding: 10px 12px; border-radius: 12px; font-size: 14px; }
.confirma span { flex: 1 1 220px; }
.salvos { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.salvos li { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 12px; border: 1px solid var(--line); border-radius: 14px; padding: 10px; }
.sv-foto { width: 76px; height: 76px; object-fit: contain; background: var(--photo); border-radius: 10px; display: block; padding: 4px; }
.sv-info { display: grid; gap: 3px; min-width: 0; }
.sv-loja { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 800; }
.sv-titulo { font-size: 14px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sv-precos { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 13px; font-variant-numeric: tabular-nums; }
.sv-precos strong { font-size: 16px; }
.sv-acoes { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin-top: 4px; }
.qtd { display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
.qtd button { border: 0; background: var(--surface-2); width: 30px; height: 28px; font-size: 16px; font-weight: 700; }
.qtd span { min-width: 28px; text-align: center; font-weight: 800; font-size: 14px; font-variant-numeric: tabular-nums; }
.vazio-salvos { display: grid; justify-items: center; gap: 6px; padding: 28px 12px; color: var(--muted); text-align: center; }
.vazio-salvos svg { width: 34px; height: 34px; color: #e11d48; }
.vazio-salvos p { margin: 0; max-width: 34ch; }
dialog.pequeno { width: min(420px, calc(100vw - 32px)); }
@media (max-width: 640px) { dialog.pequeno { width: 100vw; } }
.dl-produto { margin: 12px 18px 4px; font-size: 14px; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.dl-listas { display: grid; padding: 4px 12px; }
.dl-opcao { display: flex; align-items: center; gap: 10px; padding: 10px 6px; border-radius: 10px; font-weight: 700; cursor: pointer; }
.dl-opcao:hover { background: var(--surface-2); }
.dl-opcao input { width: 18px; height: 18px; accent-color: var(--accent); margin: 0; }
.dl-opcao .nd { margin-left: auto; font-size: 12.5px; }
dialog .form-lista { padding: 6px 18px; }
.dl-rodape { display: flex; justify-content: flex-end; padding: 10px 18px 18px; }
.aviso { display: flex; align-items: center; gap: 12px; }
.aviso button { border: 0; background: var(--gradiente); color: var(--na-gradiente); border-radius: 999px; padding: 4px 12px; font-weight: 800; font-size: 13px; white-space: nowrap; }

.rodape { border-top: 1px solid var(--line); padding-block: 18px 28px; color: var(--muted); font-size: 12.5px; }
.rodape .envoltorio { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px 14px; text-align: center; }
.rodape-marca { display: inline-flex; align-items: center; gap: 8px; color: var(--ink); text-decoration: none; font: 800 1rem var(--font-display); letter-spacing: -0.02em; }
.rodape-marca svg { width: 28px; height: 28px; flex: none; }
.rodape-marca .ponto { background: var(--gradiente); -webkit-background-clip: text; background-clip: text; color: transparent; font-weight: 600; font-size: 0.82em; }
</style>
</head>
<body>
<header class="topo">
  <div class="envoltorio">
    <a class="marca" href="./" aria-label="Minhas Compras \u2014 in\xEDcio"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="34" height="34" aria-hidden="true"> <defs> <linearGradient id="mc-g" x1="110" y1="400" x2="420" y2="110" gradientUnits="userSpaceOnUse"> <stop offset="0" stop-color="#7c5cff"/> <stop offset="1" stop-color="#22d3ee"/> </linearGradient> <radialGradient id="mc-brilho" cx="0.2" cy="0.1" r="0.9"> <stop offset="0" stop-color="#2a2160"/> <stop offset="1" stop-color="#0a0b10"/> </radialGradient> </defs> <rect width="512" height="512" rx="116" fill="url(#mc-brilho)"/> <g transform="translate(256 262) rotate(-45)"> <path d="M-150 -92 a26 26 0 0 1 26 -26 h190 a26 26 0 0 1 18 7.5 l78 78 a26 26 0 0 1 0 37 l-78 78 a26 26 0 0 1 -18 7.5 h-190 a26 26 0 0 1 -26 -26 z" fill="url(#mc-g)"/> <circle cx="96" cy="0" r="17" fill="#0a0b10"/> </g> <path d="M170 276L212 318L290 240" fill="none" stroke="#0a0b10" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/> </svg><span>Minhas Compras</span></a>
    <div class="topo-acoes">
    <button type="button" id="tema" class="icone-btn" aria-label="Mudar tema"></button>
    <button type="button" class="botao-salvos" id="botao-salvos" data-acao="abrir-salvos">
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.3C1.4 7.8 3.6 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.4 0 5.6 3.3 4.3 6.7-1.8 4.7-9.3 9.3-9.3 9.3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
      <span class="rotulo-salvos">Salvos</span><span class="contador" hidden>0</span>
    </button>
    <button type="button" class="botao-conta" id="botao-conta" aria-expanded="false" aria-controls="painel-conta">
      <span class="bolinha" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="5.5" r="3" fill="currentColor"/><path d="M2 15c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5z" fill="currentColor"/></svg></span>
      <span class="rotulo-conta">Entrar</span>
    </button>
    </div>
    <div class="painel-conta" id="painel-conta" hidden></div>
  </div>
</header>

<section class="heroi envoltorio" aria-labelledby="t-heroi">
  <h1 id="t-heroi">Onde est\xE1 o <em>melhor pre\xE7o</em> de verdade?</h1>
  <p class="sub">Busque qualquer produto. O app junta as ofertas de v\xE1rias lojas, soma o frete, mostra promo\xE7\xF5es e, quando d\xE1, o pre\xE7o por litro, quilo ou unidade.</p>
  <form class="caixa-busca" id="form-busca" role="search">
    <label class="campo-q" for="q">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 13l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <span class="sr">O que voc\xEA quer comprar?</span>
      <input id="q" name="q" type="search" placeholder="O que voc\xEA quer comprar?" autocomplete="off" enterkeyhint="search">
    </label>
    <label class="campo-cep" for="cep" title="Seu CEP, para ver o frete da sua regi\xE3o">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 15s5-4.6 5-8.5A5 5 0 0 0 3 6.5C3 10.4 8 15 8 15z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="6.5" r="1.8" fill="currentColor"/></svg>
      <span class="sr">Seu CEP</span>
      <input id="cep" name="cep" inputmode="numeric" placeholder="Seu CEP" autocomplete="postal-code" maxlength="9" enterkeyhint="search">
    </label>
    <button type="submit" class="botao">Buscar</button>
  </form>
  <div id="sugestoes">
    <button type="button" class="sugestao" data-q="sabonete l\xEDquido">Sabonete l\xEDquido</button>
    <button type="button" class="sugestao" data-q="fone de ouvido bluetooth">Fone bluetooth</button>
    <button type="button" class="sugestao" data-q="caf\xE9 torrado e mo\xEDdo 500g">Caf\xE9 500 g</button>
    <button type="button" class="sugestao" data-q="fralda descart\xE1vel G">Fralda</button>
    <button type="button" class="sugestao" data-q="air fryer 4 litros">Air fryer</button>
  </div>
</section>

<main id="resultados" class="envoltorio" hidden aria-live="polite">
  <div class="barra-res">
    <p id="status"></p>
    <div class="controles">
      <button type="button" class="botao-sec" id="botao-filtros" data-acao="abrir-filtros">Filtros</button>
      <div class="ordenar-menu">
        <button type="button" class="botao-sec" id="botao-ordem" data-acao="abrir-ordem" aria-haspopup="listbox" aria-expanded="false" aria-controls="menu-ordem">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3v10M4 13l-2.5-2.5M4 13l2.5-2.5M12 13V3M12 3L9.5 5.5M12 3l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span class="ordem-rotulo">Ordenar:</span><strong id="ordem-atual">Relev\xE2ncia</strong>
          <svg class="seta" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="menu-ordem" id="menu-ordem" role="listbox" aria-label="Ordenar por" hidden></div>
      </div>
    </div>
  </div>
  <p id="aviso-demo" hidden></p>
  <div id="faixa-rapida"></div>
  <div id="chips"></div>
  <div id="destaques"></div>
  <div class="layout">
    <aside id="filtros" aria-label="Filtros"><div id="filtros-conteudo"></div></aside>
    <section id="grade" aria-label="Ofertas"></section>
  </div>
  <details class="manual" id="manual">
    <summary>Achou em outra loja? Adicione \xE0 compara\xE7\xE3o</summary>
    <form class="form-manual" data-form="manual">
      <label for="m-loja">Loja<input id="m-loja" name="loja" placeholder="Mercado do bairro" autocomplete="off"></label>
      <label for="m-titulo" class="largo">Produto (com o tamanho, se tiver)<input id="m-titulo" name="titulo" placeholder="Sabonete l\xEDquido Palmolive Nutri-Milk refil 900 ml" autocomplete="off"></label>
      <label for="m-preco">Pre\xE7o (R$)<input id="m-preco" name="preco" inputmode="decimal" placeholder="21,90" autocomplete="off"></label>
      <label for="m-frete">Frete (R$)<input id="m-frete" name="frete" inputmode="decimal" placeholder="0 = gr\xE1tis" autocomplete="off"></label>
      <label for="m-link" class="largo">Link (opcional)<input id="m-link" name="link" type="url" placeholder="https://\u2026" autocomplete="off"></label>
      <p class="erro-campo largo" hidden></p>
      <button type="submit" class="botao">Adicionar \xE0 compara\xE7\xE3o</button>
    </form>
  </details>
</main>

<div class="bandeja" id="bandeja" hidden></div>
<dialog id="dlg-detalhe" aria-label="Onde comprar"></dialog>
<dialog id="dlg-comparar" aria-label="Comparar ofertas"></dialog>
<dialog id="dlg-salvos" aria-label="Meus salvos"></dialog>
<dialog id="dlg-listas" aria-label="Salvar em lista" class="pequeno"></dialog>
<div class="aviso" id="aviso" hidden role="status"></div>

<footer class="rodape">
  <div class="envoltorio">
    <a class="rodape-marca" href="https://marlenildo.online" target="_blank" rel="noopener" title="Conhe\xE7a outros apps em marlenildo.online">
      <svg viewBox="0 0 100 100" aria-hidden="true"><path d="M0,86 C8,86 20,24 32,24 C44,24 54,86 62,86 Z" fill="#7c5cff"/><path d="M38,86 C46,86 56,24 68,24 C80,24 92,86 100,86 Z" fill="#22d3ee" fill-opacity="0.78"/></svg>
      <span><span class="nome">Marlenildo</span><span class="ponto">.online</span></span>
    </a>
    <span>Minhas Compras n\xE3o vende nada e n\xE3o recebe dinheiro para mudar a ordem das ofertas.</span>
  </div>
</footer>
<script>
// Tema claro/escuro: autom\xE1tico pelo sistema ou escolhido no bot\xE3o do topo (como no Minhas Entregas)
(() => {
  const CHAVE = 'minhas-compras:tema';
  const b = document.getElementById('tema');
  const meta = document.querySelector('meta[name="theme-color"]');
  const SOL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const LUA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>';
  let tema = 'auto';
  try { tema = localStorage.getItem(CHAVE) || 'auto'; } catch (e) { /* sem armazenamento */ }
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const escuro = () => tema === 'dark' || (tema === 'auto' && mq.matches);
  function aplicar() {
    if (tema === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', tema);
    b.innerHTML = escuro() ? SOL : LUA;
    b.title = escuro() ? 'Usar tema claro' : 'Usar tema escuro';
    b.setAttribute('aria-label', b.title);
    if (meta) meta.setAttribute('content', escuro() ? '#0a0b10' : '#f5f6fa');
  }
  b.addEventListener('click', () => {
    tema = escuro() ? 'light' : 'dark';
    try { localStorage.setItem(CHAVE, tema); } catch (e) { /* sem armazenamento */ }
    aplicar();
  });
  mq.addEventListener && mq.addEventListener('change', aplicar);
  aplicar();
})();
<\/script>
<script>
(() => {
const M = {};
M['core.js'] = (() => {
// Motor de c\xE1lculo do app de compras.
// Fun\xE7\xF5es puras, sem depend\xEAncia de tela, para poderem ser testadas
// e reaproveitadas depois (app de celular, servidor, extens\xE3o etc.).

/** Unidades aceitas e como cada uma vira a unidade base do seu grupo. */
const UNIDADES = {
  ml: { grupo: 'volume', fator: 1 },
  l: { grupo: 'volume', fator: 1000 },
  g: { grupo: 'massa', fator: 1 },
  kg: { grupo: 'massa', fator: 1000 },
  un: { grupo: 'unidade', fator: 1 },
  m: { grupo: 'comprimento', fator: 1 },
};

/** Como mostrar o pre\xE7o de cada grupo: por litro, por kg, por unidade, por metro. */
const EXIBICAO = {
  volume: { fator: 1000, rotulo: 'litro', base: 'ml' },
  massa: { fator: 1000, rotulo: 'kg', base: 'g' },
  unidade: { fator: 1, rotulo: 'unidade', base: 'un' },
  comprimento: { fator: 1, rotulo: 'metro', base: 'm' },
};

const num = (v, padrao = 0) => {
  if (v === null || v === undefined || v === '') return padrao;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : padrao;
};

/** L\xEA um n\xFAmero digitado no formato brasileiro ("1.234,56") ou internacional ("1234.56"). */
function lerNumero(v, padrao = 0) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : padrao;
  if (v === null || v === undefined) return padrao;
  const s = String(v).trim().replace(/^r\\$\\s*/i, '');
  if (s === '') return padrao;
  // "1.234,56" \u2192 v\xEDrgula decimal; "1234.56" \u2192 ponto decimal
  if (s.includes(',')) return num(s, padrao);
  const n = Number(s);
  return Number.isFinite(n) ? n : padrao;
}

/** Quantidade total do an\xFAncio na unidade base (ml, g, un, m). */
function quantidadeDoAnuncio(oferta) {
  const u = UNIDADES[oferta.unidade] || UNIDADES.ml;
  const embalagens = Math.max(1, lerNumero(oferta.embalagens, 1));
  return embalagens * lerNumero(oferta.conteudo, 0) * u.fator;
}

function grupoDaOferta(oferta) {
  return (UNIDADES[oferta.unidade] || UNIDADES.ml).grupo;
}

/** Maior desconto por quantidade v\xE1lido para n unidades compradas. */
function descontoPorQuantidade(descontos, n) {
  let melhor = 0;
  for (const d of descontos || []) {
    const min = lerNumero(d.minQtd, 0);
    const pct = lerNumero(d.pct, 0);
    if (min > 0 && n >= min && pct > melhor) melhor = pct;
  }
  return Math.min(melhor, 100);
}

/**
 * Custo de comprar n an\xFAncios de uma oferta.
 * Regras:
 * - desconto por quantidade vale sobre o valor dos produtos;
 * - frete gr\xE1tis \xE9 conferido sobre o valor dos produtos j\xE1 com esse desconto
 *   (\xE9 assim que lojas como Mercado Livre e Amazon comparam com o m\xEDnimo);
 * - desconto no Pix vale sobre os produtos, n\xE3o sobre o frete;
 * - o frete informado \xE9 o do pedido, n\xE3o por unidade.
 */
function custoParaQuantidade(oferta, n) {
  const preco = lerNumero(oferta.preco, 0);
  const bruto = preco * n;
  const pctQtd = descontoPorQuantidade(oferta.descontos, n);
  const produtos = bruto * (1 - pctQtd / 100);
  const pctPix = Math.min(Math.max(lerNumero(oferta.pixPct, 0), 0), 100);
  const produtosPagos = produtos * (1 - pctPix / 100);
  const freteCheio = Math.max(lerNumero(oferta.frete, 0), 0);
  const limite = lerNumero(oferta.freteGratisAcima, 0);
  const ganhouFreteGratis = freteCheio > 0 && limite > 0 && produtos >= limite;
  const frete = ganhouFreteGratis ? 0 : freteCheio;
  const total = produtosPagos + frete;
  const quantidade = quantidadeDoAnuncio(oferta) * n;
  return {
    n,
    bruto,
    pctQtd,
    pctPix,
    produtos,
    produtosPagos,
    frete,
    freteCheio,
    ganhouFreteGratis,
    faltaParaFreteGratis: freteCheio > 0 && limite > 0 && !ganhouFreteGratis ? limite - produtos : 0,
    total,
    quantidade,
    custoPorBase: quantidade > 0 ? total / quantidade : Infinity,
  };
}

/** Uma oferta s\xF3 entra no c\xE1lculo se tiver pre\xE7o e conte\xFAdo. */
function ofertaValida(oferta) {
  return lerNumero(oferta.preco, 0) > 0 && quantidadeDoAnuncio(oferta) > 0;
}

/**
 * Escolhe, para uma oferta, quantas unidades vale a pena comprar.
 * - respeita a quantidade m\xEDnima que a pessoa precisa;
 * - n\xE3o passa do m\xE1ximo de unidades que ela aceita comprar;
 * - se levar mais economiza menos que a toler\xE2ncia (padr\xE3o 1%), fica com menos.
 */
function melhorCompraDaOferta(oferta, { quantidadeMinima = 0, maxUnidades = 10, tolerancia = 0.01 } = {}) {
  if (!ofertaValida(oferta)) return null;
  const porAnuncio = quantidadeDoAnuncio(oferta);
  const minimoN = Math.max(1, Math.ceil(lerNumero(quantidadeMinima, 0) / porAnuncio - 1e-9));
  const maxN = Math.max(minimoN, Math.floor(lerNumero(maxUnidades, 10)));
  const opcoes = [];
  for (let n = minimoN; n <= maxN; n++) opcoes.push(custoParaQuantidade(oferta, n));

  let melhor = opcoes[0];
  for (const o of opcoes) if (o.custoPorBase < melhor.custoPorBase - 1e-12) melhor = o;
  // Prefere a menor quantidade que fique dentro da toler\xE2ncia da melhor
  const escolhida = opcoes.find((o) => o.custoPorBase <= melhor.custoPorBase * (1 + tolerancia)) || melhor;
  const minima = opcoes[0];
  return { oferta, escolhida, minima, opcoes, dicas: dicasDaOferta(oferta, minima, escolhida) };
}

const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Frases curtas que explicam por que levar mais (ou o que falta para o frete gr\xE1tis). */
function dicasDaOferta(oferta, minima, escolhida) {
  const dicas = [];
  if (escolhida.n > minima.n) {
    const economia = 1 - escolhida.custoPorBase / minima.custoPorBase;
    const motivos = [];
    if (escolhida.pctQtd > minima.pctQtd) motivos.push(\`\${fmtPct(escolhida.pctQtd)} de desconto por quantidade\`);
    if (escolhida.ganhouFreteGratis && !minima.ganhouFreteGratis) motivos.push('frete gr\xE1tis');
    dicas.push(
      \`Levando \${escolhida.n} em vez de \${minima.n}, cada \${EXIBICAO[grupoDaOferta(oferta)].rotulo} sai \${fmtPct(economia * 100)} mais barato\` +
        (motivos.length ? \` (\${motivos.join(' e ')}).\` : '.')
    );
  }
  if (escolhida.faltaParaFreteGratis > 0) {
    dicas.push(\`Faltam \${brl(escolhida.faltaParaFreteGratis)} em produtos para o frete gr\xE1tis nesta loja.\`);
  }
  return dicas;
}

function fmtPct(v) {
  const arred = Math.round(v * 10) / 10;
  return \`\${arred.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%\`;
}

/**
 * Compara todas as ofertas e devolve o ranking do menor custo real.
 * Ofertas de outro grupo de unidade (ex.: gramas quando o produto \xE9 em ml)
 * ficam de fora e s\xE3o avisadas.
 */
function compararOfertas(ofertas, opcoes = {}) {
  const validas = ofertas.filter(ofertaValida);
  const grupo = opcoes.grupo || (validas[0] ? grupoDaOferta(validas[0]) : 'volume');
  const ignoradas = validas.filter((o) => grupoDaOferta(o) !== grupo);
  const incompletas = ofertas.filter((o) => !ofertaValida(o));
  const ranking = validas
    .filter((o) => grupoDaOferta(o) === grupo)
    .map((o) => melhorCompraDaOferta(o, opcoes))
    .filter(Boolean)
    .sort((a, b) => a.escolhida.custoPorBase - b.escolhida.custoPorBase || a.escolhida.total - b.escolhida.total);

  let economiaVsMaisCara = 0;
  if (ranking.length > 1) {
    const melhor = ranking[0].escolhida.custoPorBase;
    const pior = ranking[ranking.length - 1].escolhida.custoPorBase;
    economiaVsMaisCara = 1 - melhor / pior;
  }
  return { grupo, ranking, ignoradas, incompletas, economiaVsMaisCara };
}

/** Pre\xE7o na unidade de exibi\xE7\xE3o (por litro, por kg...). */
function precoExibido(custoPorBase, grupo) {
  return custoPorBase * EXIBICAO[grupo].fator;
}

// ---------------------------------------------------------------------------
// Leitura do t\xEDtulo do an\xFAncio
// ---------------------------------------------------------------------------

const RX_UNIDADE = '(ml|mililitros?|l|lt|litros?|g|gr|gramas?|kg|quilos?)';
const MAPA_UNIDADE = (u) => {
  u = u.toLowerCase();
  if (u.startsWith('ml') || u.startsWith('mili')) return 'ml';
  if (u === 'l' || u === 'lt' || u.startsWith('litro')) return 'l';
  if (u === 'kg' || u.startsWith('quilo')) return 'kg';
  return 'g';
};
const FIM = '(?![a-z\xE0-\xFA])';

/**
 * Tenta descobrir no t\xEDtulo quantas embalagens v\xEAm e o conte\xFAdo de cada uma.
 * Ex.: "Kit 3 Sabonete L\xEDquido 250ml" \u2192 { embalagens: 3, conteudo: 250, unidade: 'ml' }
 *      "Refil 2x900 ml"               \u2192 { embalagens: 2, conteudo: 900, unidade: 'ml' }
 * Devolve null quando n\xE3o encontra o conte\xFAdo.
 */
function lerTitulo(titulo) {
  if (!titulo) return null;
  const t = String(titulo).toLowerCase().replace(/\\s+/g, ' ');

  // "2x500ml", "2 x 500 ml", "2 un x 500ml"
  const mx = t.match(new RegExp(\`(\\\\d+)\\\\s*(?:un\\\\w*\\\\s*)?[x\xD7]\\\\s*(\\\\d+(?:[.,]\\\\d+)?)\\\\s*\${RX_UNIDADE}\${FIM}\`));
  if (mx) {
    return { embalagens: Number(mx[1]), conteudo: lerNumero(mx[2]), unidade: MAPA_UNIDADE(mx[3]) };
  }
  // "500ml x 2"
  const mx2 = t.match(new RegExp(\`(\\\\d+(?:[.,]\\\\d+)?)\\\\s*\${RX_UNIDADE}\${FIM}\\\\s*[x\xD7]\\\\s*(\\\\d+)\`));
  if (mx2) {
    return { embalagens: Number(mx2[3]), conteudo: lerNumero(mx2[1]), unidade: MAPA_UNIDADE(mx2[2]) };
  }

  const mv = t.match(new RegExp(\`(\\\\d+(?:[.,]\\\\d+)?)\\\\s*\${RX_UNIDADE}\${FIM}\`));
  if (!mv) return null;
  const conteudo = lerNumero(mv[1]);
  const unidade = MAPA_UNIDADE(mv[2]);

  let embalagens = 1;
  const padroes = [
    /\\bkit\\s*(?:com|c\\/|de)?\\s*(\\d+)/,
    /\\b(?:pack|combo|caixa|cx)\\s*(?:com|c\\/|de)?\\s*(\\d+)/,
    /\\bleve\\s*(\\d+)/,
    /\\b(\\d+)\\s*(?:unidades|unidade|unids?|uns?|un\\b|pe[c\xE7]as|frascos|refis|refil|sach[e\xEA]s|embalagens|pacotes|latas|garrafas)/,
    /\\bc\\/\\s*(\\d+)/,
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

return { UNIDADES, EXIBICAO, lerNumero, quantidadeDoAnuncio, grupoDaOferta, descontoPorQuantidade, custoParaQuantidade, ofertaValida, melhorCompraDaOferta, dicasDaOferta, fmtPct, compararOfertas, precoExibido, lerTitulo };
})();

M['config.js'] = (() => {
// Endere\xE7o do servidor de busca (pasta worker/), sem barra no final.
// Vazio = modo demonstra\xE7\xE3o, com produtos e pre\xE7os fict\xEDcios.
// Exemplo depois de publicar o servidor: 'https://minhas-compras-api.SEU-USUARIO.workers.dev'
const API_URL = 'https://minhas-compras-api.marlenildo.workers.dev';

return { API_URL };
})();

M['demo.js'] = (() => {
// Dados de demonstra\xE7\xE3o: produtos e pre\xE7os fict\xEDcios, usados quando o
// servidor de busca n\xE3o est\xE1 dispon\xEDvel (por exemplo, na p\xE1gina publicada no Claude).
// As imagens s\xE3o ilustra\xE7\xF5es desenhadas aqui, n\xE3o fotos de produtos reais.

function svg(conteudo, fundo) {
  const s = \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="\${fundo}"/>\${conteudo}</svg>\`;
  return \`data:image/svg+xml;charset=utf-8,\${encodeURIComponent(s)}\`;
}

const frasco = (x, y, e, cor) => \`
  <g transform="translate(\${x} \${y}) scale(\${e})">
    <rect x="-6" y="-78" width="12" height="18" rx="2" fill="#2b2f2d"/>
    <path d="M-6 -74 h-22 a6 6 0 0 0 -6 6 v3 h6 v-3 h22z" fill="#2b2f2d"/>
    <rect x="-14" y="-62" width="28" height="12" rx="3" fill="#3c423f"/>
    <path d="M-30 -48 q0 -6 8 -6 h44 q8 0 8 6 v96 q0 10 -10 10 h-40 q-10 0 -10 -10z" fill="\${cor}"/>
    <rect x="-20" y="-20" width="40" height="34" rx="4" fill="#ffffff" opacity=".85"/>
    <rect x="-14" y="-12" width="28" height="4" rx="2" fill="\${cor}" opacity=".8"/>
    <rect x="-14" y="-3" width="20" height="3" rx="1.5" fill="#9aa5a0"/>
  </g>\`;

const refil = (x, y, e, cor) => \`
  <g transform="translate(\${x} \${y}) scale(\${e})">
    <path d="M-40 -60 h80 l6 112 q1 10 -9 10 h-74 q-10 0 -9 -10z" fill="\${cor}"/>
    <rect x="-40" y="-66" width="80" height="10" rx="2" fill="\${cor}" opacity=".7"/>
    <rect x="12" y="-80" width="16" height="16" rx="3" fill="#2b2f2d"/>
    <rect x="-26" y="-18" width="52" height="40" rx="5" fill="#ffffff" opacity=".85"/>
    <rect x="-18" y="-9" width="36" height="5" rx="2.5" fill="\${cor}" opacity=".85"/>
  </g>\`;

const fone = (cor, corAlmofada) => \`
  <g transform="translate(100 104)">
    <path d="M-58 10 v-18 a58 58 0 0 1 116 0 v18" fill="none" stroke="\${cor}" stroke-width="12" stroke-linecap="round"/>
    <rect x="-74" y="0" width="34" height="58" rx="14" fill="\${cor}"/>
    <rect x="40" y="0" width="34" height="58" rx="14" fill="\${cor}"/>
    <rect x="-66" y="8" width="18" height="42" rx="8" fill="\${corAlmofada}"/>
    <rect x="48" y="8" width="18" height="42" rx="8" fill="\${corAlmofada}"/>
  </g>\`;

const foneIntra = (cor) => \`
  <g transform="translate(100 100)">
    <rect x="-50" y="-26" width="100" height="62" rx="28" fill="\${cor}"/>
    <rect x="-50" y="-26" width="100" height="22" rx="11" fill="#ffffff" opacity=".25"/>
    <circle cx="-22" cy="-44" r="16" fill="\${cor}"/><rect x="-26" y="-44" width="8" height="34" rx="4" fill="\${cor}"/>
    <circle cx="22" cy="-44" r="16" fill="\${cor}"/><rect x="18" y="-44" width="8" height="34" rx="4" fill="\${cor}"/>
    <circle cx="0" cy="22" r="3" fill="#ffffff" opacity=".8"/>
  </g>\`;

const CORES = { lavanda: '#8c7ac9', erva: '#4f9b78', algodao: '#5f93c6', mel: '#d39b3a' };
const FUNDOS = { lavanda: '#efedf8', erva: '#e8f3ee', algodao: '#e9f0f8', mel: '#f8f0e2' };

const img = {
  frasco: (c) => svg(frasco(100, 112, 1, CORES[c]), FUNDOS[c]),
  frascoPequeno: (c) => svg(frasco(100, 120, 0.8, CORES[c]), FUNDOS[c]),
  refil: (c) => svg(refil(100, 112, 1, CORES[c]), FUNDOS[c]),
  refil2: (c) => svg(refil(72, 116, 0.82, CORES[c]) + refil(128, 116, 0.82, CORES[c]), FUNDOS[c]),
  kit3: (c) => svg(frasco(56, 124, 0.68, CORES[c]) + frasco(100, 118, 0.74, CORES[c]) + frasco(144, 124, 0.68, CORES[c]), FUNDOS[c]),
  fonePreto: svg(fone('#26292b', '#4a4f52'), '#eef0f1'),
  foneBranco: svg(fone('#d9dde0', '#b9bfc4'), '#e9f0f8'),
  foneAzul: svg(fone('#2f5fa8', '#1f3f73'), '#e6eef9'),
  intraPreto: svg(foneIntra('#26292b'), '#eef0f1'),
  intraBranco: svg(foneIntra('#cfd5da'), '#f4f1ea'),
};

let seq = 0;
const item = (loja, titulo, preco, extra = {}) => ({
  id: \`demo:\${++seq}\`,
  fonte: 'demo',
  loja,
  lojaIcone: null,
  vendedor: null,
  lojaOficial: false,
  titulo,
  preco,
  precoOriginal: null,
  foto: null,
  link: '',
  linkDireto: false,
  token: \`demo-\${seq}\`,
  variasLojas: true,
  condicao: 'new',
  freteGratis: false,
  frete: null,
  avaliacao: null,
  avaliacoes: null,
  embalagens: null,
  conteudo: null,
  unidade: null,
  ...extra,
});

function sabonetes() {
  return [
    item('Mercado Livre', 'Kit 3 Sabonete L\xEDquido Marca X Algod\xE3o 250ml', 29.9, {
      foto: img.kit3('algodao'), freteGratis: true, frete: 0, embalagens: 3, conteudo: 250, unidade: 'ml', precoOriginal: 34.9, avaliacao: 4.8, avaliacoes: 2140,
    }),
    item('Mercado Livre', 'Sabonete L\xEDquido Marca X Erva-doce Refil 900ml', 21.49, {
      foto: img.refil('erva'), frete: null, embalagens: 1, conteudo: 900, unidade: 'ml', avaliacao: 4.7, avaliacoes: 860,
    }),
    item('Amazon', 'Sabonete L\xEDquido Marca X Lavanda Refil 2x900ml', 39.9, {
      foto: img.refil2('lavanda'), freteGratis: true, frete: 0, embalagens: 2, conteudo: 900, unidade: 'ml', precoOriginal: 47.8, avaliacao: 4.8, avaliacoes: 5310,
    }),
    item('Amazon', 'Sabonete L\xEDquido Marca X Lavanda 650ml com v\xE1lvula', 19.9, {
      foto: img.frasco('lavanda'), freteGratis: true, frete: 0, embalagens: 1, conteudo: 650, unidade: 'ml', avaliacao: 4.6, avaliacoes: 1205,
    }),
    item('Magalu', 'Sabonete L\xEDquido Marca X Mel Refil 900 ml', 23.9, {
      foto: img.refil('mel'), frete: 14.9, embalagens: 1, conteudo: 900, unidade: 'ml', avaliacao: 4.5, avaliacoes: 312,
    }),
    item('Drogasil', 'Sabonete L\xEDquido Marca X Algod\xE3o Refil 1L', 27.9, {
      foto: img.refil('algodao'), freteGratis: true, frete: 0, embalagens: 1, conteudo: 1, unidade: 'l', avaliacao: 4.7, avaliacoes: 98,
    }),
    item('Carrefour', 'Sabonete L\xEDquido Marca X Mel 400 ml', 12.9, {
      foto: img.frascoPequeno('mel'), frete: 6.9, embalagens: 1, conteudo: 400, unidade: 'ml', avaliacao: 4.4, avaliacoes: 57,
    }),
    item('Magalu', 'Kit 6 Sabonete L\xEDquido Marca X Erva-doce 250ml', 54.9, {
      foto: img.kit3('erva'), freteGratis: true, frete: 0, embalagens: 6, conteudo: 250, unidade: 'ml', avaliacao: 4.9, avaliacoes: 420,
    }),
    // Fora do assunto: o Google \xE0s vezes mistura produtos parecidos, e mais baratos
    item('Drogasil', 'Hidratante Corporal Marca X Algod\xE3o 400ml', 9.9, {
      foto: img.frascoPequeno('algodao'), freteGratis: true, frete: 0, embalagens: 1, conteudo: 400, unidade: 'ml', avaliacao: 4.6, avaliacoes: 3100,
    }),
    item('Carrefour', 'Sabonete em Barra Marca Z Erva-doce 90g', 2.49, {
      foto: img.frascoPequeno('erva'), frete: 6.9, embalagens: 1, conteudo: 90, unidade: 'g', avaliacao: 4.3, avaliacoes: 88,
    }),
  ];
}

function fones() {
  return [
    item('Amazon', 'Fone de Ouvido Bluetooth Marca Y Over-ear com Cancelamento de Ru\xEDdo', 389.9, {
      foto: img.fonePreto, freteGratis: true, frete: 0, precoOriginal: 499, avaliacao: 4.7, avaliacoes: 8320,
    }),
    item('Magalu', 'Fone de Ouvido Bluetooth Marca Y Over-ear com Cancelamento de Ru\xEDdo', 379, {
      foto: img.fonePreto, frete: 19.9, avaliacao: 4.7, avaliacoes: 8320,
    }),
    item('Mercado Livre', 'Fone Bluetooth Marca Z On-ear 40h de bateria Azul', 159.9, {
      foto: img.foneAzul, freteGratis: true, frete: 0, precoOriginal: 199.9, avaliacao: 4.5, avaliacoes: 2760,
    }),
    item('Casas Bahia', 'Fone Bluetooth Marca Z On-ear 40h de bateria Branco', 149, {
      foto: img.foneBranco, frete: 24.9, avaliacao: 4.4, avaliacoes: 940,
    }),
    item('Kabum', 'Fone Intra-auricular Bluetooth Marca W com estojo de carga', 89.9, {
      foto: img.intraPreto, frete: 12.5, avaliacao: 4.2, avaliacoes: 3100,
    }),
    item('Shopee', 'Fone Intra-auricular Bluetooth Marca W com estojo de carga', 79.9, {
      foto: img.intraPreto, freteGratis: true, frete: 0, avaliacao: 3.9, avaliacoes: 410,
    }),
    item('Amazon', 'Fone Intra-auricular Bluetooth Marca V Branco \xE0 prova d\u2019\xE1gua', 119, {
      foto: img.intraBranco, freteGratis: true, frete: 0, precoOriginal: 149, avaliacao: 4.6, avaliacoes: 1520,
    }),
    item('Fast Shop', 'Fone de Ouvido Bluetooth Marca Y Over-ear Edi\xE7\xE3o Azul', 429, {
      foto: img.foneAzul, freteGratis: true, frete: 0, avaliacao: 4.8, avaliacoes: 230,
    }),
  ];
}

const ehFone = (q) => /fone|headphone|headset|earbud|ouvido/i.test(q);

/** Resultados de demonstra\xE7\xE3o para uma busca. */
function buscaDemo(q) {
  seq = 0;
  const fone = ehFone(q);
  const conhecida = fone || /sabonete|sab[a\xE3]o|refil/i.test(q);
  return {
    itens: fone ? fones() : sabonetes(),
    // Como os filtros que o Google devolve junto com a busca
    filtros: fone
      ? [{ nome: 'Marca', opcoes: ['Marca Y', 'Marca Z', 'Marca W', 'Marca V'] }, { nome: 'Tipo', opcoes: ['Over-ear', 'On-ear', 'Intra-auricular'] }]
      : [{ nome: 'Fragr\xE2ncia', opcoes: ['Lavanda', 'Mel', 'Algod\xE3o', 'Erva-doce'] }],
    aviso: conhecida
      ? 'Demonstra\xE7\xE3o: produtos e pre\xE7os fict\xEDcios.'
      : 'Demonstra\xE7\xE3o: esta vers\xE3o s\xF3 tem dois exemplos (sabonete l\xEDquido e fone bluetooth), com pre\xE7os fict\xEDcios. Mostrando o sabonete.',
  };
}

/** Lojas de demonstra\xE7\xE3o para um produto: varia\xE7\xF5es de pre\xE7o e frete em torno da oferta. */
function lojasDemo(item) {
  const base = item.preco;
  const lojas = [
    { loja: item.loja, preco: base, frete: item.frete ?? 0, freteGratis: item.freteGratis, parcelas: base > 100 ? \`10x de \${(base / 10).toFixed(2).replace('.', ',')} sem juros\` : null },
    { loja: 'Loja Exemplo A', preco: Math.round(base * 0.96 * 100) / 100, frete: 14.9, freteGratis: false, cupom: 'BEMVINDO5' },
    { loja: 'Loja Exemplo B', preco: Math.round(base * 1.04 * 100) / 100, frete: 0, freteGratis: true, detalhes: ['Entrega em 2 dias'] },
    { loja: 'Loja Exemplo C', preco: Math.round(base * 1.12 * 100) / 100, frete: 0, freteGratis: true, parcelas: '6x sem juros' },
  ];
  return {
    produto: { titulo: item.titulo, fotos: item.foto ? [item.foto] : [], avaliacao: item.avaliacao, avaliacoes: item.avaliacoes },
    lojas: lojas
      .map((l) => ({
        icone: null,
        link: '',
        detalhes: [],
        cupom: null,
        parcelas: null,
        precoOriginal: null,
        ...l,
        total: Math.round((l.preco + (l.frete || 0)) * 100) / 100,
      }))
      .sort((a, b) => a.total - b.total),
  };
}

/** Ilustra\xE7\xE3o neutra para quando a foto real n\xE3o carregar. */
const fotoReserva = svg(
  \`<g transform="translate(100 100)" fill="none" stroke="#9aa5a0" stroke-width="6" stroke-linejoin="round"><path d="M-40 -20 h80 v60 h-80z"/><path d="M-40 -20 l40 -22 l40 22"/></g>\`,
  '#eef1ef'
);

return { buscaDemo, lojasDemo, fotoReserva };
})();

M['fontes.js'] = (() => {
// De onde v\xEAm os produtos: o servidor de busca (lojas reais) ou a demonstra\xE7\xE3o.
const { API_URL } = M['config.js'];
const { buscaDemo, lojasDemo } = M['demo.js'];

const modoDemo = () => !API_URL;

async function pedir(caminho) {
  let r;
  try {
    r = await fetch(\`\${API_URL}\${caminho}\`, { headers: { accept: 'application/json' } });
  } catch (_) {
    throw new Error('N\xE3o consegui falar com o servidor de busca. Confira sua internet e tente de novo.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || \`O servidor respondeu com erro (HTTP \${r.status}).\`);
  return j;
}

/**
 * Busca produtos. Devolve { itens, verificadoEm, fontes, demo, aviso }.
 * Cada item segue o formato comum: loja, lojaIcone, titulo, preco, precoOriginal, foto,
 * link, linkDireto, token, frete (null = a calcular), freteGratis, avaliacao, tamanho...
 */
async function buscarProdutos(q, { cep = '' } = {}) {
  if (modoDemo()) {
    await new Promise((r) => setTimeout(r, 300));
    const d = buscaDemo(q);
    const c = String(cep).replace(/\\D/g, '');
    const local = c.length === 8 ? { cep: c, cidade: 'sua regi\xE3o', uf: '', nivel: 'demo' } : null;
    return { ...d, local, verificadoEm: new Date().toISOString(), fontes: ['demo'], demo: true };
  }
  const c = String(cep).replace(/\\D/g, '');
  const j = await pedir(\`/api/buscar?\${new URLSearchParams(c.length === 8 ? { q, cep: c } : { q })}\`);
  return { itens: j.itens || [], filtros: j.filtros || [], verificadoEm: j.verificadoEm, fontes: j.fontes || [], local: j.local || null, demo: false, aviso: '' };
}

/** Todas as lojas que vendem um produto, com link direto. Gasta 1 busca da cota (guardada por horas). */
async function buscarLojas(item) {
  if (modoDemo() || item.fonte === 'demo') {
    await new Promise((r) => setTimeout(r, 250));
    return lojasDemo(item);
  }
  if (!item.token) throw new Error('Esta oferta n\xE3o traz a lista de lojas.');
  return pedir(\`/api/lojas?\${new URLSearchParams({ token: item.token })}\`);
}

return { modoDemo, buscarProdutos, buscarLojas };
})();

M['relevancia.js'] = (() => {
// Quanto uma oferta combina com a busca, e quanto duas ofertas se parecem.
// Fun\xE7\xF5es puras, sem tela, para poderem ser testadas.

const PALAVRAS_VAZIAS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'com', 'para', 'pra', 'por', 'a', 'o', 'as', 'os', 'um', 'uma',
  'no', 'na', 'nos', 'nas', 'ao', 'sem', 'the', 'and', 'with', 'for', '-', 'original', 'novo', 'nova',
]);

/** Min\xFAsculas, sem acento, s\xF3 letras e n\xFAmeros. */
function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Tira plural simples: "sabonetes" \u2192 "sabonete", "refis" fica. */
function singular(p) {
  if (p.length > 4 && p.endsWith('oes')) return \`\${p.slice(0, -3)}ao\`;
  if (p.length > 4 && p.endsWith('aes')) return \`\${p.slice(0, -3)}ao\`;
  if (p.length > 4 && p.endsWith('res')) return p.slice(0, -2);
  if (p.length > 3 && p.endsWith('s') && !p.endsWith('ss')) return p.slice(0, -1);
  return p;
}

/** Palavras que importam numa busca ou t\xEDtulo, sem repetidas. */
function termos(texto) {
  const vistos = new Set();
  for (const p of normalizar(texto).split(' ')) {
    if (!p || PALAVRAS_VAZIAS.has(p)) continue;
    if (p.length < 2 && !/\\d/.test(p)) continue;
    vistos.add(singular(p));
  }
  return [...vistos];
}

/** Uma palavra da busca aparece no t\xEDtulo? Aceita plural, come\xE7o de palavra e palavras grudadas ("nutri milk" = "nutrimilk"). */
function aparece(termo, palavrasTitulo, tituloColado) {
  if (palavrasTitulo.has(termo)) return true;
  if (tituloColado.includes(termo) && termo.length >= 4) return true;
  const numerico = /\\d/.test(termo);
  for (const p of palavrasTitulo) {
    if (termo.length >= 4 && p.startsWith(termo)) return true;
    // Modelo: "520" casa com "520bt", mas "52" n\xE3o casa com "520"
    if (numerico && p.startsWith(termo) && !/\\d/.test(p[termo.length] || '')) return true;
    if (p.length >= 5 && termo.startsWith(p) && termo.length - p.length <= 2) return true;
  }
  return false;
}

/** Fra\xE7\xE3o (0 a 1) das palavras da busca que aparecem no t\xEDtulo. */
function combina(titulo, busca) {
  const t = termos(busca);
  if (!t.length) return 1;
  const palavras = new Set(termos(titulo));
  const colado = normalizar(titulo).replace(/ /g, '');
  const achadas = t.filter((x) => aparece(x, palavras, colado)).length;
  return achadas / t.length;
}

// Palavras que costumam faltar no t\xEDtulo sem mudar o produto: "fone (de ouvido)"
const OPCIONAIS = { ouvido: ['fone'] };

function termosObrigatorios(busca) {
  const t = termos(busca);
  return t.filter((x) => !(OPCIONAIS[x] && OPCIONAIS[x].some((y) => t.includes(y))));
}

/**
 * A oferta \xE9 do assunto da busca?
 * At\xE9 3 palavras na busca: todas precisam aparecer. Com mais: pode faltar 1 a cada 4.
 */
function eRelevante(titulo, busca) {
  const obrigatorios = termosObrigatorios(busca);
  const n = obrigatorios.length;
  if (!n) return true;
  const minimo = n <= 3 ? 1 : (n - Math.floor(n / 4)) / n;
  return combina(titulo, obrigatorios.join(' ')) >= minimo - 1e-9;
}

/** Parecen\xE7a entre dois t\xEDtulos (0 a 1): palavras em comum sobre o total do menor. */
function parecenca(a, b) {
  const ta = new Set(termos(a));
  const tb = new Set(termos(b));
  if (!ta.size || !tb.size) return 0;
  let comum = 0;
  for (const x of ta) if (tb.has(x)) comum++;
  return comum / Math.min(ta.size, tb.size);
}

const LIMIAR_PARECIDO = 0.6;

const RUIDO_PARECIDO = /^(kit|combo|pack|leve|pague|cx|caixa|c\\/|und|unid|unidades?|pcs|pecas|x)$/;
const TAMANHO = /^\\d+([.,]\\d+)?(ml|l|lt|g|gr|kg|un|m|cm|mm|w|v|gb|tb)?$/;

/** Busca curta para "mais parecidos nas lojas": marca e tipo do produto, sem kit, quantidade e tamanho. */
function buscaParecida(titulo, max = 6) {
  return String(titulo || '')
    .replace(/[|\u2022\u2013\u2014,;()[\\]]/g, ' ')
    .split(/\\s+/)
    .filter((p) => {
      const n = normalizar(p).replace(/ /g, '');
      return n && !PALAVRAS_VAZIAS.has(n) && !RUIDO_PARECIDO.test(n) && !TAMANHO.test(n);
    })
    .slice(0, max)
    .join(' ');
}

return { normalizar, termos, combina, eRelevante, parecenca, LIMIAR_PARECIDO, buscaParecida };
})();

M['facetas.js'] = (() => {
// Filtros que mudam conforme a busca: os do Google (marca, cor, tipo...) e os
// que o app monta lendo os t\xEDtulos (tamanho, kit, cor, caracter\xEDsticas).
// Fun\xE7\xF5es puras, sem tela.
const { normalizar, termos, combina } = M['relevancia.js'];

const CORES = [
  ['preto', 'Preto'], ['preta', 'Preto'], ['branco', 'Branco'], ['branca', 'Branco'], ['azul', 'Azul'], ['vermelho', 'Vermelho'],
  ['vermelha', 'Vermelho'], ['verde', 'Verde'], ['rosa', 'Rosa'], ['pink', 'Rosa'], ['cinza', 'Cinza'], ['grafite', 'Grafite'],
  ['prata', 'Prata'], ['dourado', 'Dourado'], ['dourada', 'Dourado'], ['amarelo', 'Amarelo'], ['amarela', 'Amarelo'],
  ['roxo', 'Roxo'], ['roxa', 'Roxo'], ['lilas', 'Lil\xE1s'], ['bege', 'Bege'], ['marrom', 'Marrom'], ['laranja', 'Laranja'],
  ['nude', 'Nude'], ['transparente', 'Transparente'], ['vinho', 'Vinho'], ['creme', 'Creme'], ['off white', 'Off-white'],
  ['black', 'Preto'], ['white', 'Branco'], ['blue', 'Azul'], ['red', 'Vermelho'], ['green', 'Verde'], ['gray', 'Cinza'], ['silver', 'Prata'],
];

// Palavras comuns demais para virar filtro
const GENERICAS = new Set([
  'kit', 'combo', 'unidade', 'unidad', 'un', 'und', 'marca', 'original', 'novo', 'nova', 'produto', 'oferta', 'promocao', 'frete', 'gratis',
  'envio', 'imediato', 'pronta', 'entrega', 'lancamento', 'qualidade', 'premium', 'top', 'super', 'mega', 'mais', 'tamanho', 'cor',
  'linha', 'modelo', 'tipo', 'pacote', 'caixa', 'cx', 'ml', 'kg', 'gr', 'lt', 'litro', 'ate', 'cada', 'leve', 'pague', 'brasil', 'oficial',
]);

// Grupos do Google que o app j\xE1 cobre de outro jeito (pre\xE7o, loja, frete, promo\xE7\xE3o, avalia\xE7\xE3o...)
const GRUPO_IGNORADO = /pre[c\xE7]o|price|loja|store|seller|vendedor|merchant|frete|shipping|entrega|delivery|promo|sale|deal|oferta|avalia|rating|review|condi|used|usado|refine|refinar|nearby|perto|hoje|today|small business/i;

/** Filtros do Google, j\xE1 limpos: [{ nome, opcoes: [texto] }]. */
function limparFiltrosGoogle(filtros) {
  return (Array.isArray(filtros) ? filtros : [])
    .filter((f) => f && f.type && !GRUPO_IGNORADO.test(f.type))
    .map((f) => ({
      nome: String(f.type).trim(),
      opcoes: [...new Set((f.options || []).map((o) => String(o?.text || '').trim()).filter((t) => t && t.length <= 40 && !GRUPO_IGNORADO.test(t)))].slice(0, 30),
    }))
    .filter((f) => f.opcoes.length >= 2)
    .slice(0, 6);
}

function coresDoTitulo(titulo) {
  const t = \` \${normalizar(titulo)} \`;
  const achadas = new Set();
  for (const [palavra, rotulo] of CORES) if (t.includes(\` \${palavra} \`)) achadas.add(rotulo);
  return [...achadas];
}

/**
 * Palavras inteiras do t\xEDtulo: "Over-ear" vira uma chave s\xF3 ("overear"), com a grafia original.
 * Devolve Map(chave \u2192 { grafia, partes }).
 */
function palavrasDoTitulo(titulo) {
  const mapa = new Map();
  for (const p of String(titulo || '').split(/[\\s/|,;()[\\]+]+/)) {
    const limpa = p.replace(/^[^\\p{L}\\p{N}]+|[^\\p{L}\\p{N}]+$/gu, '');
    if (!limpa) continue;
    const partes = termos(limpa);
    if (!partes.length) continue;
    const chave = partes.join('');
    if (!mapa.has(chave)) mapa.set(chave, { grafia: limpa, partes });
  }
  return mapa;
}

/**
 * A op\xE7\xE3o de filtro aparece no t\xEDtulo? Como frase inteira ("Marca Z", "Over-ear"),
 * ou grudada ("Nutri Milk" = "nutrimilk"), ou, se tiver 2+ palavras que importam, todas elas.
 */
function opcaoNoTitulo(titulo, opcao) {
  const t = \` \${normalizar(titulo)} \`;
  const o = normalizar(opcao);
  if (!o) return false;
  if (t.includes(\` \${o} \`)) return true;
  const oc = o.replace(/ /g, '');
  if (oc.length >= 4 && t.replace(/ /g, '').includes(oc)) return true;
  return termos(opcao).length >= 2 && combina(titulo, opcao) === 1;
}

const capitalizar = (s) => (s === s.toLowerCase() ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Monta os grupos de filtro para as ofertas de uma busca.
 * itens: [{ id, titulo, qtd, grupo, embalagens, rotuloTamanho }]
 * Devolve [{ id, nome, opcoes: [{ valor, rotulo, n }] }] e um mapa id da oferta \u2192 { grupo \u2192 Set(valores) }.
 */
function montarFacetas(itens, { busca = '', filtrosGoogle = [] } = {}) {
  const valores = new Map(itens.map((i) => [i.id, {}]));
  const grupos = [];
  const marcar = (grupoId, item, valor) => {
    const v = valores.get(item.id);
    (v[grupoId] ||= new Set()).add(valor);
  };
  const contar = (grupoId) => {
    const n = new Map();
    for (const i of itens) for (const v of valores.get(i.id)[grupoId] || []) n.set(v, (n.get(v) || 0) + 1);
    return n;
  };

  // 1. Filtros do Google (marca, cor, tipo...): a op\xE7\xE3o vale se aparece no t\xEDtulo
  filtrosGoogle.forEach((f, k) => {
    const id = \`g\${k}\`;
    for (const i of itens) for (const op of f.opcoes) if (opcaoNoTitulo(i.titulo, op)) marcar(id, i, op);
    const n = contar(id);
    const opcoes = f.opcoes.filter((op) => n.get(op)).map((op) => ({ valor: op, rotulo: op, n: n.get(op) }));
    if (opcoes.length >= 2 || (opcoes.length === 1 && opcoes[0].n < itens.length)) grupos.push({ id, nome: f.nome, opcoes });
  });
  const palavrasDoGoogle = new Set(filtrosGoogle.flatMap((f) => f.opcoes.flatMap((o) => termos(o))));

  // 2. Tamanho (quantidade total do an\xFAncio)
  for (const i of itens) if (i.rotuloTamanho) marcar('tamanho', i, i.rotuloTamanho);
  {
    const n = contar('tamanho');
    const base = new Map(itens.filter((i) => i.rotuloTamanho).map((i) => [i.rotuloTamanho, \`\${i.grupo}:\${i.qtd}\`]));
    const opcoes = [...n.entries()]
      .sort((a, b) => {
        const [ga, qa] = base.get(a[0]).split(':');
        const [gb, qb] = base.get(b[0]).split(':');
        return ga.localeCompare(gb) || Number(qa) - Number(qb);
      })
      .map(([v, c]) => ({ valor: v, rotulo: v, n: c }));
    if (opcoes.length >= 2) grupos.push({ id: 'tamanho', nome: 'Tamanho', opcoes });
  }

  // 3. Kit ou avulso
  for (const i of itens) {
    if (!i.embalagens) continue;
    marcar('pacote', i, i.embalagens > 1 ? (i.embalagens >= 6 ? 'Kit com 6 ou mais' : \`Kit com \${i.embalagens}\`) : 'Avulso');
  }
  {
    const n = contar('pacote');
    const ordem = (v) => (v === 'Avulso' ? 0 : Number(v.match(/\\d+/)?.[0] || 99));
    const opcoes = [...n.entries()].sort((a, b) => ordem(a[0]) - ordem(b[0])).map(([v, c]) => ({ valor: v, rotulo: v, n: c }));
    if (opcoes.length >= 2) grupos.push({ id: 'pacote', nome: 'Kit ou avulso', opcoes });
  }

  // 4. Cor (se o Google j\xE1 n\xE3o trouxe cor)
  if (!grupos.some((g) => /cor|color/i.test(g.nome))) {
    for (const i of itens) for (const c of coresDoTitulo(i.titulo)) marcar('cor', i, c);
    const n = contar('cor');
    const opcoes = [...n.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => ({ valor: v, rotulo: v, n: c }));
    if (opcoes.length >= 2) grupos.push({ id: 'cor', nome: 'Cor', opcoes });
  }

  // 5. Caracter\xEDsticas: palavras que aparecem em v\xE1rias ofertas, mas n\xE3o em todas
  if (itens.length >= 4) {
    const daBusca = new Set(termos(busca));
    const cores = new Set(CORES.map(([p]) => p));
    const grafia = new Map();
    const conta = new Map();
    const chavesPorItem = new Map();
    const ignorar = (t, partes) =>
      t.length < 3 || /\\d/.test(t) || cores.has(t) || palavrasDoGoogle.has(t) ||
      partes.every((x) => daBusca.has(x) || GENERICAS.has(x) || palavrasDoGoogle.has(x));
    for (const i of itens) {
      const mapa = palavrasDoTitulo(i.titulo);
      chavesPorItem.set(i.id, new Set(mapa.keys()));
      for (const [t, { grafia: original, partes }] of mapa) {
        if (ignorar(t, partes)) continue;
        conta.set(t, (conta.get(t) || 0) + 1);
        if (!grafia.has(t)) grafia.set(t, capitalizar(original));
      }
    }
    const escolhidas = [...conta.entries()]
      .filter(([, c]) => c >= 2 && c < itens.length)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 14)
      .map(([t]) => t);
    if (escolhidas.length >= 1) {
      for (const i of itens) {
        const ts = chavesPorItem.get(i.id);
        for (const t of escolhidas) if (ts.has(t)) marcar('carac', i, t);
      }
      const n = contar('carac');
      grupos.push({ id: 'carac', nome: 'Caracter\xEDsticas', opcoes: escolhidas.map((t) => ({ valor: t, rotulo: grafia.get(t), n: n.get(t) || 0 })) });
    }
  }

  return { grupos, valores };
}

/**
 * A oferta passa nos filtros escolhidos? Dentro de um grupo vale qualquer op\xE7\xE3o marcada;
 * entre grupos, precisa passar em todos.
 */
function passaNasFacetas(valoresDaOferta, escolhidas) {
  for (const [grupo, set] of Object.entries(escolhidas)) {
    if (!set || !set.size) continue;
    const tem = valoresDaOferta?.[grupo];
    if (!tem || ![...set].some((v) => tem.has(v))) return false;
  }
  return true;
}

return { limparFiltrosGoogle, opcaoNoTitulo, montarFacetas, passaNasFacetas };
})();

M['salvos.js'] = (() => {
// Favoritos e listas, guardados no aparelho. Fun\xE7\xF5es puras sobre o objeto de prefer\xEAncias:
// prefs.salvos = { [id]: { item, listas: [ids], salvoEm, precoSalvo, totalSalvo, ultimoPreco, vistoEm, qtd } }
// prefs.listas = [{ id, nome }]  (a primeira \xE9 sempre "Favoritos")

const FAVORITOS = 'favoritos';
const LIMITE_FOTO = 30000; // fotos embutidas muito grandes n\xE3o v\xE3o para o armazenamento

function garantirSalvos(prefs) {
  if (!prefs.salvos || typeof prefs.salvos !== 'object') prefs.salvos = {};
  if (!prefs.apagados || typeof prefs.apagados !== 'object') prefs.apagados = {};
  if (!Array.isArray(prefs.listas) || !prefs.listas.length) prefs.listas = [{ id: FAVORITOS, nome: 'Favoritos' }];
  if (!prefs.listas.some((l) => l.id === FAVORITOS)) prefs.listas.unshift({ id: FAVORITOS, nome: 'Favoritos' });
  return prefs;
}

/** O que guardamos de uma oferta: o suficiente para mostrar e voltar \xE0 loja. */
function retrato(i) {
  return {
    id: i.id,
    fonte: i.fonte,
    titulo: i.titulo,
    loja: i.loja,
    lojaIcone: i.lojaIcone || null,
    foto: i.foto && String(i.foto).length <= LIMITE_FOTO ? i.foto : null,
    link: i.link || '',
    linkDireto: Boolean(i.linkDireto),
    preco: i.preco,
    frete: i.frete ?? null,
    freteGratis: Boolean(i.freteGratis),
    embalagens: i.embalagens ?? null,
    conteudo: i.conteudo ?? null,
    unidade: i.unidade ?? null,
  };
}

const totalDe = (i) => i.preco + (i.freteGratis ? 0 : i.frete || 0);

const estaSalvo = (prefs, id) => Boolean(prefs.salvos?.[id]);

/** Salva (ou acrescenta numa lista). N\xE3o mexe no pre\xE7o de quando foi salvo. */
function salvarItem(prefs, item, listaId = FAVORITOS, agora = new Date().toISOString()) {
  garantirSalvos(prefs);
  delete prefs.apagados?.[item.id];
  const atual = prefs.salvos[item.id];
  if (atual) {
    if (!atual.listas.includes(listaId)) atual.listas.push(listaId);
    return atual;
  }
  prefs.salvos[item.id] = {
    item: retrato(item),
    listas: [listaId],
    salvoEm: agora,
    precoSalvo: item.preco,
    totalSalvo: totalDe(item),
    ultimoPreco: item.preco,
    vistoEm: agora,
    qtd: 1,
  };
  return prefs.salvos[item.id];
}

/** Tira de uma lista; sem nenhuma lista, deixa de estar salvo. Devolve o registro removido (para desfazer). */
function tirarDaLista(prefs, id, listaId) {
  const s = prefs.salvos?.[id];
  if (!s) return null;
  s.listas = s.listas.filter((l) => l !== listaId);
  if (!s.listas.length) {
    delete prefs.salvos[id];
    marcarApagado(prefs, id);
    return s;
  }
  return null;
}

/** Lembra que foi apagado, para outro aparelho n\xE3o trazer de volta ao juntar. */
function marcarApagado(prefs, id, quando = new Date().toISOString()) {
  (prefs.apagados ||= {})[id] = quando;
}

function removerSalvo(prefs, id) {
  const s = prefs.salvos?.[id];
  if (s) {
    delete prefs.salvos[id];
    marcarApagado(prefs, id);
  }
  return s || null;
}

/** Desfaz uma remo\xE7\xE3o. */
function restaurarSalvo(prefs, id, registro) {
  if (!registro) return;
  prefs.salvos[id] = registro;
  delete prefs.apagados?.[id];
}

function alternarLista(prefs, item, listaId) {
  const s = prefs.salvos?.[item.id];
  if (s && s.listas.includes(listaId)) tirarDaLista(prefs, item.id, listaId);
  else salvarItem(prefs, item, listaId);
}

function criarLista(prefs, nome) {
  garantirSalvos(prefs);
  const limpo = String(nome || '').trim().slice(0, 40);
  if (!limpo) return null;
  const existente = prefs.listas.find((l) => l.nome.toLowerCase() === limpo.toLowerCase());
  if (existente) return existente.id;
  const id = \`l\${Date.now().toString(36)}\${Math.random().toString(36).slice(2, 5)}\`;
  prefs.listas.push({ id, nome: limpo });
  return id;
}

function renomearLista(prefs, id, nome) {
  const l = prefs.listas?.find((x) => x.id === id);
  const limpo = String(nome || '').trim().slice(0, 40);
  if (l && limpo) l.nome = limpo;
}

/** Apaga a lista (menos Favoritos); itens que s\xF3 estavam nela deixam de estar salvos. */
function apagarLista(prefs, id) {
  if (id === FAVORITOS) return;
  prefs.listas = (prefs.listas || []).filter((l) => l.id !== id);
  for (const k of Object.keys(prefs.salvos || {})) tirarDaLista(prefs, k, id);
}

function itensDaLista(prefs, listaId) {
  return Object.values(prefs.salvos || {})
    .filter((s) => s.listas.includes(listaId))
    .sort((a, b) => String(b.salvoEm).localeCompare(String(a.salvoEm)));
}

function contarLista(prefs, listaId) {
  return Object.values(prefs.salvos || {}).filter((s) => s.listas.includes(listaId)).length;
}

/** Total da lista com as quantidades, usando o pre\xE7o mais recente visto. */
function totalDaLista(prefs, listaId) {
  return itensDaLista(prefs, listaId).reduce((t, s) => t + (s.ultimoPreco ?? s.precoSalvo) * (s.qtd || 1), 0);
}

function mudarQuantidade(prefs, id, delta) {
  const s = prefs.salvos?.[id];
  if (s) s.qtd = Math.max(1, Math.min(99, (s.qtd || 1) + delta));
}

/** Quando uma oferta salva aparece numa busca, guarda o pre\xE7o novo (o salvo continua o mesmo). */
function registrarPrecosVistos(prefs, itens, agora = new Date().toISOString()) {
  let mudou = false;
  for (const i of itens) {
    const s = prefs.salvos?.[i.id];
    if (!s || !(i.preco > 0)) continue;
    s.ultimoPreco = i.preco;
    s.vistoEm = agora;
    if (!s.item.foto && i.foto && String(i.foto).length <= LIMITE_FOTO) s.item.foto = i.foto;
    mudou = true;
  }
  return mudou;
}

/** Diferen\xE7a entre o \xFAltimo pre\xE7o visto e o de quando salvou (negativo = caiu). */
function variacao(s) {
  if (!s || s.ultimoPreco == null || s.precoSalvo == null) return 0;
  return Math.round((s.ultimoPreco - s.precoSalvo) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Juntar o que est\xE1 no aparelho com o que est\xE1 na conta
// ---------------------------------------------------------------------------

const DIAS_LEMBRAR_APAGADO = 90;
const maisNovo = (a, b) => (String(a || '') > String(b || '') ? a : b);
const maisVelho = (a, b) => (!a ? b : !b ? a : String(a) < String(b) ? a : b);

/**
 * Junta dois conte\xFAdos (aparelho e conta) sem perder nada:
 * - salvos dos dois lados; o mesmo item fica com a data e o pre\xE7o de quando foi salvo primeiro,
 *   as listas dos dois, a maior quantidade e o pre\xE7o visto mais recente;
 * - o que foi apagado (de qualquer lado) depois de salvo n\xE3o volta;
 * - listas dos dois lados (mesmo nome vira uma lista s\xF3);
 * - prefer\xEAncias: as do aparelho (mais recentes) por cima.
 */
function juntarConteudo(local = {}, remoto = {}, agora = new Date()) {
  const r = structuredClone(remoto || {});
  const l = structuredClone(local || {});

  // Listas: por id, e mesmo nome = mesma lista
  const listas = [...(r.listas || [])];
  const remap = {};
  for (const lista of l.listas || []) {
    const mesmoId = listas.find((x) => x.id === lista.id);
    const mesmoNome = listas.find((x) => x.nome.toLowerCase() === lista.nome.toLowerCase());
    if (mesmoId) continue;
    if (mesmoNome) remap[lista.id] = mesmoNome.id;
    else listas.push(lista);
  }

  // O que foi apagado: o mais recente de cada lado
  const apagados = { ...(r.apagados || {}) };
  for (const [id, quando] of Object.entries(l.apagados || {})) apagados[id] = maisNovo(apagados[id], quando);
  const limite = new Date(agora.getTime() - DIAS_LEMBRAR_APAGADO * 86400_000).toISOString();
  for (const [id, quando] of Object.entries(apagados)) if (quando < limite) delete apagados[id];

  const salvos = {};
  const ids = new Set([...Object.keys(r.salvos || {}), ...Object.keys(l.salvos || {})]);
  for (const id of ids) {
    const a = r.salvos?.[id];
    const b = l.salvos?.[id] ? { ...l.salvos[id], listas: l.salvos[id].listas.map((x) => remap[x] || x) } : null;
    const juntos = !a ? b : !b ? a : {
      ...a,
      item: { ...a.item, ...b.item, foto: b.item.foto || a.item.foto },
      listas: [...new Set([...a.listas, ...b.listas])],
      salvoEm: maisVelho(a.salvoEm, b.salvoEm),
      precoSalvo: String(a.salvoEm) <= String(b.salvoEm) ? a.precoSalvo : b.precoSalvo,
      totalSalvo: String(a.salvoEm) <= String(b.salvoEm) ? a.totalSalvo : b.totalSalvo,
      ultimoPreco: String(a.vistoEm) >= String(b.vistoEm) ? a.ultimoPreco : b.ultimoPreco,
      vistoEm: maisNovo(a.vistoEm, b.vistoEm),
      qtd: Math.max(a.qtd || 1, b.qtd || 1),
    };
    // Apagado depois de ter sido salvo (pela \xFAltima vez): fica apagado
    const ultimoSalvo = maisNovo(a?.salvoEm, b?.salvoEm);
    if (apagados[id] && apagados[id] >= ultimoSalvo) continue;
    delete apagados[id];
    salvos[id] = juntos;
  }

  return { ...r, ...l, listas, salvos, apagados };
}

return { FAVORITOS, garantirSalvos, estaSalvo, salvarItem, tirarDaLista, removerSalvo, restaurarSalvo, alternarLista, criarLista, renomearLista, apagarLista, itensDaLista, contarLista, totalDaLista, mudarQuantidade, registrarPrecosVistos, variacao, juntarConteudo };
})();

M['conta.js'] = (() => {
// Conta no app: entrar com Google, manter a sess\xE3o e sincronizar os salvos com o servidor.
// A sess\xE3o fica s\xF3 neste aparelho e nunca entra no conte\xFAdo sincronizado.
const { API_URL } = M['config.js'];
const { juntarConteudo } = M['salvos.js'];

const CHAVE_SESSAO = 'minhas-compras:sessao';
const CHAVE_VERSAO = 'minhas-compras:versao';
const CHAVE_USUARIO = 'minhas-compras:usuario';

const ler = (k) => {
  try {
    return localStorage.getItem(k);
  } catch (_) {
    return null;
  }
};
const gravar = (k, v) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch (_) {
    /* sem armazenamento */
  }
};

/**
 * lerConteudo(): o que sincronizar (salvos, listas, prefer\xEAncias);
 * aplicarConteudo(c): grava no app o conte\xFAdo juntado;
 * aoMudar(estado): redesenha a tela da conta.
 */
function criarConta({ lerConteudo, aplicarConteudo, aoMudar, avisar }) {
  const estado = {
    disponivel: Boolean(API_URL),
    sessao: ler(CHAVE_SESSAO),
    usuario: (() => {
      try {
        return JSON.parse(ler(CHAVE_USUARIO) || 'null');
      } catch (_) {
        return null;
      }
    })(),
    versao: Number(ler(CHAVE_VERSAO) || 0),
    situacao: 'parado', // parado | sincronizando | sincronizado | offline | erro
    ultimaSinc: null,
    pendente: false,
  };
  let timer = null;
  let emAndamento = null;

  const mudou = () => aoMudar?.(estado);

  async function pedir(caminho, opcoes = {}) {
    const r = await fetch(\`\${API_URL}\${caminho}\`, {
      ...opcoes,
      headers: {
        accept: 'application/json',
        ...(opcoes.body ? { 'content-type': 'application/json' } : {}),
        ...(estado.sessao ? { authorization: \`Bearer \${estado.sessao}\` } : {}),
        ...(opcoes.headers || {}),
      },
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, j };
  }

  function guardarSessao(sessao, usuario) {
    estado.sessao = sessao;
    estado.usuario = usuario;
    gravar(CHAVE_SESSAO, sessao);
    gravar(CHAVE_USUARIO, usuario ? JSON.stringify(usuario) : null);
  }

  function esquecerSessao() {
    guardarSessao(null, null);
    estado.versao = 0;
    gravar(CHAVE_VERSAO, null);
    estado.situacao = 'parado';
    mudou();
  }

  function definirVersao(v) {
    estado.versao = v;
    gravar(CHAVE_VERSAO, String(v));
  }

  /** Manda o conte\xFAdo do aparelho; se outro aparelho salvou antes, junta e tenta de novo. */
  async function enviar(tentativa = 0) {
    if (!estado.sessao) return;
    estado.situacao = 'sincronizando';
    mudou();
    let resp;
    try {
      resp = await pedir('/api/conta/dados', { method: 'PUT', body: JSON.stringify({ versaoBase: estado.versao, conteudo: lerConteudo() }) });
    } catch (_) {
      estado.situacao = 'offline';
      estado.pendente = true;
      return mudou();
    }
    if (resp.status === 401) {
      esquecerSessao();
      return avisar?.('Sua sess\xE3o terminou. Entre de novo para continuar sincronizando.');
    }
    if (resp.status === 409 && tentativa < 3) {
      aplicarConteudo(juntarConteudo(lerConteudo(), resp.j.conteudo || {}));
      definirVersao(resp.j.versao || 0);
      return enviar(tentativa + 1);
    }
    if (!resp.ok) {
      estado.situacao = 'erro';
      estado.pendente = true;
      return mudou();
    }
    definirVersao(resp.j.versao);
    estado.pendente = false;
    estado.situacao = 'sincronizado';
    estado.ultimaSinc = new Date();
    mudou();
  }

  /** Busca o que est\xE1 na conta e junta com o aparelho. */
  async function sincronizar() {
    if (!estado.sessao) return;
    if (emAndamento) return emAndamento;
    emAndamento = (async () => {
      estado.situacao = 'sincronizando';
      mudou();
      let resp;
      try {
        resp = await pedir('/api/conta');
      } catch (_) {
        estado.situacao = 'offline';
        return mudou();
      }
      if (resp.status === 401) return esquecerSessao();
      if (!resp.ok) {
        estado.situacao = 'erro';
        return mudou();
      }
      estado.usuario = resp.j.usuario;
      gravar(CHAVE_USUARIO, JSON.stringify(resp.j.usuario));
      const remoto = resp.j.dados;
      if (!remoto) return enviar(); // conta nova: leva o que est\xE1 no aparelho
      if (remoto.versao === estado.versao && !estado.pendente) {
        estado.situacao = 'sincronizado';
        estado.ultimaSinc = new Date();
        return mudou();
      }
      aplicarConteudo(juntarConteudo(lerConteudo(), remoto.conteudo));
      definirVersao(remoto.versao);
      return enviar();
    })().finally(() => (emAndamento = null));
    return emAndamento;
  }

  return {
    estado,

    /** Ao abrir o app: termina um login que voltou do Google, ou sincroniza a sess\xE3o guardada. */
    async iniciar() {
      if (!estado.disponivel) return mudou();
      const hash = location.hash || '';
      const codigo = hash.match(/[#&]login=([\\w-]+)/)?.[1];
      const erro = hash.match(/[#&]login_erro=(\\w+)/)?.[1];
      if (codigo || erro) history.replaceState(null, '', location.pathname + location.search);
      if (erro) avisar?.(erro === 'cancelado' ? 'Login cancelado.' : 'N\xE3o deu para entrar com o Google. Tente de novo.');
      if (codigo) {
        try {
          const r = await pedir('/api/auth/trocar', { method: 'POST', body: JSON.stringify({ codigo }) });
          if (!r.ok) throw new Error(r.j.erro || 'N\xE3o deu para entrar.');
          guardarSessao(r.j.sessao, r.j.usuario);
          estado.versao = 0; // primeira vez neste aparelho: junta tudo
          avisar?.(\`Ol\xE1, \${(r.j.usuario?.nome || '').split(' ')[0] || 'tudo certo'}! Seus salvos agora v\xE3o para a sua conta.\`);
        } catch (e) {
          avisar?.(e.message);
        }
      }
      mudou();
      await sincronizar();
      // Volta a sincronizar quando a pessoa volta para o app ou a internet volta
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sincronizar());
      addEventListener('online', () => (estado.pendente ? enviar() : sincronizar()));
    },

    entrar() {
      if (!estado.disponivel) return avisar?.('A conta funciona na vers\xE3o publicada do app, n\xE3o na demonstra\xE7\xE3o.');
      const volta = \`\${location.origin}\${location.pathname}\`;
      location.href = \`\${API_URL}/api/auth/google?\${new URLSearchParams({ volta })}\`;
    },

    /** Avisa que algo mudou nos salvos: envia daqui a pouco, juntando v\xE1rias mudan\xE7as. */
    mudou() {
      if (!estado.sessao) return;
      estado.pendente = true;
      clearTimeout(timer);
      timer = setTimeout(() => enviar(), 1200);
    },

    sincronizar,

    async sair() {
      try {
        if (estado.pendente) await enviar();
        await pedir('/api/auth/sair', { method: 'POST' });
      } catch (_) {
        /* sai mesmo sem internet */
      }
      esquecerSessao();
      avisar?.('Voc\xEA saiu da conta. Seus salvos continuam neste aparelho.');
    },

    async apagarConta() {
      const r = await pedir('/api/conta', { method: 'DELETE' }).catch(() => null);
      if (!r || !r.ok) return avisar?.('N\xE3o deu para apagar agora. Confira a internet e tente de novo.');
      esquecerSessao();
      avisar?.('Sua conta e os dados dela foram apagados. O que est\xE1 neste aparelho continua aqui.');
    },
  };
}

return { criarConta };
})();

M['app.js'] = (() => {
const { UNIDADES, lerNumero, lerTitulo, grupoDaOferta, quantidadeDoAnuncio, precoExibido } = M['core.js'];
const { buscarProdutos, buscarLojas, modoDemo } = M['fontes.js'];
const { fotoReserva } = M['demo.js'];
const { eRelevante, parecenca, buscaParecida, LIMIAR_PARECIDO } = M['relevancia.js'];
const { montarFacetas, passaNasFacetas } = M['facetas.js'];
const {
  FAVORITOS, garantirSalvos, salvarItem, estaSalvo, removerSalvo, tirarDaLista, alternarLista, criarLista, renomearLista,
  apagarLista, itensDaLista, contarLista, totalDaLista, mudarQuantidade, registrarPrecosVistos, variacao, restaurarSalvo,
} = M['salvos.js'];
const { criarConta } = M['conta.js'];

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

const CHAVE = 'minhas-compras:v3';
const prefs = (() => {
  const padrao = { ordem: 'relevancia', cep: '', tamanhos: {}, fretes: {}, manuais: {}, ultimaBusca: '' };
  try {
    const p = JSON.parse(localStorage.getItem(CHAVE) || 'null');
    if (p && typeof p === 'object') return { ...padrao, ...p, fretes: p.fretes || {}, manuais: p.manuais || {} };
  } catch (_) {
    /* sem armazenamento */
  }
  return padrao;
})();
garantirSalvos(prefs);
let listaAberta = FAVORITOS; // aba aberta em "Meus salvos"
let editandoLista = null; // id da lista sendo renomeada
let apagandoLista = null; // id da lista esperando confirma\xE7\xE3o para apagar
let itemDasListas = null; // oferta aberta em "Salvar em lista"

function gravarLocal() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(prefs));
  } catch (_) {
    /* o app funciona sem lembrar */
  }
}

// O que vai para a conta (a \xFAltima busca, por exemplo, fica s\xF3 no aparelho)
const CAMPOS_SINC = ['salvos', 'listas', 'apagados', 'cep', 'ordem', 'tamanhos', 'fretes', 'manuais'];
const conteudoSinc = () => Object.fromEntries(CAMPOS_SINC.map((k) => [k, prefs[k]]));
let conta = null;
let ultimoSinc = '';

function salvar() {
  gravarLocal();
  const atual = JSON.stringify(conteudoSinc());
  if (atual !== ultimoSinc) {
    ultimoSinc = atual;
    conta?.mudou();
  }
}

const busca = { q: '', itens: [], filtros: [], verificadoEm: null, fontes: [], local: null, demo: false, aviso: '', carregando: false, erro: '' };
const FILTROS_VAZIOS = () => ({
  lojas: new Set(), precoMin: '', precoMax: '', freteGratis: false, promocao: false, avaliacao4: false, comTamanho: false,
  relevantes: true, // s\xF3 o que combina com a busca
  facetas: {}, // grupo \u2192 Set(valores): marca, tamanho, cor...
  parecidosCom: null, // { id, titulo }
});
const chaveBusca = (q) => String(q).trim().toLowerCase().replace(/\\s+/g, ' ');
let filtros = FILTROS_VAZIOS();
const comparar = new Set();
const MAX_COMPARAR = 4;
let detalhe = null; // { item, carregando, erro, dados, editandoTamanho }
let editandoFreteId = null; // cart\xE3o com o campo de frete aberto
const gruposAbertos = new Set(); // grupos de filtro com todas as op\xE7\xF5es \xE0 mostra

// ---------------------------------------------------------------------------
// Formata\xE7\xE3o
// ---------------------------------------------------------------------------

const $ = (s, r = document) => r.querySelector(s);
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v, casas = 2) => v.toLocaleString('pt-BR', { maximumFractionDigits: casas });
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linkSeguro = (u) => {
  try {
    const url = new URL(String(u).trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch (_) {
    return '';
  }
};
const POR = { volume: 'litro', massa: 'kg', unidade: 'unidade', comprimento: 'metro' };
const SIGLA = { volume: 'L', massa: 'kg', unidade: 'un', comprimento: 'm' };

/** Pre\xE7o com centavos menores: R$ 21<sup>,90</sup> */
function precoGrande(v, classe = '') {
  const c = Math.round(v * 100);
  const inteiro = Math.floor(c / 100).toLocaleString('pt-BR');
  const cent = String(c % 100).padStart(2, '0');
  return \`<span class="valor \${classe}" aria-label="\${esc(brl(v))}"><span class="rs">R$</span><span class="int">\${inteiro}</span><span class="cent">,\${cent}</span></span>\`;
}

function fmtQtd(base, grupo) {
  if (grupo === 'volume') return base >= 1000 ? \`\${num(base / 1000)} L\` : \`\${num(base)} ml\`;
  if (grupo === 'massa') return base >= 1000 ? \`\${num(base / 1000)} kg\` : \`\${num(base)} g\`;
  if (grupo === 'comprimento') return \`\${num(base)} m\`;
  return \`\${num(base)} un\`;
}

function estrelas(nota, qtd) {
  if (!(nota > 0)) return '';
  return \`<span class="nota" title="\${esc(\`\${num(nota, 1)} de 5\${qtd ? \`, \${qtd.toLocaleString('pt-BR')} avalia\xE7\xF5es\` : ''}\`)}">
    <svg width="13" height="13" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9z" fill="currentColor"/></svg>
    \${num(nota, 1)}\${qtd ? \`<span class="qtd-av">(\${qtd.toLocaleString('pt-BR')})</span>\` : ''}</span>\`;
}

// \xCDcones das lojas: o da fonte; sen\xE3o o favicon do site conhecido; sen\xE3o a inicial colorida
const DOMINIOS = {
  amazon: 'amazon.com.br', 'mercado livre': 'mercadolivre.com.br', mercadolivre: 'mercadolivre.com.br', magalu: 'magazineluiza.com.br',
  'magazine luiza': 'magazineluiza.com.br', 'casas bahia': 'casasbahia.com.br', shopee: 'shopee.com.br', kabum: 'kabum.com.br',
  carrefour: 'carrefour.com.br', drogasil: 'drogasil.com.br', 'droga raia': 'drogaraia.com.br', 'fast shop': 'fastshop.com.br',
  americanas: 'americanas.com.br', 'ponto': 'pontofrio.com.br', extra: 'extra.com.br', 'pague menos': 'paguemenos.com.br',
  'drogaria s\xE3o paulo': 'drogariasaopaulo.com.br', netshoes: 'netshoes.com.br', centauro: 'centauro.com.br', 'leroy merlin': 'leroymerlin.com.br',
  madeiramadeira: 'madeiramadeira.com.br', 'assa\xED': 'assai.com.br', 'atacad\xE3o': 'atacadao.com.br', 'p\xE3o de a\xE7\xFAcar': 'paodeacucar.com',
  aliexpress: 'aliexpress.com', shein: 'shein.com', samsung: 'samsung.com', apple: 'apple.com', dell: 'dell.com', 'girafa': 'girafa.com.br',
};
function iconeDaLoja(nome, icone) {
  if (icone) return icone;
  if (modoDemo()) return null;
  const n = String(nome || '').toLowerCase();
  const chave = Object.keys(DOMINIOS).find((k) => n.includes(k));
  return chave ? \`https://www.google.com/s2/favicons?domain=\${DOMINIOS[chave]}&sz=64\` : null;
}
function avatarLoja(nome, icone, tamanho = '') {
  let h = 0;
  for (const ch of String(nome)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const letra = (String(nome).trim()[0] || '?').toUpperCase();
  const src = iconeDaLoja(nome, icone);
  return \`<span class="avatar \${tamanho}" style="--h:\${h}" aria-hidden="true">\${esc(letra)}\${
    src ? \`<img class="logo" src="\${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">\` : ''
  }</span>\`;
}

// ---------------------------------------------------------------------------
// C\xE1lculo
// ---------------------------------------------------------------------------

function enriquecer(i, ordem) {
  const t = prefs.tamanhos[i.id];
  let it = t ? { ...i, ...t, fonteConteudo: 'voce' } : i;
  const fv = prefs.fretes[i.id];
  if (typeof fv === 'number') it = { ...it, frete: fv, freteGratis: fv === 0, freteDeVoce: true };
  const temTamanho = lerNumero(it.conteudo) > 0 && Boolean(UNIDADES[it.unidade]);
  const frete = it.freteGratis ? 0 : it.frete ?? null;
  const total = it.preco + (frete || 0);
  const grupo = temTamanho ? grupoDaOferta(it) : null;
  const qtd = temTamanho ? quantidadeDoAnuncio(it) : null;
  return {
    ...it,
    ordem,
    frete,
    freteConhecido: frete !== null,
    total,
    grupo,
    qtd,
    unit: temTamanho ? precoExibido(total / qtd, grupo) : null,
    desconto: it.precoOriginal > it.preco ? 1 - it.preco / it.precoOriginal : 0,
  };
}

function calcular() {
  const manuais = prefs.manuais[chaveBusca(busca.q)] || [];
  const todos = [...busca.itens, ...manuais].filter((i) => i.preco > 0).map(enriquecer);
  for (const i of todos) i.relevante = i.fonte === 'manual' || eRelevante(i.titulo, busca.q);
  const alvo = filtros.parecidosCom;
  const base = todos.filter(
    (i) =>
      (!filtros.relevantes || i.relevante || (alvo && i.id === alvo.id)) &&
      (!alvo || i.id === alvo.id || parecenca(i.titulo, alvo.titulo) >= LIMIAR_PARECIDO)
  );
  const foraDoAssunto = filtros.relevantes ? todos.filter((i) => !i.relevante).length : 0;
  const contagem = {};
  for (const i of base) if (i.grupo) contagem[i.grupo] = (contagem[i.grupo] || 0) + 1;
  const [grupo, nGrupo] = Object.entries(contagem).sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const usaUnidade = nGrupo >= 2;

  // Filtros que dependem da busca (marca, tamanho, cor...), montados sobre o que combina com ela
  const facetas = montarFacetas(
    base.map((i) => ({ ...i, rotuloTamanho: i.qtd ? fmtQtd(i.qtd, i.grupo) : null })),
    { busca: busca.q, filtrosGoogle: busca.filtros || [] }
  );

  const min = lerNumero(filtros.precoMin, 0);
  const max = lerNumero(filtros.precoMax, 0);
  const passaBasicos = (i) =>
      (!filtros.lojas.size || filtros.lojas.has(i.loja)) &&
      (!min || i.preco >= min) &&
      (!max || i.preco <= max) &&
      (!filtros.freteGratis || i.frete === 0) &&
      (!filtros.promocao || i.desconto > 0) &&
      (!filtros.avaliacao4 || i.avaliacao >= 4) &&
      (!filtros.comTamanho || (usaUnidade && i.grupo === grupo));
  const lista = base.filter((i) => passaBasicos(i) && passaNasFacetas(facetas.valores.get(i.id), filtros.facetas));

  // Quantas ofertas cada op\xE7\xE3o traria, mantendo os filtros dos outros grupos
  for (const g of facetas.grupos) {
    const semEste = { ...filtros.facetas, [g.id]: null };
    const n = new Map();
    for (const i of base) {
      if (!passaBasicos(i) || !passaNasFacetas(facetas.valores.get(i.id), semEste)) continue;
      for (const v of facetas.valores.get(i.id)[g.id] || []) n.set(v, (n.get(v) || 0) + 1);
    }
    for (const o of g.opcoes) o.n = n.get(o.valor) || 0;
  }

  const ordem = prefs.ordem === 'unidade' && !usaUnidade ? 'relevancia' : prefs.ordem;
  const porUnidade = (i) => (i.grupo === grupo && i.unit != null ? i.unit : Infinity);
  const cmp = {
    relevancia: (a, b) => a.ordem - b.ordem,
    preco: (a, b) => a.preco - b.preco,
    total: (a, b) => (a.freteConhecido === b.freteConhecido ? a.total - b.total : a.freteConhecido ? -1 : 1),
    unidade: (a, b) => porUnidade(a) - porUnidade(b) || a.total - b.total,
    avaliacao: (a, b) => (b.avaliacao || 0) - (a.avaliacao || 0) || (b.avaliacoes || 0) - (a.avaliacoes || 0),
    desconto: (a, b) => b.desconto - a.desconto,
  }[ordem];
  lista.sort(cmp);

  // Destaques, sempre sobre o que passou pelos filtros
  const menor = (arr, f) => arr.reduce((m, i) => (m === null || f(i) < f(m) ? i : m), null);
  const destaques = {};
  if (lista.length) {
    destaques.preco = menor(lista, (i) => i.preco);
    const comFrete = lista.filter((i) => i.freteConhecido);
    const t = menor(comFrete, (i) => i.total);
    if (t && t.id !== destaques.preco.id) destaques.total = t;
    if (usaUnidade) {
      const u = menor(lista.filter((i) => i.grupo === grupo), (i) => i.unit);
      if (u) destaques.unidade = u;
    }
    const avaliados = lista.filter((i) => i.avaliacao >= 4 && (i.avaliacoes || 0) >= 20);
    const a = avaliados.reduce((m, i) => (!m || i.avaliacao > m.avaliacao || (i.avaliacao === m.avaliacao && i.avaliacoes > m.avaliacoes) ? i : m), null);
    if (a) destaques.avaliacao = a;
  }

  // Lojas para o filtro (do que combina com a busca, antes dos outros filtros)
  const lojas = new Map();
  for (const i of base) {
    const l = lojas.get(i.loja) || { nome: i.loja, icone: i.lojaIcone, n: 0, min: Infinity };
    l.n++;
    l.min = Math.min(l.min, i.preco);
    if (!l.icone && i.lojaIcone) l.icone = i.lojaIcone;
    lojas.set(i.loja, l);
  }

  return { facetas: facetas.grupos, alvoId: alvo?.id || null, todos, base, foraDoAssunto, lista, grupo, usaUnidade, ordem, destaques, lojas: [...lojas.values()].sort((a, b) => b.n - a.n || a.min - b.min) };
}

// ---------------------------------------------------------------------------
// Peda\xE7os da tela
// ---------------------------------------------------------------------------

const foto = (i, classe = 'foto') => \`<img class="\${classe}" src="\${esc(i.foto || fotoReserva)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">\`;

function linhaFrete(i) {
  const seu = i.freteDeVoce ? ' <span class="seu">(informado por voc\xEA)</span>' : '';
  const alterar = i.freteDeVoce ? ' <button type="button" class="link mini" data-acao="informar-frete">alterar</button>' : '';
  if (i.frete === 0) return \`<span class="frete bom">Frete gr\xE1tis\${seu}\${alterar}</span>\`;
  if (i.frete == null) return '<span class="frete">Frete a calcular \xB7 <button type="button" class="link mini" data-acao="informar-frete">informar</button></span>';
  return \`<span class="frete">+ \${brl(i.frete)} de frete\${seu}\${alterar} \xB7 <strong>total \${brl(i.total)}</strong></span>\`;
}

function formFrete(i) {
  const v = typeof prefs.fretes[i.id] === 'number' ? String(prefs.fretes[i.id]).replace('.', ',') : '';
  return \`<form class="form-frete" data-form="frete" data-id="\${esc(i.id)}">
    <label class="sr" for="fr-\${esc(i.id)}">Frete em reais</label><span aria-hidden="true">R$</span>
    <input id="fr-\${esc(i.id)}" name="frete" inputmode="decimal" placeholder="0 = gr\xE1tis" value="\${esc(v)}" autocomplete="off">
    <button type="submit" class="botao">Usar</button>
    \${v ? '<button type="button" class="link" data-acao="limpar-frete">apagar</button>' : ''}
    <p class="erro-campo" hidden></p>
  </form>\`;
}

const SVG_CORACAO = (cheio) =>
  \`<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.3C1.4 7.8 3.6 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.4 0 5.6 3.3 4.3 6.7-1.8 4.7-9.3 9.3-9.3 9.3z" fill="\${cheio ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>\`;

function botaoCoracao(i) {
  const salvo = estaSalvo(prefs, i.id);
  return \`<button type="button" class="coracao" data-acao="favoritar" data-id="\${esc(i.id)}" aria-pressed="\${salvo}" title="\${salvo ? 'Tirar dos salvos' : 'Salvar nos favoritos'}" aria-label="\${salvo ? 'Tirar dos salvos' : 'Salvar nos favoritos'}">\${SVG_CORACAO(salvo)}</button>\`;
}

function seloVariacao(i) {
  const sv = prefs.salvos[i.id];
  if (!sv) return '';
  const d = Math.round((i.preco - sv.precoSalvo) * 100) / 100;
  if (Math.abs(d) < 0.01) return '';
  return d < 0
    ? \`<span class="variacao caiu">\u25BC \${brl(-d)} desde que voc\xEA salvou</span>\`
    : \`<span class="variacao subiu">\u25B2 \${brl(d)} desde que voc\xEA salvou</span>\`;
}

function htmlCartao(i, c) {
  const selos = [];
  if (c.destaques.preco?.id === i.id) selos.push('<span class="selo verde">Menor pre\xE7o</span>');
  else if (c.destaques.total?.id === i.id) selos.push('<span class="selo verde">Menor total</span>');
  if (c.destaques.unidade?.id === i.id && c.destaques.preco?.id !== i.id) selos.push(\`<span class="selo amarelo">Melhor pre\xE7o por \${POR[c.grupo]}</span>\`);
  const marcado = comparar.has(i.id);
  const unit =
    i.unit != null && c.usaUnidade && i.grupo === c.grupo
      ? \`<span class="unit" title="\${i.freteConhecido ? 'Inclui o frete' : 'Sem o frete'}">\${brl(i.unit)} por \${POR[i.grupo]}</span>\`
      : '';
  const direto = i.linkDireto && linkSeguro(i.link);
  return \`<article class="cartao\${c.destaques.preco?.id === i.id ? ' vencedor' : ''}" data-id="\${esc(i.id)}">
    <div class="cartao-foto">
      \${foto(i)}
      <div class="selos">\${selos.join('')}</div>
      \${i.desconto >= 0.01 ? \`<span class="off">\u2212\${Math.round(i.desconto * 100)}%</span>\` : ''}
      <button type="button" class="botao-comparar" data-acao="comparar" aria-pressed="\${marcado}" title="\${marcado ? 'Tirar da compara\xE7\xE3o' : 'Comparar'}">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">\${marcado ? '<path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' : '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg>
        <span>\${marcado ? 'Comparando' : 'Comparar'}</span>
      </button>
    </div>
    <div class="cartao-corpo">
      <div class="loja-linha">\${avatarLoja(i.loja, i.lojaIcone)}<span class="loja-nome">\${esc(i.loja)}</span>\${i.fonte === 'manual' ? '<span class="mais">sua oferta</span>' : i.variasLojas ? '<span class="mais">+ lojas</span>' : ''}\${botaoCoracao(i)}</div>
      \${seloVariacao(i)}
      <h3 class="titulo" title="\${esc(i.titulo)}">\${esc(i.titulo)}</h3>
      \${estrelas(i.avaliacao, i.avaliacoes)}
      <div class="preco-bloco">
        <span class="rotulo-preco">Pre\xE7o na loja</span>
        <div class="preco-linha">\${precoGrande(i.preco)}\${i.precoOriginal > i.preco ? \`<s>\${brl(i.precoOriginal)}</s>\` : ''}</div>
        \${linhaFrete(i)}
        \${editandoFreteId === i.id ? formFrete(i) : ''}
        \${unit}
      </div>
      <div class="acoes">
        \${i.fonte === 'manual' ? '' : '<button type="button" class="botao" data-acao="detalhe">Ver onde comprar</button>'}
        \${direto ? \`<a class="botao-sec" href="\${esc(direto)}" target="_blank" rel="noopener noreferrer">Ir \xE0 loja \u2197</a>\` : ''}
        \${i.fonte === 'manual' ? \`\${linkSeguro(i.link) ? \`<a class="botao-sec" href="\${esc(linkSeguro(i.link))}" target="_blank" rel="noopener noreferrer">Ir \xE0 loja \u2197</a>\` : ''}<button type="button" class="botao-sec perigo" data-acao="remover-manual">Remover</button>\` : ''}
      </div>
      \${i.fonte === 'manual' ? '' : \`<button type="button" class="parecidos\${c.alvoId === i.id ? ' ativo' : ''}" data-acao="parecidos">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="10" cy="10" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
        \${c.alvoId === i.id ? 'Mostrando parecidos' : 'S\xF3 parecidos com este'}</button>\`}
    </div>
  </article>\`;
}

function htmlDestaques(c) {
  const d = c.destaques;
  const itens = [
    d.preco && ['Menor pre\xE7o', d.preco, precoGrande(d.preco.preco, 'pequeno'), d.preco.frete === 0 ? 'com frete gr\xE1tis' : d.preco.frete == null ? 'frete a calcular' : \`+ \${brl(d.preco.frete)} de frete\`],
    d.total && ['Menor total com frete', d.total, precoGrande(d.total.total, 'pequeno'), \`\${brl(d.total.preco)} + \${d.total.frete ? brl(d.total.frete) : 'frete gr\xE1tis'}\`],
    d.unidade && [\`Melhor pre\xE7o por \${POR[c.grupo]}\`, d.unidade, \`\${precoGrande(d.unidade.unit, 'pequeno')}<span class="por">/\${SIGLA[c.grupo]}</span>\`, \`\${brl(d.unidade.preco)} por \${fmtQtd(d.unidade.qtd, c.grupo)}\`],
    d.avaliacao && ['Mais bem avaliado', d.avaliacao, precoGrande(d.avaliacao.preco, 'pequeno'), \`\${num(d.avaliacao.avaliacao, 1)} \u2605 \xB7 \${d.avaliacao.avaliacoes.toLocaleString('pt-BR')} avalia\xE7\xF5es\`],
  ].filter(Boolean);
  if (!itens.length) return '';
  return \`<section class="destaques" aria-label="Destaques">\${itens
    .map(
      ([rotulo, i, valor, sub], k) => \`<button type="button" class="destaque\${k === 0 ? ' principal' : ''}" data-acao="detalhe" data-id="\${esc(i.id)}">
        <span class="d-rotulo">\${rotulo}</span>
        <span class="d-valor">\${valor}</span>
        <span class="d-sub">\${esc(sub)}</span>
        <span class="d-loja">\${avatarLoja(i.loja, i.lojaIcone, 'mini')}<span>\${esc(i.loja)}</span></span>
      </button>\`
    )
    .join('')}</section>\`;
}

function htmlFiltros(c) {
  const lojas = c.lojas
    .map(
      (l) => \`<label class="opcao-loja">
        <input type="checkbox" data-filtro-loja="\${esc(l.nome)}" \${filtros.lojas.has(l.nome) ? 'checked' : ''}>
        \${avatarLoja(l.nome, l.icone, 'mini')}
        <span class="ol-nome">\${esc(l.nome)}</span>
        <span class="ol-info">\${l.n} \xB7 \${brl(l.min)}</span>
      </label>\`
    )
    .join('');
  const chk = (chave, texto) =>
    \`<label class="interruptor"><input type="checkbox" data-filtro="\${chave}" \${filtros[chave] ? 'checked' : ''}><span class="trilho" aria-hidden="true"></span>\${texto}</label>\`;
  return \`
    <div class="f-cabeca"><h2>Filtros</h2><button type="button" class="link" data-acao="limpar-filtros">Limpar</button>
      <button type="button" class="fechar-sheet" data-acao="fechar-filtros" aria-label="Fechar filtros">\xD7</button></div>
    \${c.facetas.map((g) => htmlGrupoFaceta(g)).join('')}
    <div class="f-grupo">
      <h3>Lojas</h3>
      <div class="lista-lojas">\${lojas}</div>
    </div>
    <div class="f-grupo">
      <h3>Pre\xE7o na loja</h3>
      <div class="faixa-preco">
        <label><span>De R$</span><input id="f-min" data-filtro-preco="precoMin" inputmode="decimal" placeholder="0" value="\${esc(filtros.precoMin)}"></label>
        <label><span>At\xE9 R$</span><input id="f-max" data-filtro-preco="precoMax" inputmode="decimal" placeholder="sem limite" value="\${esc(filtros.precoMax)}"></label>
      </div>
    </div>
    <div class="f-grupo">
      <h3>Mostrar s\xF3</h3>
      \${chk('relevantes', 'O que combina com a busca')}
      \${chk('freteGratis', 'Frete gr\xE1tis')}
      \${chk('promocao', 'Em promo\xE7\xE3o')}
      \${chk('avaliacao4', '4 estrelas ou mais')}
      \${c.usaUnidade ? chk('comTamanho', \`Com pre\xE7o por \${POR[c.grupo]}\`) : ''}
    </div>
    <div class="f-rodape"><button type="button" class="botao" data-acao="fechar-filtros">Ver \${c.lista.length} oferta\${c.lista.length === 1 ? '' : 's'}</button></div>\`;
}

const MOSTRAR_OPCOES = 8;

function botaoFaceta(g, o) {
  const marcado = Boolean(filtros.facetas[g.id]?.has(o.valor));
  const vazio = !o.n && !marcado;
  return \`<button type="button" class="chip-filtro\${vazio ? ' vazio' : ''}" data-acao="faceta" data-faceta="\${esc(g.id)}" data-valor="\${esc(o.valor)}" aria-pressed="\${marcado}"\${vazio ? ' aria-disabled="true" title="Nenhuma oferta com os outros filtros escolhidos"' : ''}>\${esc(o.rotulo)}<span class="n">\${o.n}</span></button>\`;
}

function htmlGrupoFaceta(g) {
  const aberto = gruposAbertos.has(g.id);
  const marcadas = filtros.facetas[g.id] || new Set();
  // As marcadas sempre aparecem, mesmo com o grupo recolhido
  const visiveis = aberto ? g.opcoes : g.opcoes.filter((o, k) => k < MOSTRAR_OPCOES || marcadas.has(o.valor));
  const resto = g.opcoes.length - visiveis.length;
  return \`<div class="f-grupo">
    <h3>\${esc(g.nome)}</h3>
    <div class="chips-filtro">\${visiveis.map((o) => botaoFaceta(g, o)).join('')}</div>
    \${resto > 0 || aberto && g.opcoes.length > MOSTRAR_OPCOES ? \`<button type="button" class="link mini" data-acao="abrir-grupo" data-faceta="\${esc(g.id)}">\${aberto ? 'Mostrar menos' : \`Ver mais \${resto}\`}</button>\` : ''}
  </div>\`;
}

/** Faixa r\xE1pida acima dos resultados: o grupo mais \xFAtil (o do Google, ou tamanho, ou caracter\xEDsticas). */
function htmlFaixaRapida(c) {
  const g = c.facetas.find((x) => x.id === 'g0') || c.facetas.find((x) => x.id === 'tamanho') || c.facetas.find((x) => x.id === 'carac') || c.facetas[0];
  if (!g) return '';
  return \`<div class="faixa-rapida" role="group" aria-label="\${esc(g.nome)}"><span class="fr-nome">\${esc(g.nome)}</span>\${g.opcoes
    .slice(0, 12)
    .map((o) => botaoFaceta(g, o))
    .join('')}</div>\`;
}

function chipsAtivos(cc) {
  const c = [];
  for (const g of cc?.facetas || []) {
    for (const v of filtros.facetas[g.id] || []) {
      const o = g.opcoes.find((x) => x.valor === v);
      c.push([\`faceta\`, \`\${g.nome}: \${o ? o.rotulo : v}\`, g.id, v]);
    }
  }
  for (const l of filtros.lojas) c.push([\`loja:\${l}\`, l]);
  if (filtros.precoMin) c.push(['precoMin', \`De \${brl(lerNumero(filtros.precoMin))}\`]);
  if (filtros.precoMax) c.push(['precoMax', \`At\xE9 \${brl(lerNumero(filtros.precoMax))}\`]);
  if (filtros.freteGratis) c.push(['freteGratis', 'Frete gr\xE1tis']);
  if (filtros.promocao) c.push(['promocao', 'Em promo\xE7\xE3o']);
  if (filtros.avaliacao4) c.push(['avaliacao4', '4\u2605 ou mais']);
  if (filtros.comTamanho) c.push(['comTamanho', 'Com pre\xE7o por unidade']);
  if (filtros.parecidosCom) c.unshift(['parecidosCom', \`Parecidos com: \${filtros.parecidosCom.titulo.slice(0, 40)}\${filtros.parecidosCom.titulo.length > 40 ? '\u2026' : ''}\`]);
  return c;
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

let ultimo = null;

function desenhar() {
  document.body.classList.toggle('buscou', Boolean(busca.q));
  const res = $('#resultados');
  res.hidden = !busca.q;
  if (!busca.q) return;

  if (busca.carregando) {
    $('#status').textContent = \`Buscando ofertas de \u201C\${busca.q}\u201D\u2026\`;
    $('#aviso-demo').hidden = true;
    $('#destaques').innerHTML = '';
    $('#faixa-rapida').innerHTML = '';
    $('#chips').innerHTML = '';
    $('#grade').innerHTML = '<div class="cartao esq"></div>'.repeat(8);
    $('#filtros-conteudo').innerHTML = '';
    return;
  }
  if (busca.erro) {
    $('#status').textContent = '';
    $('#faixa-rapida').innerHTML = '';
    $('#destaques').innerHTML = '';
    $('#chips').innerHTML = '';
    $('#filtros-conteudo').innerHTML = '';
    $('#grade').innerHTML = \`<div class="aviso-erro" role="alert"><strong>A busca n\xE3o deu certo.</strong> \${esc(busca.erro)}
      <button type="button" class="botao-sec" data-acao="repetir">Tentar de novo</button></div>\`;
    return;
  }

  const c = calcular();
  ultimo = c;
  const NOMES = { google: 'Google Shopping', mercadolivre: 'Mercado Livre', demo: 'demonstra\xE7\xE3o' };
  const via = busca.fontes.map((f) => NOMES[f] || f).join(' e ');
  const hora = busca.verificadoEm ? new Date(busca.verificadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  const n = c.lista.length;
  const fora = c.foraDoAssunto
    ? \`<span class="fora">\${c.foraDoAssunto} fora do assunto escondida\${c.foraDoAssunto === 1 ? '' : 's'} \xB7 <button type="button" class="link" data-acao="mostrar-todos">mostrar</button></span>\`
    : '';
  const l = busca.local;
  const cepFmt = prefs.cep ? \`\${prefs.cep.slice(0, 5)}-\${prefs.cep.slice(5)}\` : '';
  const regiao = l
    ? \`<span class="regiao">Frete estimado para \${esc(l.nivel === 'demo' ? \`o CEP \${cepFmt}\` : \`\${l.cidade}\${l.uf ? \` - \${l.uf}\` : ''}\`)}\${l.nivel === 'estado' ? ' (pelo estado)' : ''} \xB7 <button type="button" class="link mini" data-acao="editar-cep">trocar CEP</button></span>\`
    : \`<span class="regiao"><button type="button" class="link mini" data-acao="editar-cep">\${prefs.cep ? \`CEP \${cepFmt} \xB7 trocar\` : 'Coloque seu CEP para ver o frete da sua regi\xE3o'}</button></span>\`;
  $('#status').innerHTML = \`<strong>\${n}</strong> oferta\${n === 1 ? '' : 's'} para \u201C\${esc(busca.q)}\u201D<span class="meta">\${via ? \` \xB7 via \${esc(via)}\` : ''}\${hora ? \` \xB7 \xE0s \${hora}\` : ''}</span>\${regiao}\${fora}\`;
  $('#aviso-demo').hidden = !busca.aviso;
  $('#aviso-demo').textContent = busca.aviso;

  desenharOrdem(c);

  const ativos = chipsAtivos(c);
  $('#chips').innerHTML = ativos.length
    ? ativos
        .map(
          ([k, t, g, v]) =>
            \`<button type="button" class="chip-ativo" data-remover-filtro="\${esc(k)}"\${g ? \` data-faceta="\${esc(g)}" data-valor="\${esc(v)}"\` : ''}>\${esc(t)}<span aria-hidden="true">\xD7</span></button>\`
        )
        .join('') +
      '<button type="button" class="link" data-acao="limpar-filtros">Limpar tudo</button>'
    : '';
  const nFiltros = ativos.length;
  $('#botao-filtros').innerHTML = \`<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M4.5 8h7M7 12h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>Filtros\${nFiltros ? \`<span class="contador">\${nFiltros}</span>\` : ''}\`;

  $('#faixa-rapida').innerHTML = htmlFaixaRapida(c);
  $('#destaques').innerHTML = htmlDestaques(c);
  $('#grade').innerHTML = c.lista.length
    ? c.lista.map((i) => htmlCartao(i, c)).join('')
    : !c.base.length && c.foraDoAssunto
      ? \`<div class="vazio">Nenhuma oferta tem todas as palavras da busca. Tente escrever de outro jeito, ou <button type="button" class="link" data-acao="mostrar-todos">mostre todas as ofertas</button>.</div>\`
      : \`<div class="vazio">Nenhuma oferta com esses filtros. <button type="button" class="link" data-acao="limpar-filtros">Limpar filtros</button></div>\`;

  // N\xE3o redesenha o formul\xE1rio de filtros enquanto algu\xE9m digita o pre\xE7o
  const ativo = document.activeElement;
  if (!(ativo && ativo.dataset && ativo.dataset.filtroPreco)) $('#filtros-conteudo').innerHTML = htmlFiltros(c);
  else $('#filtros-conteudo .f-rodape .botao').textContent = \`Ver \${c.lista.length} oferta\${c.lista.length === 1 ? '' : 's'}\`;

  desenharBandeja(c);
}

// Menu de ordena\xE7\xE3o (no lugar do seletor do sistema)
function opcoesDeOrdem(c) {
  return [
    ['relevancia', 'Relev\xE2ncia', 'Como o Google ordenou'],
    ['preco', 'Menor pre\xE7o', 'Pre\xE7o na loja, sem o frete'],
    ['total', 'Menor total com frete', 'Ofertas sem frete conhecido v\xE3o para o fim'],
    c.usaUnidade && ['unidade', \`Menor pre\xE7o por \${POR[c.grupo]}\`, 'Compara tamanhos diferentes'],
    ['desconto', 'Maior desconto', 'Em rela\xE7\xE3o ao pre\xE7o antigo'],
    ['avaliacao', 'Melhor avalia\xE7\xE3o', 'Nota e n\xFAmero de avalia\xE7\xF5es'],
  ].filter(Boolean);
}

function desenharOrdem(c) {
  const opcoes = opcoesDeOrdem(c);
  $('#ordem-atual').textContent = (opcoes.find(([v]) => v === c.ordem) || opcoes[0])[1];
  $('#menu-ordem').innerHTML = \`<div class="menu-cabeca">Ordenar por<button type="button" class="fechar" data-acao="fechar-ordem" aria-label="Fechar">\xD7</button></div>\${opcoes
    .map(
      ([v, rotulo, dica]) => \`<button type="button" class="opcao-ordem" role="option" data-acao="escolher-ordem" data-ordem="\${v}" aria-selected="\${v === c.ordem}">
        <svg class="marca-ok" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>\${esc(rotulo)}<small>\${esc(dica)}</small></span></button>\`
    )
    .join('')}\`;
}

function abrirOrdem(abrir) {
  const menu = $('#menu-ordem');
  menu.hidden = !abrir;
  $('#botao-ordem').setAttribute('aria-expanded', String(abrir));
  document.body.classList.toggle('ordem-aberta', abrir);
  if (abrir) (menu.querySelector('[aria-selected="true"]') || menu.querySelector('.opcao-ordem'))?.focus();
}

function itemPorId(id) {
  return (ultimo?.todos || []).find((i) => i.id === id);
}

function desenharBandeja(c) {
  const b = $('#bandeja');
  const sel = [...comparar].map((id) => c.todos.find((i) => i.id === id)).filter(Boolean);
  b.hidden = !sel.length;
  if (!sel.length) return;
  b.innerHTML = \`<div class="bandeja-dentro">
    <div class="bandeja-fotos">\${sel.map((i) => \`<span class="mini-foto">\${foto(i, 'f')}</span>\`).join('')}
      \${Array.from({ length: MAX_COMPARAR - sel.length }, () => '<span class="mini-foto vaga"></span>').join('')}</div>
    <span class="bandeja-texto">\${sel.length} de \${MAX_COMPARAR} para comparar</span>
    <button type="button" class="link" data-acao="limpar-comparar">Limpar</button>
    <button type="button" class="botao" data-acao="abrir-comparar" \${sel.length < 2 ? 'disabled title="Escolha pelo menos 2"' : ''}>Comparar</button>
  </div>\`;
}

// ---------------------------------------------------------------------------
// Compara\xE7\xE3o lado a lado
// ---------------------------------------------------------------------------

function abrirComparar() {
  const sel = [...comparar].map(itemPorId).filter(Boolean);
  if (sel.length < 2) return;
  const c = ultimo;
  const melhor = (f, maior = false) => {
    const vals = sel.map(f).filter((v) => v != null && Number.isFinite(v));
    if (vals.length < 2) return null;
    return maior ? Math.max(...vals) : Math.min(...vals);
  };
  const linha = (rotulo, f, fmt, { maior = false } = {}) => {
    const alvo = melhor(f, maior);
    return \`<tr><th scope="row">\${rotulo}</th>\${sel
      .map((i) => {
        const v = f(i);
        const ok = alvo != null && v === alvo;
        return \`<td class="\${ok ? 'melhor' : ''}">\${v == null || !Number.isFinite(v) ? '<span class="nd">\u2014</span>' : fmt(v, i)}\${ok ? '<span class="sr"> (melhor)</span>' : ''}</td>\`;
      })
      .join('')}</tr>\`;
  };
  const unitOk = (i) => (c.usaUnidade && i.grupo === c.grupo ? i.unit : null);
  $('#dlg-comparar').innerHTML = \`<div class="dlg-cabeca"><h2>Comparar ofertas</h2><button type="button" class="fechar" data-acao="fechar-dialogo" aria-label="Fechar">\xD7</button></div>
    <div class="tabela-rolagem"><table class="tabela-comparar">
      <thead><tr><th></th>\${sel
        .map(
          (i) => \`<th scope="col"><div class="tc-produto">\${foto(i, 'tc-foto')}<span class="tc-titulo">\${esc(i.titulo)}</span>
            <span class="tc-loja">\${avatarLoja(i.loja, i.lojaIcone, 'mini')}\${esc(i.loja)}</span></div></th>\`
        )
        .join('')}</tr></thead>
      <tbody>
        \${linha('Pre\xE7o na loja', (i) => i.preco, (v) => \`<strong>\${brl(v)}</strong>\`)}
        \${linha('Frete', (i) => i.frete, (v) => (v === 0 ? 'Gr\xE1tis' : brl(v)))}
        \${linha('Total com frete', (i) => (i.freteConhecido ? i.total : null), (v) => \`<strong>\${brl(v)}</strong>\`)}
        \${c.usaUnidade ? linha(\`Pre\xE7o por \${POR[c.grupo]}\`, unitOk, (v) => brl(v)) : ''}
        \${c.usaUnidade ? linha('Quantidade', (i) => (i.grupo === c.grupo ? i.qtd : null), (v) => fmtQtd(v, c.grupo), { maior: true }) : ''}
        \${linha('Desconto', (i) => (i.desconto > 0 ? i.desconto : null), (v) => \`\u2212\${Math.round(v * 100)}%\`, { maior: true })}
        \${linha('Avalia\xE7\xE3o', (i) => i.avaliacao, (v, i) => \`\${num(v, 1)} \u2605\${i.avaliacoes ? \` <span class="nd">(\${i.avaliacoes.toLocaleString('pt-BR')})</span>\` : ''}\`, { maior: true })}
        <tr><th scope="row"></th>\${sel.map((i) => \`<td><button type="button" class="botao" data-acao="detalhe" data-id="\${esc(i.id)}">Ver onde comprar</button></td>\`).join('')}</tr>
      </tbody>
    </table></div>
    <p class="nota-tabela">Em verde, o melhor valor de cada linha.</p>\`;
  abrirDialogo('#dlg-comparar');
}

// ---------------------------------------------------------------------------
// Detalhe: onde comprar
// ---------------------------------------------------------------------------

async function abrirDetalhe(id) {
  const item = itemPorId(id);
  if (!item) return;
  detalhe = { item, carregando: true, erro: '', dados: null, editandoTamanho: false };
  desenharDetalhe();
  abrirDialogo('#dlg-detalhe');
  try {
    const dados = await buscarLojas(item);
    if (detalhe?.item.id !== id) return;
    detalhe.dados = dados;
  } catch (e) {
    if (detalhe?.item.id !== id) return;
    detalhe.erro = e.message;
  }
  detalhe.carregando = false;
  desenharDetalhe();
}

function desenharDetalhe() {
  if (!detalhe) return;
  const i = detalhe.item;
  const c = ultimo;
  const fotoPrincipal = detalhe.dados?.produto?.fotos?.[0] || i.foto;
  const linkFonte = linkSeguro(i.link);
  let lojasHtml;
  if (detalhe.carregando) {
    lojasHtml = '<div class="lojas-carregando"><span></span><span></span><span></span></div>';
  } else if (detalhe.erro) {
    lojasHtml = \`<div class="aviso-erro">\${esc(detalhe.erro)}\${linkFonte ? \` <a href="\${esc(linkFonte)}" target="_blank" rel="noopener noreferrer">Abrir a oferta original \u2197</a>\` : ''}</div>\`;
  } else {
    const lojas = detalhe.dados?.lojas || [];
    const menor = lojas[0]?.total ?? null;
    lojasHtml = lojas.length
      ? \`<ol class="lojas">\${lojas
          .map((l, k) => {
            const link = linkSeguro(l.link);
            const extras = [
              l.cupom && \`<span class="chip cupom">Cupom \${esc(l.cupom)}</span>\`,
              l.desconto && \`<span class="chip">\${esc(l.desconto)}</span>\`,
              l.parcelas && \`<span class="chip">\${esc(l.parcelas)}</span>\`,
              ...(l.detalhes || []).slice(0, 2).map((d) => \`<span class="chip">\${esc(d)}</span>\`),
            ]
              .filter(Boolean)
              .join('');
            return \`<li class="\${k === 0 ? 'mais-barata' : ''}">
              <div class="l-loja">\${avatarLoja(l.loja, l.icone, 'medio')}<div><span class="l-nome">\${esc(l.loja)}</span>
                \${k === 0 && menor != null ? '<span class="selo verde">Menor total</span>' : ''}\${l.avaliacao ? estrelas(l.avaliacao, l.avaliacoes) : ''}</div></div>
              <div class="l-preco">
                <div class="preco-linha">\${precoGrande(l.preco, 'medio')}\${l.precoOriginal > l.preco ? \`<s>\${brl(l.precoOriginal)}</s>\` : ''}</div>
                <span class="frete\${l.freteGratis ? ' bom' : ''}">\${l.freteGratis ? 'Frete gr\xE1tis' : l.frete != null ? \`+ \${brl(l.frete)} de frete\` : 'Frete a calcular'}\${l.total != null && !l.freteGratis && l.frete != null ? \` \xB7 <strong>total \${brl(l.total)}</strong>\` : ''}</span>
              </div>
              \${extras ? \`<div class="l-extras">\${extras}</div>\` : ''}
              \${link ? \`<a class="botao l-ir" href="\${esc(link)}" target="_blank" rel="noopener noreferrer">Ir para a loja \u2197</a>\` : '<span class="l-ir nd">Link indispon\xEDvel na demonstra\xE7\xE3o</span>'}
            </li>\`;
          })
          .join('')}</ol>\`
      : \`<div class="aviso-erro">N\xE3o encontrei outras lojas para este produto.\${linkFonte ? \` <a href="\${esc(linkFonte)}" target="_blank" rel="noopener noreferrer">Abrir a oferta original \u2197</a>\` : ''}</div>\`;
  }

  const tamanho = i.qtd
    ? \`\${fmtQtd(i.qtd, i.grupo)}\${i.embalagens > 1 ? \` (\${i.embalagens} \xD7 \${num(lerNumero(i.conteudo))} \${i.unidade})\` : ''}\${i.unit != null ? \` \xB7 \${brl(i.unit)} por \${POR[i.grupo]}\` : ''}\`
    : 'Tamanho n\xE3o informado';

  $('#dlg-detalhe').innerHTML = \`<div class="dlg-cabeca"><h2>Onde comprar</h2><button type="button" class="fechar" data-acao="fechar-dialogo" aria-label="Fechar">\xD7</button></div>
    <div class="det-produto">
      <img class="det-foto" src="\${esc(fotoPrincipal || fotoReserva)}" alt="" referrerpolicy="no-referrer">
      <div class="det-info">
        <h3>\${esc(detalhe.dados?.produto?.titulo || i.titulo)}</h3>
        \${estrelas(detalhe.dados?.produto?.avaliacao ?? i.avaliacao, detalhe.dados?.produto?.avaliacoes ?? i.avaliacoes)}
        <p class="det-tamanho">\${esc(tamanho)} <button type="button" class="link" data-acao="editar-tamanho">\${i.qtd ? 'corrigir' : 'informar tamanho'}</button></p>
        \${
          detalhe.editandoTamanho
            ? \`<form class="form-tamanho" data-form="tamanho"><label class="sr" for="tam">Tamanho</label>
                <input id="tam" name="tamanho" placeholder="ex.: 900 ml, 1 kg, 12 unidades, 3 x 250 ml" autocomplete="off">
                <button type="submit" class="botao">Usar</button><p class="erro-campo" hidden></p></form>\`
            : ''
        }
        <p class="det-oferta">Oferta encontrada: \${avatarLoja(i.loja, i.lojaIcone, 'mini')} \${esc(i.loja)} \xB7 <strong>\${brl(i.preco)}</strong></p>
        <div class="det-acoes">
          <button type="button" class="botao-sec salvar\${estaSalvo(prefs, i.id) ? ' ativo' : ''}" data-acao="favoritar" data-id="\${esc(i.id)}">\${SVG_CORACAO(estaSalvo(prefs, i.id))}\${estaSalvo(prefs, i.id) ? 'Salvo' : 'Salvar'}</button>
          <button type="button" class="botao-sec" data-acao="escolher-listas" data-id="\${esc(i.id)}">Salvar em lista\u2026</button>
          <button type="button" class="botao-sec" data-acao="parecidos" data-id="\${esc(i.id)}">S\xF3 parecidos com este</button>
          <button type="button" class="botao-sec" data-acao="buscar-parecidos" data-id="\${esc(i.id)}" title="Faz uma busca nova com o nome deste produto">Buscar mais parecidos nas lojas</button>
        </div>
      </div>
    </div>
    <h3 class="det-sub">Lojas com este produto <span class="nd">\xB7 menor total primeiro</span></h3>
    \${lojasHtml}
    <p class="nota-tabela">Pre\xE7os e frete informados pelas lojas ao Google. Confira o valor final na loja antes de pagar.</p>\`;
  if (detalhe.editandoTamanho) $('#tam')?.focus();
  void c;
}

// ---------------------------------------------------------------------------
// Di\xE1logos
// ---------------------------------------------------------------------------

function abrirDialogo(sel) {
  const d = $(sel);
  if (!d.open) {
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }
}
function fecharDialogos() {
  for (const d of document.querySelectorAll('dialog[open]')) d.close ? d.close() : d.removeAttribute('open');
  detalhe = null;
}

// ---------------------------------------------------------------------------
// A\xE7\xF5es
// ---------------------------------------------------------------------------

async function executarBusca(q) {
  q = q.trim().replace(/\\s+/g, ' ');
  if (q.length < 2) {
    $('#q').focus();
    return;
  }
  Object.assign(busca, { q, carregando: true, erro: '', itens: [] });
  filtros = FILTROS_VAZIOS();
  comparar.clear();
  editandoFreteId = null;
  gruposAbertos.clear();
  prefs.ultimaBusca = q;
  salvar();
  desenhar();
  try {
    Object.assign(busca, { local: null }, await buscarProdutos(q, { cep: prefs.cep }), { carregando: false });
    if (registrarPrecosVistos(prefs, busca.itens)) salvar();
  } catch (e) {
    Object.assign(busca, { itens: [], carregando: false, erro: e.message });
  }
  desenhar();
}

function aoClicar(ev) {
  const alvo = ev.target.closest('[data-acao], [data-remover-filtro]');
  if (!alvo) return;
  const cartao = alvo.closest('[data-id]');
  const id = alvo.dataset.id || cartao?.dataset.id;
  if (alvo.dataset.removerFiltro) {
    const k = alvo.dataset.removerFiltro;
    if (k === 'faceta') filtros.facetas[alvo.dataset.faceta]?.delete(alvo.dataset.valor);
    else if (k.startsWith('loja:')) filtros.lojas.delete(k.slice(5));
    else if (k === 'parecidosCom') filtros.parecidosCom = null;
    else filtros[k] = typeof filtros[k] === 'boolean' ? false : '';
    return desenhar();
  }
  const salvoId = alvo.closest('.salvos li')?.dataset.id;
  switch (alvo.dataset.acao) {
    case 'entrar-google':
      return conta.entrar();
    case 'sair-conta':
      return conta.sair();
    case 'apagar-conta':
      apagandoConta = true;
      return desenharConta();
    case 'cancelar-apagar-conta':
      apagandoConta = false;
      return desenharConta();
    case 'apagar-conta-sim':
      apagandoConta = false;
      return conta.apagarConta();
    case 'sincronizar-agora':
      return conta.sincronizar();
    case 'fechar-conta':
      return abrirPainelConta(false);
    case 'editar-cep': {
      const caixa = $('#form-busca');
      caixa.classList.add('expandida');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const c = $('#cep');
      c.focus();
      c.select();
      return;
    }
    case 'favoritar':
      return favoritar(id);
    case 'abrir-salvos':
      return abrirSalvos();
    case 'aba-lista':
      listaAberta = alvo.dataset.lista;
      editandoLista = apagandoLista = null;
      return desenharSalvos();
    case 'renomear-lista':
      editandoLista = alvo.dataset.lista;
      return desenharSalvos();
    case 'apagar-lista':
      apagandoLista = alvo.dataset.lista;
      return desenharSalvos();
    case 'apagar-lista-sim':
      apagarLista(prefs, alvo.dataset.lista);
      listaAberta = FAVORITOS;
      apagandoLista = null;
      salvar();
      return redesenharTudo();
    case 'cancelar-lista':
      editandoLista = apagandoLista = null;
      return desenharSalvos();
    case 'qtd-mais':
    case 'qtd-menos':
      mudarQuantidade(prefs, salvoId, alvo.dataset.acao === 'qtd-mais' ? 1 : -1);
      salvar();
      return desenharSalvos();
    case 'tirar-da-lista': {
      const antes = JSON.parse(JSON.stringify(prefs.salvos[salvoId]));
      tirarDaLista(prefs, salvoId, alvo.dataset.lista);
      salvar();
      redesenharTudo();
      return avisar('Tirado da lista.', 'Desfazer', () => {
        restaurarSalvo(prefs, salvoId, antes);
        salvar();
        redesenharTudo();
      });
    }
    case 'buscar-salvo': {
      const sv = prefs.salvos[salvoId];
      if (!sv) return;
      fecharDialogos();
      const q = buscaParecida(sv.item.titulo);
      $('#q').value = q;
      return executarBusca(q);
    }
    case 'escolher-listas':
      return abrirListasDoItem(salvoId || id);
    case 'fechar-listas':
      return $('#dlg-listas').close();
    case 'faceta': {
      if (alvo.getAttribute('aria-disabled') === 'true') return;
      const g = alvo.dataset.faceta;
      const set = (filtros.facetas[g] ||= new Set());
      if (set.has(alvo.dataset.valor)) set.delete(alvo.dataset.valor);
      else set.add(alvo.dataset.valor);
      return desenhar();
    }
    case 'abrir-grupo':
      if (gruposAbertos.has(alvo.dataset.faceta)) gruposAbertos.delete(alvo.dataset.faceta);
      else gruposAbertos.add(alvo.dataset.faceta);
      return desenhar();
    case 'comparar':
      if (comparar.has(id)) comparar.delete(id);
      else if (comparar.size < MAX_COMPARAR) comparar.add(id);
      else return avisar(\`D\xE1 para comparar at\xE9 \${MAX_COMPARAR} ofertas de cada vez.\`);
      return desenhar();
    case 'detalhe':
      if ($('#dlg-comparar').open) $('#dlg-comparar').close();
      return abrirDetalhe(id);
    case 'abrir-comparar':
      return abrirComparar();
    case 'limpar-comparar':
      comparar.clear();
      return desenhar();
    case 'limpar-filtros':
      filtros = FILTROS_VAZIOS();
      return desenhar();
    case 'abrir-filtros':
      document.body.classList.add('filtros-abertos');
      return $('#filtros .f-cabeca h2')?.focus?.();
    case 'fechar-filtros':
      return document.body.classList.remove('filtros-abertos');
    case 'fechar-dialogo':
      return fecharDialogos();
    case 'editar-tamanho':
      if (detalhe) {
        detalhe.editandoTamanho = !detalhe.editandoTamanho;
        desenharDetalhe();
      }
      return;
    case 'repetir':
      return executarBusca(busca.q);
    case 'abrir-ordem':
      return abrirOrdem($('#menu-ordem').hidden);
    case 'fechar-ordem':
      return abrirOrdem(false);
    case 'escolher-ordem':
      prefs.ordem = alvo.dataset.ordem;
      salvar();
      abrirOrdem(false);
      desenhar();
      return $('#botao-ordem').focus();
    case 'informar-frete':
      editandoFreteId = editandoFreteId === id ? null : id;
      desenhar();
      return document.querySelector(\`.form-frete[data-id="\${CSS.escape(id)}"] input\`)?.focus();
    case 'limpar-frete':
      delete prefs.fretes[id];
      editandoFreteId = null;
      salvar();
      return desenhar();
    case 'mostrar-todos':
      filtros.relevantes = false;
      return desenhar();
    case 'parecidos': {
      const item = itemPorId(id);
      if (!item) return;
      fecharDialogos();
      filtros.parecidosCom = filtros.parecidosCom?.id === id ? null : { id, titulo: item.titulo };
      desenhar();
      return $('#resultados').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    case 'buscar-parecidos': {
      const item = itemPorId(id);
      if (!item) return;
      fecharDialogos();
      const q = buscaParecida(item.titulo);
      $('#q').value = q;
      return executarBusca(q);
    }
    case 'remover-manual': {
      const k = chaveBusca(busca.q);
      prefs.manuais[k] = (prefs.manuais[k] || []).filter((m) => m.id !== id);
      comparar.delete(id);
      salvar();
      return desenhar();
    }
  }
}

function aoMudar(ev) {
  const el = ev.target;
  if (el.dataset.alternarLista) {
    const item = ofertaParaSalvar(itemDasListas);
    if (item) alternarLista(prefs, item, el.dataset.alternarLista);
    salvar();
    return redesenharTudo();
  }
  if (el.dataset.filtroLoja !== undefined) {
    if (el.checked) filtros.lojas.add(el.dataset.filtroLoja);
    else filtros.lojas.delete(el.dataset.filtroLoja);
  } else if (el.dataset.filtro) {
    filtros[el.dataset.filtro] = el.checked;
  } else if (el.dataset.filtroPreco) {
    filtros[el.dataset.filtroPreco] = el.value;
  } else return;
  desenhar();
}

function erroNoForm(form, texto) {
  const p = $('.erro-campo', form);
  p.textContent = texto;
  p.hidden = !texto;
}

function aoEnviar(ev) {
  const form = ev.target;
  if (form.dataset.form === 'nova-lista' || form.dataset.form === 'nova-lista-item') {
    ev.preventDefault();
    const id = criarLista(prefs, form.nome.value);
    if (!id) return;
    if (form.dataset.form === 'nova-lista-item') {
      const item = ofertaParaSalvar(itemDasListas);
      if (item) salvarItem(prefs, item, id);
    } else listaAberta = id;
    salvar();
    return redesenharTudo();
  }
  if (form.dataset.form === 'renomear-lista') {
    ev.preventDefault();
    renomearLista(prefs, form.dataset.lista, form.nome.value);
    editandoLista = null;
    salvar();
    return redesenharTudo();
  }
  if (form.dataset.form === 'frete') {
    ev.preventDefault();
    const txt = form.frete.value.trim();
    const v = txt === '' ? NaN : lerNumero(txt, NaN);
    if (!(v >= 0)) return erroNoForm(form, 'Digite o valor do frete, por exemplo 12,90. Use 0 para frete gr\xE1tis.');
    prefs.fretes[form.dataset.id] = Math.round(v * 100) / 100;
    editandoFreteId = null;
    salvar();
    return desenhar();
  }
  if (form.dataset.form === 'manual') {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    const preco = lerNumero(d.preco, 0);
    if (!String(d.loja).trim()) return erroNoForm(form, 'Diga o nome da loja.');
    if (!String(d.titulo).trim()) return erroNoForm(form, 'Diga qual \xE9 o produto.');
    if (!(preco > 0)) return erroNoForm(form, 'Informe o pre\xE7o, por exemplo 21,90.');
    const frete = String(d.frete).trim() === '' ? null : lerNumero(d.frete, null);
    const tamanho = lerTitulo(d.titulo) || lerUnidades(d.titulo);
    const k = chaveBusca(busca.q);
    prefs.manuais[k] = [
      ...(prefs.manuais[k] || []),
      {
        id: \`manual:\${Date.now().toString(36)}\${Math.random().toString(36).slice(2, 6)}\`,
        fonte: 'manual',
        loja: String(d.loja).trim(),
        lojaIcone: null,
        titulo: String(d.titulo).trim(),
        preco,
        precoOriginal: null,
        frete,
        freteGratis: frete === 0,
        link: String(d.link || '').trim(),
        linkDireto: false,
        foto: null,
        avaliacao: null,
        avaliacoes: null,
        embalagens: tamanho?.embalagens ?? null,
        conteudo: tamanho?.conteudo ?? null,
        unidade: tamanho?.unidade ?? null,
      },
    ];
    salvar();
    form.reset();
    erroNoForm(form, '');
    $('#manual').open = false;
    avisar('Oferta adicionada \xE0 compara\xE7\xE3o.');
    return desenhar();
  }
  if (form.dataset.form !== 'tamanho') return;
  ev.preventDefault();
  const lido = lerTitulo(form.tamanho.value) || lerUnidades(form.tamanho.value);
  if (!lido) {
    const p = $('.erro-campo', form);
    p.textContent = 'Escreva o tamanho com a unidade, como 900 ml, 1 kg ou 12 unidades.';
    p.hidden = false;
    return;
  }
  prefs.tamanhos[detalhe.item.id] = lido;
  salvar();
  desenhar();
  detalhe.item = itemPorId(detalhe.item.id) || detalhe.item;
  detalhe.editandoTamanho = false;
  desenharDetalhe();
}

/** "12 unidades", "30 rolos", "48 fraldas" \u2192 unidades */
function lerUnidades(txt) {
  const m = String(txt).toLowerCase().match(/(\\d+)\\s*(unidades?|un\\b|unid|rolos?|fraldas?|c[a\xE1]psulas?|sach[e\xEA]s?|pe[c\xE7]as?|pares?)/);
  return m ? { embalagens: 1, conteudo: Number(m[1]), unidade: 'un' } : null;
}

let timerAviso;
function avisar(texto, rotulo, acao) {
  const t = $('#aviso');
  // Com uma janela aberta, o aviso vai para dentro dela (sen\xE3o ficaria por tr\xE1s e n\xE3o daria para tocar)
  const janelas = [...document.querySelectorAll('dialog[open]')];
  const destino = janelas[janelas.length - 1] || document.body;
  if (t.parentElement !== destino) destino.appendChild(t);
  t.innerHTML = \`<span>\${esc(texto)}</span>\${rotulo ? \`<button type="button">\${esc(rotulo)}</button>\` : ''}\`;
  if (rotulo) t.querySelector('button').onclick = () => {
    t.hidden = true;
    acao();
  };
  t.hidden = false;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => (t.hidden = true), rotulo ? 6000 : 3500);
}

// ---------------------------------------------------------------------------
// Meus salvos (favoritos e listas, no aparelho)
// ---------------------------------------------------------------------------

function ofertaParaSalvar(id) {
  return itemPorId(id) || prefs.salvos[id]?.item || null;
}

function atualizarContadorSalvos() {
  const n = Object.keys(prefs.salvos).length;
  $('#botao-salvos .contador').textContent = n;
  $('#botao-salvos .contador').hidden = !n;
}

function favoritar(id) {
  if (estaSalvo(prefs, id)) {
    const registro = removerSalvo(prefs, id);
    salvar();
    redesenharTudo();
    avisar('Tirado dos salvos.', 'Desfazer', () => {
      restaurarSalvo(prefs, id, registro);
      salvar();
      redesenharTudo();
    });
    return;
  }
  const item = ofertaParaSalvar(id);
  if (!item) return;
  salvarItem(prefs, item, FAVORITOS);
  salvar();
  redesenharTudo();
  avisar('Salvo nos favoritos.', 'P\xF4r em outra lista', () => abrirListasDoItem(id));
}

function redesenharTudo() {
  atualizarContadorSalvos();
  if (busca.q && !busca.carregando) desenhar();
  if (detalhe) desenharDetalhe();
  if ($('#dlg-salvos').open) desenharSalvos();
  if ($('#dlg-listas').open) desenharListasDoItem();
}

function abrirSalvos(lista) {
  if (lista) listaAberta = lista;
  if (!prefs.listas.some((l) => l.id === listaAberta)) listaAberta = FAVORITOS;
  editandoLista = null;
  apagandoLista = null;
  desenharSalvos();
  abrirDialogo('#dlg-salvos');
}

function desenharSalvos() {
  const lista = prefs.listas.find((l) => l.id === listaAberta) || prefs.listas[0];
  const itens = itensDaLista(prefs, lista.id);
  const abas = prefs.listas
    .map(
      (l) => \`<button type="button" class="aba\${l.id === lista.id ? ' ativa' : ''}" data-acao="aba-lista" data-lista="\${esc(l.id)}" aria-pressed="\${l.id === lista.id}">
        \${l.id === FAVORITOS ? SVG_CORACAO(true) : ''}\${esc(l.nome)}<span class="n">\${contarLista(prefs, l.id)}</span></button>\`
    )
    .join('');
  const cabecaLista =
    editandoLista === lista.id
      ? \`<form class="form-lista" data-form="renomear-lista" data-lista="\${esc(lista.id)}">
          <label class="sr" for="nome-lista">Nome da lista</label>
          <input id="nome-lista" name="nome" value="\${esc(lista.nome)}" maxlength="40" autocomplete="off">
          <button type="submit" class="botao">Salvar</button>
          <button type="button" class="link" data-acao="cancelar-lista">Cancelar</button></form>\`
      : apagandoLista === lista.id
        ? \`<div class="confirma"><span>Apagar a lista \u201C\${esc(lista.nome)}\u201D? Os itens que s\xF3 est\xE3o nela deixam de ficar salvos.</span>
            <button type="button" class="botao perigo" data-acao="apagar-lista-sim" data-lista="\${esc(lista.id)}">Apagar</button>
            <button type="button" class="link" data-acao="cancelar-lista">Cancelar</button></div>\`
        : \`<div class="lista-cabeca">
            <div><h3>\${esc(lista.nome)}</h3><span class="nd">\${itens.length} \${itens.length === 1 ? 'item' : 'itens'}\${itens.length ? \` \xB7 total \${brl(totalDaLista(prefs, lista.id))}\` : ''}</span></div>
            \${lista.id === FAVORITOS ? '' : \`<div class="lista-acoes"><button type="button" class="link" data-acao="renomear-lista" data-lista="\${esc(lista.id)}">Renomear</button>
              <button type="button" class="link perigo" data-acao="apagar-lista" data-lista="\${esc(lista.id)}">Apagar</button></div>\`}
          </div>\`;

  const linhas = itens.length
    ? \`<ul class="salvos">\${itens
        .map((sv) => {
          const i = sv.item;
          const d = variacao(sv);
          const quando = new Date(sv.salvoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
          const link = linkSeguro(i.link);
          return \`<li data-id="\${esc(i.id)}">
            <img class="sv-foto" src="\${esc(i.foto || fotoReserva)}" alt="" loading="lazy" referrerpolicy="no-referrer">
            <div class="sv-info">
              <span class="sv-loja">\${avatarLoja(i.loja, i.lojaIcone, 'mini')}\${esc(i.loja)}</span>
              <span class="sv-titulo">\${esc(i.titulo)}</span>
              <span class="sv-precos"><strong>\${brl(sv.ultimoPreco ?? sv.precoSalvo)}</strong>
                \${Math.abs(d) >= 0.01 ? \`<span class="variacao \${d < 0 ? 'caiu' : 'subiu'}">\${d < 0 ? '\u25BC' : '\u25B2'} \${brl(Math.abs(d))}</span>\` : ''}
                <span class="nd">salvo por \${brl(sv.precoSalvo)} em \${esc(quando)}</span></span>
              <div class="sv-acoes">
                <div class="qtd" role="group" aria-label="Quantidade">
                  <button type="button" data-acao="qtd-menos" aria-label="Diminuir">\u2212</button><span>\${sv.qtd || 1}</span><button type="button" data-acao="qtd-mais" aria-label="Aumentar">+</button>
                </div>
                <button type="button" class="link mini" data-acao="buscar-salvo">Ver pre\xE7os de hoje</button>
                \${link ? \`<a class="link mini" href="\${esc(link)}" target="_blank" rel="noopener noreferrer">Ir \xE0 loja \u2197</a>\` : ''}
                <button type="button" class="link mini" data-acao="escolher-listas">Listas</button>
                <button type="button" class="link mini perigo" data-acao="tirar-da-lista" data-lista="\${esc(lista.id)}">Tirar</button>
              </div>
            </div>
          </li>\`;
        })
        .join('')}</ul>\`
    : \`<div class="vazio-salvos">\${SVG_CORACAO(false)}<p>\${lista.id === FAVORITOS ? 'Toque no cora\xE7\xE3o de um produto para salvar aqui.' : 'Abra um produto e use \u201CSalvar em lista\u2026\u201D para trazer para c\xE1.'}</p></div>\`;

  $('#dlg-salvos').innerHTML = \`<div class="dlg-cabeca"><h2>Meus salvos</h2><button type="button" class="fechar" data-acao="fechar-dialogo" aria-label="Fechar">\xD7</button></div>
    <div class="abas">\${abas}
      <form class="nova-lista" data-form="nova-lista"><label class="sr" for="nova-lista">Nova lista</label>
        <input id="nova-lista" name="nome" placeholder="+ Nova lista" maxlength="40" autocomplete="off"></form>
    </div>
    <div class="salvos-corpo">\${cabecaLista}\${linhas}</div>
    <p class="nota-tabela">Seus salvos ficam guardados neste aparelho. Com a conta (em breve), eles v\xE3o aparecer em qualquer aparelho.</p>\`;
  if (editandoLista) $('#nome-lista')?.select();
}

// ---------------------------------------------------------------------------
// Conta
// ---------------------------------------------------------------------------

let apagandoConta = false;

const SVG_GOOGLE = \`<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>\`;

function abrirPainelConta(abrir) {
  $('#painel-conta').hidden = !abrir;
  $('#botao-conta').setAttribute('aria-expanded', String(abrir));
  if (!abrir) apagandoConta = false;
  if (abrir) desenharConta();
}

function fotoDoUsuario(u, classe) {
  const letra = esc((u?.nome || u?.email || '?').trim()[0]?.toUpperCase() || '?');
  return \`<span class="\${classe}" aria-hidden="true">\${letra}\${u?.foto ? \`<img class="logo" src="\${esc(u.foto)}" alt="" referrerpolicy="no-referrer">\` : ''}</span>\`;
}

function desenharConta() {
  if (!conta) return;
  const e = conta.estado;
  const u = e.sessao ? e.usuario : null;
  const botao = $('#botao-conta');
  botao.innerHTML = u
    ? \`\${fotoDoUsuario(u, 'bolinha foto')}<span class="rotulo-conta">\${esc((u.nome || 'Minha conta').split(' ')[0])}</span>\${e.situacao === 'sincronizando' ? '<span class="girando" aria-hidden="true"></span>' : ''}\`
    : \`<span class="bolinha" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="5.5" r="3" fill="currentColor"/><path d="M2 15c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5z" fill="currentColor"/></svg></span><span class="rotulo-conta">Entrar</span>\`;
  botao.setAttribute('aria-label', u ? \`Conta de \${u.nome || u.email}\` : 'Entrar na conta');
  if ($('#painel-conta').hidden) return;

  const nSalvos = Object.keys(prefs.salvos).length;
  const hora = e.ultimaSinc ? e.ultimaSinc.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  const situacao = {
    sincronizando: ['girando', 'Sincronizando\u2026'],
    sincronizado: ['ok', \`Sincronizado\${hora ? \` \xE0s \${hora}\` : ''}\`],
    offline: ['alerta', 'Sem internet: est\xE1 tudo guardado no aparelho e vai para a conta quando a conex\xE3o voltar'],
    erro: ['alerta', 'N\xE3o deu para sincronizar agora'],
    parado: ['ok', 'Conectado'],
  }[e.situacao] || ['ok', 'Conectado'];

  $('#painel-conta').innerHTML = u
    ? \`<div class="conta-cabeca">\${fotoDoUsuario(u, 'conta-foto')}<div><strong>\${esc(u.nome || 'Sua conta')}</strong><span>\${esc(u.email || '')}</span></div>
        <button type="button" class="fechar" data-acao="fechar-conta" aria-label="Fechar">\xD7</button></div>
      <p class="sinc"><span class="ponto \${situacao[0]}" aria-hidden="true"></span>\${esc(situacao[1])}\${e.situacao === 'erro' || e.situacao === 'offline' ? ' \xB7 <button type="button" class="link mini" data-acao="sincronizar-agora">tentar de novo</button>' : ''}</p>
      <p>Seus \${nSalvos} salvo\${nSalvos === 1 ? '' : 's'}, listas e prefer\xEAncias aparecem em qualquer aparelho em que voc\xEA entrar com esta conta.</p>
      \${
        apagandoConta
          ? \`<div class="confirma"><span>Apagar sua conta? Isso apaga da conta seus salvos e listas para sempre. O que est\xE1 neste aparelho continua aqui.</span>
              <button type="button" class="botao perigo" data-acao="apagar-conta-sim">Apagar conta</button>
              <button type="button" class="link" data-acao="cancelar-apagar-conta">Cancelar</button></div>\`
          : \`<div class="conta-acoes"><button type="button" class="botao-sec" data-acao="sair-conta">Sair</button>
              <button type="button" class="link perigo" data-acao="apagar-conta">Apagar minha conta</button></div>\`
      }
      <a class="link mini" href="privacidade.html" target="_blank" rel="noopener">Pol\xEDtica de privacidade</a>\`
    : \`<div class="conta-cabeca"><div><strong>Leve seus salvos para qualquer aparelho</strong></div>
        <button type="button" class="fechar" data-acao="fechar-conta" aria-label="Fechar">\xD7</button></div>
      <p>Hoje seus favoritos, listas e prefer\xEAncias ficam s\xF3 neste aparelho. Entre com o Google e eles aparecem no celular e no computador, sem perder o que j\xE1 est\xE1 aqui.</p>
      <button type="button" class="botao-google" data-acao="entrar-google">\${SVG_GOOGLE}Entrar com Google</button>
      \${e.disponivel ? '' : '<p class="nd">Na demonstra\xE7\xE3o a conta n\xE3o funciona; use a vers\xE3o publicada do app.</p>'}
      <p class="nota-conta">Usamos s\xF3 seu nome, e-mail e foto. Nada do seu Gmail ou Drive. <a href="privacidade.html" target="_blank" rel="noopener">Pol\xEDtica de privacidade</a></p>\`;
}

function abrirListasDoItem(id) {
  itemDasListas = id;
  desenharListasDoItem();
  abrirDialogo('#dlg-listas');
}

function desenharListasDoItem() {
  const item = ofertaParaSalvar(itemDasListas);
  if (!item) return;
  const sv = prefs.salvos[item.id];
  $('#dlg-listas').innerHTML = \`<div class="dlg-cabeca"><h2>Salvar em lista</h2><button type="button" class="fechar" data-acao="fechar-listas" aria-label="Fechar">\xD7</button></div>
    <p class="dl-produto">\${esc(item.titulo)}</p>
    <div class="dl-listas">\${prefs.listas
      .map(
        (l) => \`<label class="dl-opcao"><input type="checkbox" data-alternar-lista="\${esc(l.id)}" \${sv?.listas.includes(l.id) ? 'checked' : ''}>
          <span>\${esc(l.nome)}</span><span class="nd">\${contarLista(prefs, l.id)}</span></label>\`
      )
      .join('')}</div>
    <form class="form-lista" data-form="nova-lista-item"><label class="sr" for="nova-lista-item">Nome da nova lista</label>
      <input id="nova-lista-item" name="nome" placeholder="Nova lista, ex.: Compras do m\xEAs" maxlength="40" autocomplete="off">
      <button type="submit" class="botao">Criar e salvar</button></form>
    <div class="dl-rodape"><button type="button" class="botao-sec" data-acao="fechar-listas">Pronto</button></div>\`;
}

function iniciar() {
  // CEP: digitado uma vez, lembrado; mudar o CEP refaz a busca
  const campoCep = $('#cep');
  const formatarCep = (v) => {
    const d = String(v).replace(/\\D/g, '').slice(0, 8);
    return d.length > 5 ? \`\${d.slice(0, 5)}-\${d.slice(5)}\` : d;
  };
  campoCep.value = formatarCep(prefs.cep);
  campoCep.addEventListener('input', () => (campoCep.value = formatarCep(campoCep.value)));
  const guardarCep = () => {
    const d = campoCep.value.replace(/\\D/g, '');
    if (d.length !== 8 && d.length !== 0) return false;
    const mudou = d !== prefs.cep;
    prefs.cep = d;
    salvar();
    return mudou;
  };
  campoCep.addEventListener('change', () => {
    if (guardarCep() && busca.q && !busca.carregando) executarBusca(busca.q);
  });

  const caixa = $('#form-busca');
  caixa.addEventListener('focusin', () => caixa.classList.add('expandida'));
  document.addEventListener('pointerdown', (ev) => {
    if (!ev.target.closest('#form-busca')) caixa.classList.remove('expandida');
  });

  caixa.addEventListener('submit', (ev) => {
    ev.preventDefault();
    guardarCep();
    caixa.classList.remove('expandida');
    document.activeElement?.blur?.();
    executarBusca($('#q').value || busca.q);
  });

  // Menu de ordena\xE7\xE3o: fecha ao clicar fora ou com Esc
  document.addEventListener('click', (ev) => {
    if (!$('#menu-ordem').hidden && !ev.target.closest('.ordenar-menu')) abrirOrdem(false);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !$('#menu-ordem').hidden) {
      abrirOrdem(false);
      $('#botao-ordem').focus();
    }
  });
  $('#sugestoes').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-q]');
    if (!b) return;
    $('#q').value = b.dataset.q;
    executarBusca(b.dataset.q);
  });
  document.addEventListener('click', aoClicar);
  document.addEventListener('change', aoMudar);
  document.addEventListener('input', (ev) => ev.target.dataset?.filtroPreco && aoMudar(ev));
  document.addEventListener('submit', aoEnviar);
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('close', () => {
      if (d.id === 'dlg-detalhe') detalhe = null;
    });
    d.addEventListener('click', (ev) => ev.target === d && fecharDialogos()); // clique fora fecha
  }
  document.addEventListener('keydown', (ev) => ev.key === 'Escape' && document.body.classList.remove('filtros-abertos'));

  // Foto que n\xE3o carrega vira ilustra\xE7\xE3o; \xEDcone de loja que n\xE3o carrega some e fica a inicial
  document.addEventListener(
    'error',
    (ev) => {
      const img = ev.target;
      if (img.tagName !== 'IMG') return;
      if (img.classList.contains('logo')) img.remove();
      else if (img.src !== fotoReserva) img.src = fotoReserva;
    },
    true
  );

  atualizarContadorSalvos();

  // Conta: entrar com Google e sincronizar
  ultimoSinc = JSON.stringify(conteudoSinc());
  conta = criarConta({
    lerConteudo: conteudoSinc,
    aplicarConteudo: (c) => {
      for (const k of CAMPOS_SINC) if (c[k] !== undefined) prefs[k] = c[k];
      garantirSalvos(prefs);
      ultimoSinc = JSON.stringify(conteudoSinc());
      gravarLocal();
      $('#cep').value = prefs.cep ? \`\${prefs.cep.slice(0, 5)}-\${prefs.cep.slice(5)}\` : '';
      redesenharTudo();
    },
    aoMudar: () => desenharConta(),
    avisar,
  });
  $('#botao-conta').addEventListener('click', () => abrirPainelConta($('#painel-conta').hidden));
  document.addEventListener('click', (ev) => {
    // composedPath: o bot\xE3o pode ter sido redesenhado durante o clique
    const dentro = ev.composedPath().some((el) => el.id === 'painel-conta' || el.id === 'botao-conta');
    if (!$('#painel-conta').hidden && !dentro) abrirPainelConta(false);
  });
  conta.iniciar();

  const inicial = prefs.ultimaBusca || (modoDemo() ? 'sabonete l\xEDquido' : '');
  if (inicial) {
    $('#q').value = inicial;
    executarBusca(inicial);
  }
}

iniciar();

return {  };
})();
})();
<\/script>
</body>
</html>
`;

// app/privacidade.html
var privacidade_default = '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Privacidade \xB7 Minhas Compras</title>\n<link rel="icon" href="assets/logo.svg" type="image/svg+xml">\n<style>\n:root { --bg: #f5f6fa; --surface: #ffffff; --ink: #14161f; --muted: #5b6275; --line: rgba(18, 20, 28, 0.09); --accent: #6d4cff; }\n@media (prefers-color-scheme: dark) { :root { --bg: #0a0b10; --surface: #12141c; --ink: #eef0f6; --muted: #9aa0b4; --line: rgba(255, 255, 255, 0.09); --accent: #9b85ff; color-scheme: dark; } }\nbody { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif; }\nmain { max-width: 720px; margin: 0 auto; padding: 32px max(16px, env(safe-area-inset-left, 0px)) 64px; }\na { color: var(--accent); }\nh1 { font-size: 30px; line-height: 1.15; margin: 8px 0 4px; }\nh2 { font-size: 19px; margin: 28px 0 6px; }\n.data { color: var(--muted); margin: 0 0 20px; }\n.caixa { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; }\nul { padding-left: 20px; }\nli { margin: 4px 0; }\n.voltar { display: inline-block; margin-bottom: 8px; font-weight: 700; text-decoration: none; }\n</style>\n</head>\n<body>\n<main>\n  <a class="voltar" href="./">\u2190 Voltar ao Minhas Compras</a>\n  <h1>Pol\xEDtica de privacidade</h1>\n  <p class="data">Atualizada em 16 de outubro de 2026</p>\n\n  <div class="caixa">\n    <p><strong>Resumo:</strong> o Minhas Compras funciona sem conta. Se voc\xEA entrar com o Google, guardamos s\xF3 o seu nome, e-mail, foto do perfil e o que voc\xEA salvou no app (favoritos, listas e prefer\xEAncias), para que apare\xE7am em qualquer aparelho. N\xE3o vendemos nem compartilhamos seus dados, e voc\xEA pode apagar tudo a qualquer momento pelo bot\xE3o \u201CApagar minha conta\u201D.</p>\n  </div>\n\n  <h2>O que o app faz</h2>\n  <p>O Minhas Compras compara ofertas de produtos em v\xE1rias lojas, somando frete e descontos, para ajudar voc\xEA a escolher onde comprar. O app n\xE3o vende produtos: as compras s\xE3o feitas nas pr\xF3prias lojas.</p>\n\n  <h2>Usando sem conta</h2>\n  <ul>\n    <li>Favoritos, listas, CEP e prefer\xEAncias ficam guardados <strong>s\xF3 no seu aparelho</strong> (no armazenamento do navegador).</li>\n    <li>Quando voc\xEA busca, o texto da busca e o CEP s\xE3o enviados ao nosso servidor para consultar os pre\xE7os. O CEP \xE9 usado s\xF3 para descobrir sua cidade e estimar o frete, e a busca fica guardada por algumas horas para n\xE3o repetir a mesma consulta.</li>\n    <li>As buscas de pre\xE7o s\xE3o feitas no Google Shopping por meio do servi\xE7o SerpApi.</li>\n  </ul>\n\n  <h2>Usando com conta (entrar com o Google)</h2>\n  <ul>\n    <li>Recebemos do Google apenas: <strong>nome, e-mail e foto do perfil</strong>. N\xE3o temos acesso ao seu Gmail, Drive, contatos ou outros dados da sua conta Google.</li>\n    <li>Guardamos o que voc\xEA salva no app: favoritos, listas, quantidades, pre\xE7os de quando salvou e prefer\xEAncias (como o CEP).</li>\n    <li>Para manter voc\xEA conectado, o app guarda um c\xF3digo de sess\xE3o no seu aparelho. Ele vale por at\xE9 90 dias e \xE9 apagado quando voc\xEA sai da conta.</li>\n  </ul>\n\n  <h2>Para que usamos</h2>\n  <ul>\n    <li>Identificar voc\xEA e mostrar seus salvos em qualquer aparelho.</li>\n    <li>Nada de propaganda direcionada, nada de venda ou troca de dados com terceiros.</li>\n  </ul>\n\n  <h2>Onde ficam guardados</h2>\n  <p>No banco de dados do app, hospedado na Cloudflare, e numa c\xF3pia no seu aparelho. As conex\xF5es s\xE3o sempre criptografadas (HTTPS).</p>\n\n  <h2>Por quanto tempo</h2>\n  <p>Enquanto a sua conta existir. Ao apagar a conta, apagamos na hora seu nome, e-mail, foto, salvos e sess\xF5es.</p>\n\n  <h2>Seus direitos (LGPD)</h2>\n  <ul>\n    <li><strong>Ver e corrigir:</strong> tudo o que guardamos aparece no pr\xF3prio app, em \u201CMeus salvos\u201D e no menu da conta.</li>\n    <li><strong>Apagar:</strong> no app, abra o menu da conta e toque em \u201CApagar minha conta\u201D.</li>\n    <li><strong>Sair a qualquer momento:</strong> \u201CSair\u201D desconecta o aparelho; seus salvos continuam na conta.</li>\n    <li>Para qualquer outro pedido sobre seus dados, escreva para o e-mail de suporte que aparece na tela de entrada do Google.</li>\n  </ul>\n\n  <h2>Links para lojas</h2>\n  <p>Ao tocar em \u201CIr \xE0 loja\u201D, voc\xEA \xE9 levado ao site da loja, que tem a pr\xF3pria pol\xEDtica de privacidade.</p>\n</main>\n</body>\n</html>\n';

// app/assets/logo.svg
var logo_default = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">\n  <!-- Minhas Compras: a etiqueta de pre\xE7o com o "certo" da melhor compra.\n       Mesma fam\xEDlia do Minhas Entregas e do Meus Investimentos: fundo escuro e o gradiente violeta \u2192 ciano. -->\n  <defs>\n    <linearGradient id="g" x1="110" y1="400" x2="420" y2="110" gradientUnits="userSpaceOnUse">\n      <stop offset="0" stop-color="#7c5cff"/>\n      <stop offset="1" stop-color="#22d3ee"/>\n    </linearGradient>\n    <radialGradient id="brilho" cx="0.2" cy="0.1" r="0.9">\n      <stop offset="0" stop-color="#2a2160"/>\n      <stop offset="1" stop-color="#0a0b10"/>\n    </radialGradient>\n  </defs>\n  <rect width="512" height="512" rx="116" fill="url(#brilho)"/>\n  <g transform="translate(256 262) rotate(-45)">\n    <path d="M-150 -92 a26 26 0 0 1 26 -26 h190 a26 26 0 0 1 18 7.5 l78 78 a26 26 0 0 1 0 37 l-78 78 a26 26 0 0 1 -18 7.5 h-190 a26 26 0 0 1 -26 -26 z" fill="url(#g)"/>\n    <circle cx="96" cy="0" r="17" fill="#0a0b10"/>\n  </g>\n  <path d="M170 276L212 318L290 240" fill="none" stroke="#0a0b10" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>\n</svg>\n';

// worker/src/pronto.js
var PAGINAS = {
  "/": [minhas_compras_default, "text/html; charset=utf-8"],
  "/index.html": [minhas_compras_default, "text/html; charset=utf-8"],
  "/privacidade.html": [privacidade_default, "text/html; charset=utf-8"],
  "/assets/logo.svg": [logo_default, "image/svg+xml"]
};
var pronto_default = {
  fetch(req, env, ctx) {
    const url = new URL(req.url);
    const pagina = !env.ASSETS && (req.method === "GET" || req.method === "HEAD") && PAGINAS[url.pathname];
    if (pagina) {
      return new Response(req.method === "HEAD" ? null : pagina[0], {
        headers: { "content-type": pagina[1], "cache-control": "public, max-age=300" }
      });
    }
    return src_default.fetch(req, env, ctx);
  }
};
export {
  pronto_default as default
};
