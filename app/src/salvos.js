// Favoritos e listas, guardados no aparelho. Funções puras sobre o objeto de preferências:
// prefs.salvos = { [id]: { item, listas: [ids], salvoEm, precoSalvo, totalSalvo, ultimoPreco, vistoEm, qtd } }
// prefs.listas = [{ id, nome }]  (a primeira é sempre "Favoritos")

export const FAVORITOS = 'favoritos';
const LIMITE_FOTO = 30000; // fotos embutidas muito grandes não vão para o armazenamento

export function garantirSalvos(prefs) {
  if (!prefs.salvos || typeof prefs.salvos !== 'object') prefs.salvos = {};
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
    return s;
  }
  return null;
}

export function removerSalvo(prefs, id) {
  const s = prefs.salvos?.[id];
  if (s) delete prefs.salvos[id];
  return s || null;
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
