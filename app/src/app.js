import { UNIDADES, lerNumero, lerTitulo, grupoDaOferta, quantidadeDoAnuncio, precoExibido } from './core.js';
import { buscarProdutos, buscarLojas, modoDemo } from './fontes.js';
import { fotoReserva } from './demo.js';

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

const CHAVE = 'minhas-compras:v3';
const prefs = (() => {
  const padrao = { ordem: 'relevancia', tamanhos: {}, ultimaBusca: '' };
  try {
    const p = JSON.parse(localStorage.getItem(CHAVE) || 'null');
    if (p && typeof p === 'object') return { ...padrao, ...p };
  } catch (_) {
    /* sem armazenamento */
  }
  return padrao;
})();
function salvar() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(prefs));
  } catch (_) {
    /* o app funciona sem lembrar */
  }
}

const busca = { q: '', itens: [], verificadoEm: null, fontes: [], demo: false, aviso: '', carregando: false, erro: '' };
const FILTROS_VAZIOS = () => ({ lojas: new Set(), precoMin: '', precoMax: '', freteGratis: false, promocao: false, avaliacao4: false, comTamanho: false });
let filtros = FILTROS_VAZIOS();
const comparar = new Set();
const MAX_COMPARAR = 4;
let detalhe = null; // { item, carregando, erro, dados, editandoTamanho }

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
  const it = t ? { ...i, ...t, fonteConteudo: 'voce' } : i;
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
  const todos = busca.itens.filter((i) => i.preco > 0).map(enriquecer);
  const contagem = {};
  for (const i of todos) if (i.grupo) contagem[i.grupo] = (contagem[i.grupo] || 0) + 1;
  const [grupo, nGrupo] = Object.entries(contagem).sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const usaUnidade = nGrupo >= 2;

  const min = lerNumero(filtros.precoMin, 0);
  const max = lerNumero(filtros.precoMax, 0);
  const lista = todos.filter(
    (i) =>
      (!filtros.lojas.size || filtros.lojas.has(i.loja)) &&
      (!min || i.preco >= min) &&
      (!max || i.preco <= max) &&
      (!filtros.freteGratis || i.frete === 0) &&
      (!filtros.promocao || i.desconto > 0) &&
      (!filtros.avaliacao4 || i.avaliacao >= 4) &&
      (!filtros.comTamanho || (usaUnidade && i.grupo === grupo))
  );

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

  // Lojas para o filtro (de todos os resultados, não só dos filtrados)
  const lojas = new Map();
  for (const i of todos) {
    const l = lojas.get(i.loja) || { nome: i.loja, icone: i.lojaIcone, n: 0, min: Infinity };
    l.n++;
    l.min = Math.min(l.min, i.preco);
    if (!l.icone && i.lojaIcone) l.icone = i.lojaIcone;
    lojas.set(i.loja, l);
  }

  return { todos, lista, grupo, usaUnidade, ordem, destaques, lojas: [...lojas.values()].sort((a, b) => b.n - a.n || a.min - b.min) };
}

// ---------------------------------------------------------------------------
// Pedaços da tela
// ---------------------------------------------------------------------------

const foto = (i, classe = 'foto') => `<img class="${classe}" src="${esc(i.foto || fotoReserva)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;

function linhaFrete(i) {
  if (i.frete === 0) return '<span class="frete bom">Frete grátis</span>';
  if (i.frete == null) return '<span class="frete">Frete a calcular na loja</span>';
  return `<span class="frete">+ ${brl(i.frete)} de frete · <strong>total ${brl(i.total)}</strong></span>`;
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
      <div class="loja-linha">${avatarLoja(i.loja, i.lojaIcone)}<span class="loja-nome">${esc(i.loja)}</span>${i.variasLojas ? '<span class="mais">+ lojas</span>' : ''}</div>
      <h3 class="titulo" title="${esc(i.titulo)}">${esc(i.titulo)}</h3>
      ${estrelas(i.avaliacao, i.avaliacoes)}
      <div class="preco-bloco">
        <span class="rotulo-preco">Preço na loja</span>
        <div class="preco-linha">${precoGrande(i.preco)}${i.precoOriginal > i.preco ? `<s>${brl(i.precoOriginal)}</s>` : ''}</div>
        ${linhaFrete(i)}
        ${unit}
      </div>
      <div class="acoes">
        <button type="button" class="botao" data-acao="detalhe">Ver onde comprar</button>
        ${direto ? `<a class="botao-sec" href="${esc(direto)}" target="_blank" rel="noopener noreferrer">Ir à loja ↗</a>` : ''}
      </div>
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
      ${chk('freteGratis', 'Frete grátis')}
      ${chk('promocao', 'Em promoção')}
      ${chk('avaliacao4', '4 estrelas ou mais')}
      ${c.usaUnidade ? chk('comTamanho', `Com preço por ${POR[c.grupo]}`) : ''}
    </div>
    <div class="f-rodape"><button type="button" class="botao" data-acao="fechar-filtros">Ver ${c.lista.length} oferta${c.lista.length === 1 ? '' : 's'}</button></div>`;
}

function chipsAtivos() {
  const c = [];
  for (const l of filtros.lojas) c.push([`loja:${l}`, l]);
  if (filtros.precoMin) c.push(['precoMin', `De ${brl(lerNumero(filtros.precoMin))}`]);
  if (filtros.precoMax) c.push(['precoMax', `Até ${brl(lerNumero(filtros.precoMax))}`]);
  if (filtros.freteGratis) c.push(['freteGratis', 'Frete grátis']);
  if (filtros.promocao) c.push(['promocao', 'Em promoção']);
  if (filtros.avaliacao4) c.push(['avaliacao4', '4★ ou mais']);
  if (filtros.comTamanho) c.push(['comTamanho', 'Com preço por unidade']);
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
    $('#chips').innerHTML = '';
    $('#grade').innerHTML = '<div class="cartao esq"></div>'.repeat(8);
    $('#filtros-conteudo').innerHTML = '';
    return;
  }
  if (busca.erro) {
    $('#status').textContent = '';
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
  const total = c.todos.length;
  $('#status').innerHTML = `<strong>${c.lista.length === total ? total : `${c.lista.length} de ${total}`}</strong> oferta${total === 1 ? '' : 's'} para “${esc(busca.q)}”<span class="meta">${via ? ` · via ${esc(via)}` : ''}${hora ? ` · às ${hora}` : ''}</span>`;
  $('#aviso-demo').hidden = !busca.aviso;
  $('#aviso-demo').textContent = busca.aviso;

  const sel = $('#ordem');
  sel.querySelector('option[value="unidade"]').hidden = !c.usaUnidade;
  sel.querySelector('option[value="unidade"]').textContent = c.usaUnidade ? `Menor preço por ${POR[c.grupo]}` : 'Menor preço por unidade';
  sel.value = c.ordem;

  const ativos = chipsAtivos();
  $('#chips').innerHTML = ativos.length
    ? ativos.map(([k, t]) => `<button type="button" class="chip-ativo" data-remover-filtro="${esc(k)}">${esc(t)}<span aria-hidden="true">×</span></button>`).join('') +
      '<button type="button" class="link" data-acao="limpar-filtros">Limpar tudo</button>'
    : '';
  const nFiltros = ativos.length;
  $('#botao-filtros').innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M4.5 8h7M7 12h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>Filtros${nFiltros ? `<span class="contador">${nFiltros}</span>` : ''}`;

  $('#destaques').innerHTML = htmlDestaques(c);
  $('#grade').innerHTML = c.lista.length
    ? c.lista.map((i) => htmlCartao(i, c)).join('')
    : `<div class="vazio">Nenhuma oferta com esses filtros. <button type="button" class="link" data-acao="limpar-filtros">Limpar filtros</button></div>`;

  // Não redesenha o formulário de filtros enquanto alguém digita o preço
  const ativo = document.activeElement;
  if (!(ativo && ativo.dataset && ativo.dataset.filtroPreco)) $('#filtros-conteudo').innerHTML = htmlFiltros(c);
  else $('#filtros-conteudo .f-rodape .botao').textContent = `Ver ${c.lista.length} oferta${c.lista.length === 1 ? '' : 's'}`;

  desenharBandeja(c);
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
  prefs.ultimaBusca = q;
  salvar();
  desenhar();
  try {
    Object.assign(busca, await buscarProdutos(q), { carregando: false });
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
    if (k.startsWith('loja:')) filtros.lojas.delete(k.slice(5));
    else filtros[k] = typeof filtros[k] === 'boolean' ? false : '';
    return desenhar();
  }
  switch (alvo.dataset.acao) {
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
  }
}

function aoMudar(ev) {
  const el = ev.target;
  if (el.dataset.filtroLoja !== undefined) {
    if (el.checked) filtros.lojas.add(el.dataset.filtroLoja);
    else filtros.lojas.delete(el.dataset.filtroLoja);
  } else if (el.dataset.filtro) {
    filtros[el.dataset.filtro] = el.checked;
  } else if (el.dataset.filtroPreco) {
    filtros[el.dataset.filtroPreco] = el.value;
  } else if (el.id === 'ordem') {
    prefs.ordem = el.value;
    salvar();
  } else return;
  desenhar();
}

function aoEnviar(ev) {
  const form = ev.target;
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
function avisar(texto) {
  const t = $('#aviso');
  t.textContent = texto;
  t.hidden = false;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => (t.hidden = true), 3500);
}

function iniciar() {
  $('#form-busca').addEventListener('submit', (ev) => {
    ev.preventDefault();
    executarBusca($('#q').value);
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
    d.addEventListener('close', () => (detalhe = d.id === 'dlg-detalhe' ? null : detalhe));
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

  const painel = $('#painel-conta');
  $('#botao-conta').addEventListener('click', () => {
    painel.hidden = !painel.hidden;
    $('#botao-conta').setAttribute('aria-expanded', String(!painel.hidden));
  });
  $('#fechar-conta').addEventListener('click', () => {
    painel.hidden = true;
    $('#botao-conta').setAttribute('aria-expanded', 'false');
  });

  const inicial = prefs.ultimaBusca || (modoDemo() ? 'sabonete líquido refil' : '');
  if (inicial) {
    $('#q').value = inicial;
    executarBusca(inicial);
  }
}

iniciar();
