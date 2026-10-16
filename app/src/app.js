import { UNIDADES, lerNumero, lerTitulo, grupoDaOferta, quantidadeDoAnuncio, precoExibido } from './core.js';
import { buscarProdutos, buscarLojas, modoDemo } from './fontes.js';
import { fotoReserva } from './demo.js';
import { eRelevante, parecenca, buscaParecida, LIMIAR_PARECIDO } from './relevancia.js';
import { montarFacetas, passaNasFacetas } from './facetas.js';
import {
  FAVORITOS, garantirSalvos, salvarItem, estaSalvo, removerSalvo, tirarDaLista, alternarLista, criarLista, renomearLista,
  apagarLista, itensDaLista, contarLista, totalDaLista, mudarQuantidade, registrarPrecosVistos, variacao, restaurarSalvo,
} from './salvos.js';
import { criarConta } from './conta.js';

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
let apagandoLista = null; // id da lista esperando confirmação para apagar
let itemDasListas = null; // oferta aberta em "Salvar em lista"

function gravarLocal() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(prefs));
  } catch (_) {
    /* o app funciona sem lembrar */
  }
}

// O que vai para a conta (a última busca, por exemplo, fica só no aparelho)
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
  relevantes: true, // só o que combina com a busca
  facetas: {}, // grupo → Set(valores): marca, tamanho, cor...
  parecidosCom: null, // { id, titulo }
});
const chaveBusca = (q) => String(q).trim().toLowerCase().replace(/\s+/g, ' ');
let filtros = FILTROS_VAZIOS();
const comparar = new Set();
const MAX_COMPARAR = 4;
let detalhe = null; // { item, carregando, erro, dados, editandoTamanho }
let editandoFreteId = null; // cartão com o campo de frete aberto
const gruposAbertos = new Set(); // grupos de filtro com todas as opções à mostra

// ---------------------------------------------------------------------------
// Formatação
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

/** Preço com centavos menores: R$ 21<sup>,90</sup> */
function precoGrande(v, classe = '') {
  const c = Math.round(v * 100);
  const inteiro = Math.floor(c / 100).toLocaleString('pt-BR');
  const cent = String(c % 100).padStart(2, '0');
  return `<span class="valor ${classe}" aria-label="${esc(brl(v))}"><span class="rs">R$</span><span class="int">${inteiro}</span><span class="cent">,${cent}</span></span>`;
}

function fmtQtd(base, grupo) {
  if (grupo === 'volume') return base >= 1000 ? `${num(base / 1000)} L` : `${num(base)} ml`;
  if (grupo === 'massa') return base >= 1000 ? `${num(base / 1000)} kg` : `${num(base)} g`;
  if (grupo === 'comprimento') return `${num(base)} m`;
  return `${num(base)} un`;
}

function estrelas(nota, qtd) {
  if (!(nota > 0)) return '';
  return `<span class="nota" title="${esc(`${num(nota, 1)} de 5${qtd ? `, ${qtd.toLocaleString('pt-BR')} avaliações` : ''}`)}">
    <svg width="13" height="13" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9z" fill="currentColor"/></svg>
    ${num(nota, 1)}${qtd ? `<span class="qtd-av">(${qtd.toLocaleString('pt-BR')})</span>` : ''}</span>`;
}

// Ícones das lojas: o da fonte; senão o favicon do site conhecido; senão a inicial colorida
const DOMINIOS = {
  amazon: 'amazon.com.br', 'mercado livre': 'mercadolivre.com.br', mercadolivre: 'mercadolivre.com.br', magalu: 'magazineluiza.com.br',
  'magazine luiza': 'magazineluiza.com.br', 'casas bahia': 'casasbahia.com.br', shopee: 'shopee.com.br', kabum: 'kabum.com.br',
  carrefour: 'carrefour.com.br', drogasil: 'drogasil.com.br', 'droga raia': 'drogaraia.com.br', 'fast shop': 'fastshop.com.br',
  americanas: 'americanas.com.br', 'ponto': 'pontofrio.com.br', extra: 'extra.com.br', 'pague menos': 'paguemenos.com.br',
  'drogaria são paulo': 'drogariasaopaulo.com.br', netshoes: 'netshoes.com.br', centauro: 'centauro.com.br', 'leroy merlin': 'leroymerlin.com.br',
  madeiramadeira: 'madeiramadeira.com.br', 'assaí': 'assai.com.br', 'atacadão': 'atacadao.com.br', 'pão de açúcar': 'paodeacucar.com',
  aliexpress: 'aliexpress.com', shein: 'shein.com', samsung: 'samsung.com', apple: 'apple.com', dell: 'dell.com', 'girafa': 'girafa.com.br',
};
function iconeDaLoja(nome, icone) {
  if (icone) return icone;
  if (modoDemo()) return null;
  const n = String(nome || '').toLowerCase();
  const chave = Object.keys(DOMINIOS).find((k) => n.includes(k));
  return chave ? `https://www.google.com/s2/favicons?domain=${DOMINIOS[chave]}&sz=64` : null;
}
function avatarLoja(nome, icone, tamanho = '') {
  let h = 0;
  for (const ch of String(nome)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const letra = (String(nome).trim()[0] || '?').toUpperCase();
  const src = iconeDaLoja(nome, icone);
  return `<span class="avatar ${tamanho}" style="--h:${h}" aria-hidden="true">${esc(letra)}${
    src ? `<img class="logo" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''
  }</span>`;
}

// ---------------------------------------------------------------------------
// Cálculo
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

  // Quantas ofertas cada opção traria, mantendo os filtros dos outros grupos
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
// Pedaços da tela
// ---------------------------------------------------------------------------

const foto = (i, classe = 'foto') => `<img class="${classe}" src="${esc(i.foto || fotoReserva)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;

function linhaFrete(i) {
  const seu = i.freteDeVoce ? ' <span class="seu">(informado por você)</span>' : '';
  const alterar = i.freteDeVoce ? ' <button type="button" class="link mini" data-acao="informar-frete">alterar</button>' : '';
  if (i.frete === 0) return `<span class="frete bom">Frete grátis${seu}${alterar}</span>`;
  if (i.frete == null) return '<span class="frete">Frete a calcular · <button type="button" class="link mini" data-acao="informar-frete">informar</button></span>';
  return `<span class="frete">+ ${brl(i.frete)} de frete${seu}${alterar} · <strong>total ${brl(i.total)}</strong></span>`;
}

function formFrete(i) {
  const v = typeof prefs.fretes[i.id] === 'number' ? String(prefs.fretes[i.id]).replace('.', ',') : '';
  return `<form class="form-frete" data-form="frete" data-id="${esc(i.id)}">
    <label class="sr" for="fr-${esc(i.id)}">Frete em reais</label><span aria-hidden="true">R$</span>
    <input id="fr-${esc(i.id)}" name="frete" inputmode="decimal" placeholder="0 = grátis" value="${esc(v)}" autocomplete="off">
    <button type="submit" class="botao">Usar</button>
    ${v ? '<button type="button" class="link" data-acao="limpar-frete">apagar</button>' : ''}
    <p class="erro-campo" hidden></p>
  </form>`;
}

const SVG_CORACAO = (cheio) =>
  `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.3C1.4 7.8 3.6 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.4 0 5.6 3.3 4.3 6.7-1.8 4.7-9.3 9.3-9.3 9.3z" fill="${cheio ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;

function botaoCoracao(i) {
  const salvo = estaSalvo(prefs, i.id);
  return `<button type="button" class="coracao" data-acao="favoritar" data-id="${esc(i.id)}" aria-pressed="${salvo}" title="${salvo ? 'Tirar dos salvos' : 'Salvar nos favoritos'}" aria-label="${salvo ? 'Tirar dos salvos' : 'Salvar nos favoritos'}">${SVG_CORACAO(salvo)}</button>`;
}

function seloVariacao(i) {
  const sv = prefs.salvos[i.id];
  if (!sv) return '';
  const d = Math.round((i.preco - sv.precoSalvo) * 100) / 100;
  if (Math.abs(d) < 0.01) return '';
  return d < 0
    ? `<span class="variacao caiu">▼ ${brl(-d)} desde que você salvou</span>`
    : `<span class="variacao subiu">▲ ${brl(d)} desde que você salvou</span>`;
}

function htmlCartao(i, c) {
  const selos = [];
  if (c.destaques.preco?.id === i.id) selos.push('<span class="selo verde">Menor preço</span>');
  else if (c.destaques.total?.id === i.id) selos.push('<span class="selo verde">Menor total</span>');
  if (c.destaques.unidade?.id === i.id && c.destaques.preco?.id !== i.id) selos.push(`<span class="selo amarelo">Melhor preço por ${POR[c.grupo]}</span>`);
  const marcado = comparar.has(i.id);
  const unit =
    i.unit != null && c.usaUnidade && i.grupo === c.grupo
      ? `<span class="unit" title="${i.freteConhecido ? 'Inclui o frete' : 'Sem o frete'}">${brl(i.unit)} por ${POR[i.grupo]}</span>`
      : '';
  const direto = i.linkDireto && linkSeguro(i.link);
  return `<article class="cartao${c.destaques.preco?.id === i.id ? ' vencedor' : ''}" data-id="${esc(i.id)}">
    <div class="cartao-foto">
      ${foto(i)}
      <div class="selos">${selos.join('')}</div>
      ${i.desconto >= 0.01 ? `<span class="off">−${Math.round(i.desconto * 100)}%</span>` : ''}
      <button type="button" class="botao-comparar" data-acao="comparar" aria-pressed="${marcado}" title="${marcado ? 'Tirar da comparação' : 'Comparar'}">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">${marcado ? '<path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' : '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg>
        <span>${marcado ? 'Comparando' : 'Comparar'}</span>
      </button>
    </div>
    <div class="cartao-corpo">
      <div class="loja-linha">${avatarLoja(i.loja, i.lojaIcone)}<span class="loja-nome">${esc(i.loja)}</span>${i.fonte === 'manual' ? '<span class="mais">sua oferta</span>' : i.variasLojas ? '<span class="mais">+ lojas</span>' : ''}${botaoCoracao(i)}</div>
      ${seloVariacao(i)}
      <h3 class="titulo" title="${esc(i.titulo)}">${esc(i.titulo)}</h3>
      ${estrelas(i.avaliacao, i.avaliacoes)}
      <div class="preco-bloco">
        <span class="rotulo-preco">Preço na loja</span>
        <div class="preco-linha">${precoGrande(i.preco)}${i.precoOriginal > i.preco ? `<s>${brl(i.precoOriginal)}</s>` : ''}</div>
        ${linhaFrete(i)}
        ${editandoFreteId === i.id ? formFrete(i) : ''}
        ${unit}
      </div>
      <div class="acoes">
        ${i.fonte === 'manual' ? '' : '<button type="button" class="botao" data-acao="detalhe">Ver onde comprar</button>'}
        ${direto ? `<a class="botao-sec" href="${esc(direto)}" target="_blank" rel="noopener noreferrer">Ir à loja ↗</a>` : ''}
        ${i.fonte === 'manual' ? `${linkSeguro(i.link) ? `<a class="botao-sec" href="${esc(linkSeguro(i.link))}" target="_blank" rel="noopener noreferrer">Ir à loja ↗</a>` : ''}<button type="button" class="botao-sec perigo" data-acao="remover-manual">Remover</button>` : ''}
      </div>
      ${i.fonte === 'manual' ? '' : `<button type="button" class="parecidos${c.alvoId === i.id ? ' ativo' : ''}" data-acao="parecidos">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="10" cy="10" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
        ${c.alvoId === i.id ? 'Mostrando parecidos' : 'Só parecidos com este'}</button>`}
    </div>
  </article>`;
}

function htmlDestaques(c) {
  const d = c.destaques;
  const itens = [
    d.preco && ['Menor preço', d.preco, precoGrande(d.preco.preco, 'pequeno'), d.preco.frete === 0 ? 'com frete grátis' : d.preco.frete == null ? 'frete a calcular' : `+ ${brl(d.preco.frete)} de frete`],
    d.total && ['Menor total com frete', d.total, precoGrande(d.total.total, 'pequeno'), `${brl(d.total.preco)} + ${d.total.frete ? brl(d.total.frete) : 'frete grátis'}`],
    d.unidade && [`Melhor preço por ${POR[c.grupo]}`, d.unidade, `${precoGrande(d.unidade.unit, 'pequeno')}<span class="por">/${SIGLA[c.grupo]}</span>`, `${brl(d.unidade.preco)} por ${fmtQtd(d.unidade.qtd, c.grupo)}`],
    d.avaliacao && ['Mais bem avaliado', d.avaliacao, precoGrande(d.avaliacao.preco, 'pequeno'), `${num(d.avaliacao.avaliacao, 1)} ★ · ${d.avaliacao.avaliacoes.toLocaleString('pt-BR')} avaliações`],
  ].filter(Boolean);
  if (!itens.length) return '';
  return `<section class="destaques" aria-label="Destaques">${itens
    .map(
      ([rotulo, i, valor, sub], k) => `<button type="button" class="destaque${k === 0 ? ' principal' : ''}" data-acao="detalhe" data-id="${esc(i.id)}">
        <span class="d-rotulo">${rotulo}</span>
        <span class="d-valor">${valor}</span>
        <span class="d-sub">${esc(sub)}</span>
        <span class="d-loja">${avatarLoja(i.loja, i.lojaIcone, 'mini')}<span>${esc(i.loja)}</span></span>
      </button>`
    )
    .join('')}</section>`;
}

function htmlFiltros(c) {
  const lojas = c.lojas
    .map(
      (l) => `<label class="opcao-loja">
        <input type="checkbox" data-filtro-loja="${esc(l.nome)}" ${filtros.lojas.has(l.nome) ? 'checked' : ''}>
        ${avatarLoja(l.nome, l.icone, 'mini')}
        <span class="ol-nome">${esc(l.nome)}</span>
        <span class="ol-info">${l.n} · ${brl(l.min)}</span>
      </label>`
    )
    .join('');
  const chk = (chave, texto) =>
    `<label class="interruptor"><input type="checkbox" data-filtro="${chave}" ${filtros[chave] ? 'checked' : ''}><span class="trilho" aria-hidden="true"></span>${texto}</label>`;
  return `
    <div class="f-cabeca"><h2>Filtros</h2><button type="button" class="link" data-acao="limpar-filtros">Limpar</button>
      <button type="button" class="fechar-sheet" data-acao="fechar-filtros" aria-label="Fechar filtros">×</button></div>
    ${c.facetas.map((g) => htmlGrupoFaceta(g)).join('')}
    <div class="f-grupo">
      <h3>Lojas</h3>
      <div class="lista-lojas">${lojas}</div>
    </div>
    <div class="f-grupo">
      <h3>Preço na loja</h3>
      <div class="faixa-preco">
        <label><span>De R$</span><input id="f-min" data-filtro-preco="precoMin" inputmode="decimal" placeholder="0" value="${esc(filtros.precoMin)}"></label>
        <label><span>Até R$</span><input id="f-max" data-filtro-preco="precoMax" inputmode="decimal" placeholder="sem limite" value="${esc(filtros.precoMax)}"></label>
      </div>
    </div>
    <div class="f-grupo">
      <h3>Mostrar só</h3>
      ${chk('relevantes', 'O que combina com a busca')}
      ${chk('freteGratis', 'Frete grátis')}
      ${chk('promocao', 'Em promoção')}
      ${chk('avaliacao4', '4 estrelas ou mais')}
      ${c.usaUnidade ? chk('comTamanho', `Com preço por ${POR[c.grupo]}`) : ''}
    </div>
    <div class="f-rodape"><button type="button" class="botao" data-acao="fechar-filtros">Ver ${c.lista.length} oferta${c.lista.length === 1 ? '' : 's'}</button></div>`;
}

const MOSTRAR_OPCOES = 8;

function botaoFaceta(g, o) {
  const marcado = Boolean(filtros.facetas[g.id]?.has(o.valor));
  const vazio = !o.n && !marcado;
  return `<button type="button" class="chip-filtro${vazio ? ' vazio' : ''}" data-acao="faceta" data-faceta="${esc(g.id)}" data-valor="${esc(o.valor)}" aria-pressed="${marcado}"${vazio ? ' aria-disabled="true" title="Nenhuma oferta com os outros filtros escolhidos"' : ''}>${esc(o.rotulo)}<span class="n">${o.n}</span></button>`;
}

function htmlGrupoFaceta(g) {
  const aberto = gruposAbertos.has(g.id);
  const marcadas = filtros.facetas[g.id] || new Set();
  // As marcadas sempre aparecem, mesmo com o grupo recolhido
  const visiveis = aberto ? g.opcoes : g.opcoes.filter((o, k) => k < MOSTRAR_OPCOES || marcadas.has(o.valor));
  const resto = g.opcoes.length - visiveis.length;
  return `<div class="f-grupo">
    <h3>${esc(g.nome)}</h3>
    <div class="chips-filtro">${visiveis.map((o) => botaoFaceta(g, o)).join('')}</div>
    ${resto > 0 || aberto && g.opcoes.length > MOSTRAR_OPCOES ? `<button type="button" class="link mini" data-acao="abrir-grupo" data-faceta="${esc(g.id)}">${aberto ? 'Mostrar menos' : `Ver mais ${resto}`}</button>` : ''}
  </div>`;
}

/** Faixa rápida acima dos resultados: o grupo mais útil (o do Google, ou tamanho, ou características). */
function htmlFaixaRapida(c) {
  const g = c.facetas.find((x) => x.id === 'g0') || c.facetas.find((x) => x.id === 'tamanho') || c.facetas.find((x) => x.id === 'carac') || c.facetas[0];
  if (!g) return '';
  return `<div class="faixa-rapida" role="group" aria-label="${esc(g.nome)}"><span class="fr-nome">${esc(g.nome)}</span>${g.opcoes
    .slice(0, 12)
    .map((o) => botaoFaceta(g, o))
    .join('')}</div>`;
}

function chipsAtivos(cc) {
  const c = [];
  for (const g of cc?.facetas || []) {
    for (const v of filtros.facetas[g.id] || []) {
      const o = g.opcoes.find((x) => x.valor === v);
      c.push([`faceta`, `${g.nome}: ${o ? o.rotulo : v}`, g.id, v]);
    }
  }
  for (const l of filtros.lojas) c.push([`loja:${l}`, l]);
  if (filtros.precoMin) c.push(['precoMin', `De ${brl(lerNumero(filtros.precoMin))}`]);
  if (filtros.precoMax) c.push(['precoMax', `Até ${brl(lerNumero(filtros.precoMax))}`]);
  if (filtros.freteGratis) c.push(['freteGratis', 'Frete grátis']);
  if (filtros.promocao) c.push(['promocao', 'Em promoção']);
  if (filtros.avaliacao4) c.push(['avaliacao4', '4★ ou mais']);
  if (filtros.comTamanho) c.push(['comTamanho', 'Com preço por unidade']);
  if (filtros.parecidosCom) c.unshift(['parecidosCom', `Parecidos com: ${filtros.parecidosCom.titulo.slice(0, 40)}${filtros.parecidosCom.titulo.length > 40 ? '…' : ''}`]);
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
    $('#status').textContent = `Buscando ofertas de “${busca.q}”…`;
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
    $('#grade').innerHTML = `<div class="aviso-erro" role="alert"><strong>A busca não deu certo.</strong> ${esc(busca.erro)}
      <button type="button" class="botao-sec" data-acao="repetir">Tentar de novo</button></div>`;
    return;
  }

  const c = calcular();
  ultimo = c;
  const NOMES = { google: 'Google Shopping', mercadolivre: 'Mercado Livre', demo: 'demonstração' };
  const via = busca.fontes.map((f) => NOMES[f] || f).join(' e ');
  const hora = busca.verificadoEm ? new Date(busca.verificadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  const n = c.lista.length;
  const fora = c.foraDoAssunto
    ? `<span class="fora">${c.foraDoAssunto} fora do assunto escondida${c.foraDoAssunto === 1 ? '' : 's'} · <button type="button" class="link" data-acao="mostrar-todos">mostrar</button></span>`
    : '';
  const l = busca.local;
  const cepFmt = prefs.cep ? `${prefs.cep.slice(0, 5)}-${prefs.cep.slice(5)}` : '';
  const regiao = l
    ? `<span class="regiao">Frete estimado para ${esc(l.nivel === 'demo' ? `o CEP ${cepFmt}` : `${l.cidade}${l.uf ? ` - ${l.uf}` : ''}`)}${l.nivel === 'estado' ? ' (pelo estado)' : ''} · <button type="button" class="link mini" data-acao="editar-cep">trocar CEP</button></span>`
    : `<span class="regiao"><button type="button" class="link mini" data-acao="editar-cep">${prefs.cep ? `CEP ${cepFmt} · trocar` : 'Coloque seu CEP para ver o frete da sua região'}</button></span>`;
  $('#status').innerHTML = `<strong>${n}</strong> oferta${n === 1 ? '' : 's'} para “${esc(busca.q)}”<span class="meta">${via ? ` · via ${esc(via)}` : ''}${hora ? ` · às ${hora}` : ''}</span>${regiao}${fora}`;
  $('#aviso-demo').hidden = !busca.aviso;
  $('#aviso-demo').textContent = busca.aviso;

  desenharOrdem(c);

  const ativos = chipsAtivos(c);
  $('#chips').innerHTML = ativos.length
    ? ativos
        .map(
          ([k, t, g, v]) =>
            `<button type="button" class="chip-ativo" data-remover-filtro="${esc(k)}"${g ? ` data-faceta="${esc(g)}" data-valor="${esc(v)}"` : ''}>${esc(t)}<span aria-hidden="true">×</span></button>`
        )
        .join('') +
      '<button type="button" class="link" data-acao="limpar-filtros">Limpar tudo</button>'
    : '';
  const nFiltros = ativos.length;
  $('#botao-filtros').innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M4.5 8h7M7 12h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>Filtros${nFiltros ? `<span class="contador">${nFiltros}</span>` : ''}`;

  $('#faixa-rapida').innerHTML = htmlFaixaRapida(c);
  $('#destaques').innerHTML = htmlDestaques(c);
  $('#grade').innerHTML = c.lista.length
    ? c.lista.map((i) => htmlCartao(i, c)).join('')
    : !c.base.length && c.foraDoAssunto
      ? `<div class="vazio">Nenhuma oferta tem todas as palavras da busca. Tente escrever de outro jeito, ou <button type="button" class="link" data-acao="mostrar-todos">mostre todas as ofertas</button>.</div>`
      : `<div class="vazio">Nenhuma oferta com esses filtros. <button type="button" class="link" data-acao="limpar-filtros">Limpar filtros</button></div>`;

  // Não redesenha o formulário de filtros enquanto alguém digita o preço
  const ativo = document.activeElement;
  if (!(ativo && ativo.dataset && ativo.dataset.filtroPreco)) $('#filtros-conteudo').innerHTML = htmlFiltros(c);
  else $('#filtros-conteudo .f-rodape .botao').textContent = `Ver ${c.lista.length} oferta${c.lista.length === 1 ? '' : 's'}`;

  desenharBandeja(c);
}

// Menu de ordenação (no lugar do seletor do sistema)
function opcoesDeOrdem(c) {
  return [
    ['relevancia', 'Relevância', 'Como o Google ordenou'],
    ['preco', 'Menor preço', 'Preço na loja, sem o frete'],
    ['total', 'Menor total com frete', 'Ofertas sem frete conhecido vão para o fim'],
    c.usaUnidade && ['unidade', `Menor preço por ${POR[c.grupo]}`, 'Compara tamanhos diferentes'],
    ['desconto', 'Maior desconto', 'Em relação ao preço antigo'],
    ['avaliacao', 'Melhor avaliação', 'Nota e número de avaliações'],
  ].filter(Boolean);
}

function desenharOrdem(c) {
  const opcoes = opcoesDeOrdem(c);
  $('#ordem-atual').textContent = (opcoes.find(([v]) => v === c.ordem) || opcoes[0])[1];
  $('#menu-ordem').innerHTML = `<div class="menu-cabeca">Ordenar por<button type="button" class="fechar" data-acao="fechar-ordem" aria-label="Fechar">×</button></div>${opcoes
    .map(
      ([v, rotulo, dica]) => `<button type="button" class="opcao-ordem" role="option" data-acao="escolher-ordem" data-ordem="${v}" aria-selected="${v === c.ordem}">
        <svg class="marca-ok" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>${esc(rotulo)}<small>${esc(dica)}</small></span></button>`
    )
    .join('')}`;
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
  b.innerHTML = `<div class="bandeja-dentro">
    <div class="bandeja-fotos">${sel.map((i) => `<span class="mini-foto">${foto(i, 'f')}</span>`).join('')}
      ${Array.from({ length: MAX_COMPARAR - sel.length }, () => '<span class="mini-foto vaga"></span>').join('')}</div>
    <span class="bandeja-texto">${sel.length} de ${MAX_COMPARAR} para comparar</span>
    <button type="button" class="link" data-acao="limpar-comparar">Limpar</button>
    <button type="button" class="botao" data-acao="abrir-comparar" ${sel.length < 2 ? 'disabled title="Escolha pelo menos 2"' : ''}>Comparar</button>
  </div>`;
}

// ---------------------------------------------------------------------------
// Comparação lado a lado
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
    return `<tr><th scope="row">${rotulo}</th>${sel
      .map((i) => {
        const v = f(i);
        const ok = alvo != null && v === alvo;
        return `<td class="${ok ? 'melhor' : ''}">${v == null || !Number.isFinite(v) ? '<span class="nd">—</span>' : fmt(v, i)}${ok ? '<span class="sr"> (melhor)</span>' : ''}</td>`;
      })
      .join('')}</tr>`;
  };
  const unitOk = (i) => (c.usaUnidade && i.grupo === c.grupo ? i.unit : null);
  $('#dlg-comparar').innerHTML = `<div class="dlg-cabeca"><h2>Comparar ofertas</h2><button type="button" class="fechar" data-acao="fechar-dialogo" aria-label="Fechar">×</button></div>
    <div class="tabela-rolagem"><table class="tabela-comparar">
      <thead><tr><th></th>${sel
        .map(
          (i) => `<th scope="col"><div class="tc-produto">${foto(i, 'tc-foto')}<span class="tc-titulo">${esc(i.titulo)}</span>
            <span class="tc-loja">${avatarLoja(i.loja, i.lojaIcone, 'mini')}${esc(i.loja)}</span></div></th>`
        )
        .join('')}</tr></thead>
      <tbody>
        ${linha('Preço na loja', (i) => i.preco, (v) => `<strong>${brl(v)}</strong>`)}
        ${linha('Frete', (i) => i.frete, (v) => (v === 0 ? 'Grátis' : brl(v)))}
        ${linha('Total com frete', (i) => (i.freteConhecido ? i.total : null), (v) => `<strong>${brl(v)}</strong>`)}
        ${c.usaUnidade ? linha(`Preço por ${POR[c.grupo]}`, unitOk, (v) => brl(v)) : ''}
        ${c.usaUnidade ? linha('Quantidade', (i) => (i.grupo === c.grupo ? i.qtd : null), (v) => fmtQtd(v, c.grupo), { maior: true }) : ''}
        ${linha('Desconto', (i) => (i.desconto > 0 ? i.desconto : null), (v) => `−${Math.round(v * 100)}%`, { maior: true })}
        ${linha('Avaliação', (i) => i.avaliacao, (v, i) => `${num(v, 1)} ★${i.avaliacoes ? ` <span class="nd">(${i.avaliacoes.toLocaleString('pt-BR')})</span>` : ''}`, { maior: true })}
        <tr><th scope="row"></th>${sel.map((i) => `<td><button type="button" class="botao" data-acao="detalhe" data-id="${esc(i.id)}">Ver onde comprar</button></td>`).join('')}</tr>
      </tbody>
    </table></div>
    <p class="nota-tabela">Em verde, o melhor valor de cada linha.</p>`;
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
    lojasHtml = `<div class="aviso-erro">${esc(detalhe.erro)}${linkFonte ? ` <a href="${esc(linkFonte)}" target="_blank" rel="noopener noreferrer">Abrir a oferta original ↗</a>` : ''}</div>`;
  } else {
    const lojas = detalhe.dados?.lojas || [];
    const menor = lojas[0]?.total ?? null;
    lojasHtml = lojas.length
      ? `<ol class="lojas">${lojas
          .map((l, k) => {
            const link = linkSeguro(l.link);
            const extras = [
              l.cupom && `<span class="chip cupom">Cupom ${esc(l.cupom)}</span>`,
              l.desconto && `<span class="chip">${esc(l.desconto)}</span>`,
              l.parcelas && `<span class="chip">${esc(l.parcelas)}</span>`,
              ...(l.detalhes || []).slice(0, 2).map((d) => `<span class="chip">${esc(d)}</span>`),
            ]
              .filter(Boolean)
              .join('');
            return `<li class="${k === 0 ? 'mais-barata' : ''}">
              <div class="l-loja">${avatarLoja(l.loja, l.icone, 'medio')}<div><span class="l-nome">${esc(l.loja)}</span>
                ${k === 0 && menor != null ? '<span class="selo verde">Menor total</span>' : ''}${l.avaliacao ? estrelas(l.avaliacao, l.avaliacoes) : ''}</div></div>
              <div class="l-preco">
                <div class="preco-linha">${precoGrande(l.preco, 'medio')}${l.precoOriginal > l.preco ? `<s>${brl(l.precoOriginal)}</s>` : ''}</div>
                <span class="frete${l.freteGratis ? ' bom' : ''}">${l.freteGratis ? 'Frete grátis' : l.frete != null ? `+ ${brl(l.frete)} de frete` : 'Frete a calcular'}${l.total != null && !l.freteGratis && l.frete != null ? ` · <strong>total ${brl(l.total)}</strong>` : ''}</span>
              </div>
              ${extras ? `<div class="l-extras">${extras}</div>` : ''}
              ${link ? `<a class="botao l-ir" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Ir para a loja ↗</a>` : '<span class="l-ir nd">Link indisponível na demonstração</span>'}
            </li>`;
          })
          .join('')}</ol>`
      : `<div class="aviso-erro">Não encontrei outras lojas para este produto.${linkFonte ? ` <a href="${esc(linkFonte)}" target="_blank" rel="noopener noreferrer">Abrir a oferta original ↗</a>` : ''}</div>`;
  }

  const tamanho = i.qtd
    ? `${fmtQtd(i.qtd, i.grupo)}${i.embalagens > 1 ? ` (${i.embalagens} × ${num(lerNumero(i.conteudo))} ${i.unidade})` : ''}${i.unit != null ? ` · ${brl(i.unit)} por ${POR[i.grupo]}` : ''}`
    : 'Tamanho não informado';

  $('#dlg-detalhe').innerHTML = `<div class="dlg-cabeca"><h2>Onde comprar</h2><button type="button" class="fechar" data-acao="fechar-dialogo" aria-label="Fechar">×</button></div>
    <div class="det-produto">
      <img class="det-foto" src="${esc(fotoPrincipal || fotoReserva)}" alt="" referrerpolicy="no-referrer">
      <div class="det-info">
        <h3>${esc(detalhe.dados?.produto?.titulo || i.titulo)}</h3>
        ${estrelas(detalhe.dados?.produto?.avaliacao ?? i.avaliacao, detalhe.dados?.produto?.avaliacoes ?? i.avaliacoes)}
        <p class="det-tamanho">${esc(tamanho)} <button type="button" class="link" data-acao="editar-tamanho">${i.qtd ? 'corrigir' : 'informar tamanho'}</button></p>
        ${
          detalhe.editandoTamanho
            ? `<form class="form-tamanho" data-form="tamanho"><label class="sr" for="tam">Tamanho</label>
                <input id="tam" name="tamanho" placeholder="ex.: 900 ml, 1 kg, 12 unidades, 3 x 250 ml" autocomplete="off">
                <button type="submit" class="botao">Usar</button><p class="erro-campo" hidden></p></form>`
            : ''
        }
        <p class="det-oferta">Oferta encontrada: ${avatarLoja(i.loja, i.lojaIcone, 'mini')} ${esc(i.loja)} · <strong>${brl(i.preco)}</strong></p>
        <div class="det-acoes">
          <button type="button" class="botao-sec salvar${estaSalvo(prefs, i.id) ? ' ativo' : ''}" data-acao="favoritar" data-id="${esc(i.id)}">${SVG_CORACAO(estaSalvo(prefs, i.id))}${estaSalvo(prefs, i.id) ? 'Salvo' : 'Salvar'}</button>
          <button type="button" class="botao-sec" data-acao="escolher-listas" data-id="${esc(i.id)}">Salvar em lista…</button>
          <button type="button" class="botao-sec" data-acao="parecidos" data-id="${esc(i.id)}">Só parecidos com este</button>
          <button type="button" class="botao-sec" data-acao="buscar-parecidos" data-id="${esc(i.id)}" title="Faz uma busca nova com o nome deste produto">Buscar mais parecidos nas lojas</button>
        </div>
      </div>
    </div>
    <h3 class="det-sub">Lojas com este produto <span class="nd">· menor total primeiro</span></h3>
    ${lojasHtml}
    <p class="nota-tabela">Preços e frete informados pelas lojas ao Google. Confira o valor final na loja antes de pagar.</p>`;
  if (detalhe.editandoTamanho) $('#tam')?.focus();
  void c;
}

// ---------------------------------------------------------------------------
// Diálogos
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
// Ações
// ---------------------------------------------------------------------------

async function executarBusca(q) {
  q = q.trim().replace(/\s+/g, ' ');
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
      else return avisar(`Dá para comparar até ${MAX_COMPARAR} ofertas de cada vez.`);
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
      return document.querySelector(`.form-frete[data-id="${CSS.escape(id)}"] input`)?.focus();
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
    if (!(v >= 0)) return erroNoForm(form, 'Digite o valor do frete, por exemplo 12,90. Use 0 para frete grátis.');
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
    if (!String(d.titulo).trim()) return erroNoForm(form, 'Diga qual é o produto.');
    if (!(preco > 0)) return erroNoForm(form, 'Informe o preço, por exemplo 21,90.');
    const frete = String(d.frete).trim() === '' ? null : lerNumero(d.frete, null);
    const tamanho = lerTitulo(d.titulo) || lerUnidades(d.titulo);
    const k = chaveBusca(busca.q);
    prefs.manuais[k] = [
      ...(prefs.manuais[k] || []),
      {
        id: `manual:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
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
    avisar('Oferta adicionada à comparação.');
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

/** "12 unidades", "30 rolos", "48 fraldas" → unidades */
function lerUnidades(txt) {
  const m = String(txt).toLowerCase().match(/(\d+)\s*(unidades?|un\b|unid|rolos?|fraldas?|c[aá]psulas?|sach[eê]s?|pe[cç]as?|pares?)/);
  return m ? { embalagens: 1, conteudo: Number(m[1]), unidade: 'un' } : null;
}

let timerAviso;
function avisar(texto, rotulo, acao) {
  const t = $('#aviso');
  // Com uma janela aberta, o aviso vai para dentro dela (senão ficaria por trás e não daria para tocar)
  const janelas = [...document.querySelectorAll('dialog[open]')];
  const destino = janelas[janelas.length - 1] || document.body;
  if (t.parentElement !== destino) destino.appendChild(t);
  t.innerHTML = `<span>${esc(texto)}</span>${rotulo ? `<button type="button">${esc(rotulo)}</button>` : ''}`;
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
  avisar('Salvo nos favoritos.', 'Pôr em outra lista', () => abrirListasDoItem(id));
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
      (l) => `<button type="button" class="aba${l.id === lista.id ? ' ativa' : ''}" data-acao="aba-lista" data-lista="${esc(l.id)}" aria-pressed="${l.id === lista.id}">
        ${l.id === FAVORITOS ? SVG_CORACAO(true) : ''}${esc(l.nome)}<span class="n">${contarLista(prefs, l.id)}</span></button>`
    )
    .join('');
  const cabecaLista =
    editandoLista === lista.id
      ? `<form class="form-lista" data-form="renomear-lista" data-lista="${esc(lista.id)}">
          <label class="sr" for="nome-lista">Nome da lista</label>
          <input id="nome-lista" name="nome" value="${esc(lista.nome)}" maxlength="40" autocomplete="off">
          <button type="submit" class="botao">Salvar</button>
          <button type="button" class="link" data-acao="cancelar-lista">Cancelar</button></form>`
      : apagandoLista === lista.id
        ? `<div class="confirma"><span>Apagar a lista “${esc(lista.nome)}”? Os itens que só estão nela deixam de ficar salvos.</span>
            <button type="button" class="botao perigo" data-acao="apagar-lista-sim" data-lista="${esc(lista.id)}">Apagar</button>
            <button type="button" class="link" data-acao="cancelar-lista">Cancelar</button></div>`
        : `<div class="lista-cabeca">
            <div><h3>${esc(lista.nome)}</h3><span class="nd">${itens.length} ${itens.length === 1 ? 'item' : 'itens'}${itens.length ? ` · total ${brl(totalDaLista(prefs, lista.id))}` : ''}</span></div>
            ${lista.id === FAVORITOS ? '' : `<div class="lista-acoes"><button type="button" class="link" data-acao="renomear-lista" data-lista="${esc(lista.id)}">Renomear</button>
              <button type="button" class="link perigo" data-acao="apagar-lista" data-lista="${esc(lista.id)}">Apagar</button></div>`}
          </div>`;

  const linhas = itens.length
    ? `<ul class="salvos">${itens
        .map((sv) => {
          const i = sv.item;
          const d = variacao(sv);
          const quando = new Date(sv.salvoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
          const link = linkSeguro(i.link);
          return `<li data-id="${esc(i.id)}">
            <img class="sv-foto" src="${esc(i.foto || fotoReserva)}" alt="" loading="lazy" referrerpolicy="no-referrer">
            <div class="sv-info">
              <span class="sv-loja">${avatarLoja(i.loja, i.lojaIcone, 'mini')}${esc(i.loja)}</span>
              <span class="sv-titulo">${esc(i.titulo)}</span>
              <span class="sv-precos"><strong>${brl(sv.ultimoPreco ?? sv.precoSalvo)}</strong>
                ${Math.abs(d) >= 0.01 ? `<span class="variacao ${d < 0 ? 'caiu' : 'subiu'}">${d < 0 ? '▼' : '▲'} ${brl(Math.abs(d))}</span>` : ''}
                <span class="nd">salvo por ${brl(sv.precoSalvo)} em ${esc(quando)}</span></span>
              <div class="sv-acoes">
                <div class="qtd" role="group" aria-label="Quantidade">
                  <button type="button" data-acao="qtd-menos" aria-label="Diminuir">−</button><span>${sv.qtd || 1}</span><button type="button" data-acao="qtd-mais" aria-label="Aumentar">+</button>
                </div>
                <button type="button" class="link mini" data-acao="buscar-salvo">Ver preços de hoje</button>
                ${link ? `<a class="link mini" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Ir à loja ↗</a>` : ''}
                <button type="button" class="link mini" data-acao="escolher-listas">Listas</button>
                <button type="button" class="link mini perigo" data-acao="tirar-da-lista" data-lista="${esc(lista.id)}">Tirar</button>
              </div>
            </div>
          </li>`;
        })
        .join('')}</ul>`
    : `<div class="vazio-salvos">${SVG_CORACAO(false)}<p>${lista.id === FAVORITOS ? 'Toque no coração de um produto para salvar aqui.' : 'Abra um produto e use “Salvar em lista…” para trazer para cá.'}</p></div>`;

  $('#dlg-salvos').innerHTML = `<div class="dlg-cabeca"><h2>Meus salvos</h2><button type="button" class="fechar" data-acao="fechar-dialogo" aria-label="Fechar">×</button></div>
    <div class="abas">${abas}
      <form class="nova-lista" data-form="nova-lista"><label class="sr" for="nova-lista">Nova lista</label>
        <input id="nova-lista" name="nome" placeholder="+ Nova lista" maxlength="40" autocomplete="off"></form>
    </div>
    <div class="salvos-corpo">${cabecaLista}${linhas}</div>
    <p class="nota-tabela">Seus salvos ficam guardados neste aparelho. Com a conta (em breve), eles vão aparecer em qualquer aparelho.</p>`;
  if (editandoLista) $('#nome-lista')?.select();
}

// ---------------------------------------------------------------------------
// Conta
// ---------------------------------------------------------------------------

let apagandoConta = false;

const SVG_GOOGLE = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

function abrirPainelConta(abrir) {
  $('#painel-conta').hidden = !abrir;
  $('#botao-conta').setAttribute('aria-expanded', String(abrir));
  if (!abrir) apagandoConta = false;
  if (abrir) desenharConta();
}

function fotoDoUsuario(u, classe) {
  const letra = esc((u?.nome || u?.email || '?').trim()[0]?.toUpperCase() || '?');
  return `<span class="${classe}" aria-hidden="true">${letra}${u?.foto ? `<img class="logo" src="${esc(u.foto)}" alt="" referrerpolicy="no-referrer">` : ''}</span>`;
}

function desenharConta() {
  if (!conta) return;
  const e = conta.estado;
  const u = e.sessao ? e.usuario : null;
  const botao = $('#botao-conta');
  botao.innerHTML = u
    ? `${fotoDoUsuario(u, 'bolinha foto')}<span class="rotulo-conta">${esc((u.nome || 'Minha conta').split(' ')[0])}</span>${e.situacao === 'sincronizando' ? '<span class="girando" aria-hidden="true"></span>' : ''}`
    : `<span class="bolinha" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="5.5" r="3" fill="currentColor"/><path d="M2 15c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5z" fill="currentColor"/></svg></span><span class="rotulo-conta">Entrar</span>`;
  botao.setAttribute('aria-label', u ? `Conta de ${u.nome || u.email}` : 'Entrar na conta');
  if ($('#painel-conta').hidden) return;

  const nSalvos = Object.keys(prefs.salvos).length;
  const hora = e.ultimaSinc ? e.ultimaSinc.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  const situacao = {
    sincronizando: ['girando', 'Sincronizando…'],
    sincronizado: ['ok', `Sincronizado${hora ? ` às ${hora}` : ''}`],
    offline: ['alerta', 'Sem internet: está tudo guardado no aparelho e vai para a conta quando a conexão voltar'],
    erro: ['alerta', 'Não deu para sincronizar agora'],
    parado: ['ok', 'Conectado'],
  }[e.situacao] || ['ok', 'Conectado'];

  $('#painel-conta').innerHTML = u
    ? `<div class="conta-cabeca">${fotoDoUsuario(u, 'conta-foto')}<div><strong>${esc(u.nome || 'Sua conta')}</strong><span>${esc(u.email || '')}</span></div>
        <button type="button" class="fechar" data-acao="fechar-conta" aria-label="Fechar">×</button></div>
      <p class="sinc"><span class="ponto ${situacao[0]}" aria-hidden="true"></span>${esc(situacao[1])}${e.situacao === 'erro' || e.situacao === 'offline' ? ' · <button type="button" class="link mini" data-acao="sincronizar-agora">tentar de novo</button>' : ''}</p>
      <p>Seus ${nSalvos} salvo${nSalvos === 1 ? '' : 's'}, listas e preferências aparecem em qualquer aparelho em que você entrar com esta conta.</p>
      ${
        apagandoConta
          ? `<div class="confirma"><span>Apagar sua conta? Isso apaga da conta seus salvos e listas para sempre. O que está neste aparelho continua aqui.</span>
              <button type="button" class="botao perigo" data-acao="apagar-conta-sim">Apagar conta</button>
              <button type="button" class="link" data-acao="cancelar-apagar-conta">Cancelar</button></div>`
          : `<div class="conta-acoes"><button type="button" class="botao-sec" data-acao="sair-conta">Sair</button>
              <button type="button" class="link perigo" data-acao="apagar-conta">Apagar minha conta</button></div>`
      }
      <a class="link mini" href="privacidade.html" target="_blank" rel="noopener">Política de privacidade</a>`
    : `<div class="conta-cabeca"><div><strong>Leve seus salvos para qualquer aparelho</strong></div>
        <button type="button" class="fechar" data-acao="fechar-conta" aria-label="Fechar">×</button></div>
      <p>Hoje seus favoritos, listas e preferências ficam só neste aparelho. Entre com o Google e eles aparecem no celular e no computador, sem perder o que já está aqui.</p>
      <button type="button" class="botao-google" data-acao="entrar-google">${SVG_GOOGLE}Entrar com Google</button>
      ${e.disponivel ? '' : '<p class="nd">Na demonstração a conta não funciona; use a versão publicada do app.</p>'}
      <p class="nota-conta">Usamos só seu nome, e-mail e foto. Nada do seu Gmail ou Drive. <a href="privacidade.html" target="_blank" rel="noopener">Política de privacidade</a></p>`;
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
  $('#dlg-listas').innerHTML = `<div class="dlg-cabeca"><h2>Salvar em lista</h2><button type="button" class="fechar" data-acao="fechar-listas" aria-label="Fechar">×</button></div>
    <p class="dl-produto">${esc(item.titulo)}</p>
    <div class="dl-listas">${prefs.listas
      .map(
        (l) => `<label class="dl-opcao"><input type="checkbox" data-alternar-lista="${esc(l.id)}" ${sv?.listas.includes(l.id) ? 'checked' : ''}>
          <span>${esc(l.nome)}</span><span class="nd">${contarLista(prefs, l.id)}</span></label>`
      )
      .join('')}</div>
    <form class="form-lista" data-form="nova-lista-item"><label class="sr" for="nova-lista-item">Nome da nova lista</label>
      <input id="nova-lista-item" name="nome" placeholder="Nova lista, ex.: Compras do mês" maxlength="40" autocomplete="off">
      <button type="submit" class="botao">Criar e salvar</button></form>
    <div class="dl-rodape"><button type="button" class="botao-sec" data-acao="fechar-listas">Pronto</button></div>`;
}

function iniciar() {
  // CEP: digitado uma vez, lembrado; mudar o CEP refaz a busca
  const campoCep = $('#cep');
  const formatarCep = (v) => {
    const d = String(v).replace(/\D/g, '').slice(0, 8);
    return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
  };
  campoCep.value = formatarCep(prefs.cep);
  campoCep.addEventListener('input', () => (campoCep.value = formatarCep(campoCep.value)));
  const guardarCep = () => {
    const d = campoCep.value.replace(/\D/g, '');
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

  // Menu de ordenação: fecha ao clicar fora ou com Esc
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

  // Foto que não carrega vira ilustração; ícone de loja que não carrega some e fica a inicial
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
      $('#cep').value = prefs.cep ? `${prefs.cep.slice(0, 5)}-${prefs.cep.slice(5)}` : '';
      redesenharTudo();
    },
    aoMudar: () => desenharConta(),
    avisar,
  });
  $('#botao-conta').addEventListener('click', () => abrirPainelConta($('#painel-conta').hidden));
  document.addEventListener('click', (ev) => {
    // composedPath: o botão pode ter sido redesenhado durante o clique
    const dentro = ev.composedPath().some((el) => el.id === 'painel-conta' || el.id === 'botao-conta');
    if (!$('#painel-conta').hidden && !dentro) abrirPainelConta(false);
  });
  conta.iniciar();

  const inicial = prefs.ultimaBusca || (modoDemo() ? 'sabonete líquido' : '');
  if (inicial) {
    $('#q').value = inicial;
    executarBusca(inicial);
  }
}

iniciar();
