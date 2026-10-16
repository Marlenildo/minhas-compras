// Favoritos e listas, guardados no aparelho. Funções puras sobre o objeto de preferências:
// prefs.salvos = { [id]: { item, listas: [ids], salvoEm, precoSalvo, totalSalvo, ultimoPreco, vistoEm, qtd } }
// prefs.listas = [{ id, nome }]  (a primeira é sempre "Favoritos")

export const FAVORITOS = 'favoritos';
const LIMITE_FOTO = 30000; // fotos embutidas muito grandes não vão para o armazenamento

export function garantirSalvos(prefs) {
  if (!prefs.salvos || typeof prefs.salvos !== 'object') prefs.salvos = {};
  if (!prefs.apagados || typeof prefs.apagados !== 'object') prefs.apagados = {};
  if (!Array.isArray(prefs.listas) || !prefs.listas.length) prefs.listas = [{ id: FAVORITOS, nome: 'Favoritos' }];
  if (!prefs.listas.some((l) => l.id === FAVORITOS)) prefs.listas.unshift({ id: FAVORITOS, nome: 'Favoritos' });
  return prefs;
}

/** O que guardamos de uma oferta: o suficiente para mostrar e voltar à loja. */
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

export const estaSalvo = (prefs, id) => Boolean(prefs.salvos?.[id]);

/** Salva (ou acrescenta numa lista). Não mexe no preço de quando foi salvo. */
export function salvarItem(prefs, item, listaId = FAVORITOS, agora = new Date().toISOString()) {
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
export function tirarDaLista(prefs, id, listaId) {
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

/** Lembra que foi apagado, para outro aparelho não trazer de volta ao juntar. */
function marcarApagado(prefs, id, quando = new Date().toISOString()) {
  (prefs.apagados ||= {})[id] = quando;
}

export function removerSalvo(prefs, id) {
  const s = prefs.salvos?.[id];
  if (s) {
    delete prefs.salvos[id];
    marcarApagado(prefs, id);
  }
  return s || null;
}

/** Desfaz uma remoção. */
export function restaurarSalvo(prefs, id, registro) {
  if (!registro) return;
  prefs.salvos[id] = registro;
  delete prefs.apagados?.[id];
}

export function alternarLista(prefs, item, listaId) {
  const s = prefs.salvos?.[item.id];
  if (s && s.listas.includes(listaId)) tirarDaLista(prefs, item.id, listaId);
  else salvarItem(prefs, item, listaId);
}

export function criarLista(prefs, nome) {
  garantirSalvos(prefs);
  const limpo = String(nome || '').trim().slice(0, 40);
  if (!limpo) return null;
  const existente = prefs.listas.find((l) => l.nome.toLowerCase() === limpo.toLowerCase());
  if (existente) return existente.id;
  const id = `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  prefs.listas.push({ id, nome: limpo });
  return id;
}

export function renomearLista(prefs, id, nome) {
  const l = prefs.listas?.find((x) => x.id === id);
  const limpo = String(nome || '').trim().slice(0, 40);
  if (l && limpo) l.nome = limpo;
}

/** Apaga a lista (menos Favoritos); itens que só estavam nela deixam de estar salvos. */
export function apagarLista(prefs, id) {
  if (id === FAVORITOS) return;
  prefs.listas = (prefs.listas || []).filter((l) => l.id !== id);
  for (const k of Object.keys(prefs.salvos || {})) tirarDaLista(prefs, k, id);
}

export function itensDaLista(prefs, listaId) {
  return Object.values(prefs.salvos || {})
    .filter((s) => s.listas.includes(listaId))
    .sort((a, b) => String(b.salvoEm).localeCompare(String(a.salvoEm)));
}

export function contarLista(prefs, listaId) {
  return Object.values(prefs.salvos || {}).filter((s) => s.listas.includes(listaId)).length;
}

/** Total da lista com as quantidades, usando o preço mais recente visto. */
export function totalDaLista(prefs, listaId) {
  return itensDaLista(prefs, listaId).reduce((t, s) => t + (s.ultimoPreco ?? s.precoSalvo) * (s.qtd || 1), 0);
}

export function mudarQuantidade(prefs, id, delta) {
  const s = prefs.salvos?.[id];
  if (s) s.qtd = Math.max(1, Math.min(99, (s.qtd || 1) + delta));
}

/** Quando uma oferta salva aparece numa busca, guarda o preço novo (o salvo continua o mesmo). */
export function registrarPrecosVistos(prefs, itens, agora = new Date().toISOString()) {
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

/** Diferença entre o último preço visto e o de quando salvou (negativo = caiu). */
export function variacao(s) {
  if (!s || s.ultimoPreco == null || s.precoSalvo == null) return 0;
  return Math.round((s.ultimoPreco - s.precoSalvo) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Juntar o que está no aparelho com o que está na conta
// ---------------------------------------------------------------------------

const DIAS_LEMBRAR_APAGADO = 90;
const maisNovo = (a, b) => (String(a || '') > String(b || '') ? a : b);
const maisVelho = (a, b) => (!a ? b : !b ? a : String(a) < String(b) ? a : b);

/**
 * Junta dois conteúdos (aparelho e conta) sem perder nada:
 * - salvos dos dois lados; o mesmo item fica com a data e o preço de quando foi salvo primeiro,
 *   as listas dos dois, a maior quantidade e o preço visto mais recente;
 * - o que foi apagado (de qualquer lado) depois de salvo não volta;
 * - listas dos dois lados (mesmo nome vira uma lista só);
 * - preferências: as do aparelho (mais recentes) por cima.
 */
export function juntarConteudo(local = {}, remoto = {}, agora = new Date()) {
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
    // Apagado depois de ter sido salvo (pela última vez): fica apagado
    const ultimoSalvo = maisNovo(a?.salvoEm, b?.salvoEm);
    if (apagados[id] && apagados[id] >= ultimoSalvo) continue;
    delete apagados[id];
    salvos[id] = juntos;
  }

  return { ...r, ...l, listas, salvos, apagados };
}
