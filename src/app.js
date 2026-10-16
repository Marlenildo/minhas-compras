import {
  UNIDADES,
  lerNumero,
  lerTitulo,
  grupoDaOferta,
  compararOfertas,
  precoExibido,
  fmtPct,
} from './core.js';

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

const CHAVE = 'minhas-compras:v1';

const EXEMPLO = {
  exemplo: true,
  produto: { nome: 'Sabonete líquido Marca X', minimo: '', maxUnidades: '6' },
  ofertas: [
    {
      loja: 'Amazon',
      titulo: 'Sabonete Líquido Marca X Refil 900 ml',
      link: '',
      preco: '24,90',
      embalagens: '1',
      conteudo: '900',
      unidade: 'ml',
      frete: '12,90',
      freteGratisAcima: '79',
      pixPct: '',
      descontos: [
        { minQtd: '5', pct: '5' },
        { minQtd: '10', pct: '10' },
      ],
    },
    {
      loja: 'Mercado Livre',
      titulo: 'Kit 3 Sabonete Líquido Marca X 250 ml',
      link: '',
      preco: '29,90',
      embalagens: '3',
      conteudo: '250',
      unidade: 'ml',
      frete: '9,90',
      freteGratisAcima: '19',
      pixPct: '',
      descontos: [],
    },
    {
      loja: 'Magalu',
      titulo: 'Sabonete Líquido Marca X 650 ml com válvula',
      link: '',
      preco: '19,90',
      embalagens: '1',
      conteudo: '650',
      unidade: 'ml',
      frete: '14,90',
      freteGratisAcima: '99',
      pixPct: '5',
      descontos: [],
    },
    {
      loja: 'Farmácia online',
      titulo: 'Sabonete Líquido Marca X Refil 2x900ml',
      link: '',
      preco: '52,90',
      embalagens: '2',
      conteudo: '900',
      unidade: 'ml',
      frete: '0',
      freteGratisAcima: '',
      pixPct: '5',
      descontos: [],
    },
  ],
};

const novaId = () => Math.random().toString(36).slice(2, 9);
const comIds = (e) => ({ ...e, ofertas: e.ofertas.map((o) => ({ id: novaId(), ...o, descontos: (o.descontos || []).map((d) => ({ ...d })) })) });

function ofertaVazia() {
  return {
    id: novaId(),
    loja: '',
    titulo: '',
    link: '',
    preco: '',
    embalagens: '1',
    conteudo: '',
    unidade: 'ml',
    frete: '',
    freteGratisAcima: '',
    pixPct: '',
    descontos: [],
  };
}

function carregar() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (bruto) {
      const e = JSON.parse(bruto);
      if (e && Array.isArray(e.ofertas) && e.produto) return e;
    }
  } catch (_) {
    /* sem armazenamento: segue com o exemplo */
  }
  return comIds(EXEMPLO);
}

function salvar() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(estado));
  } catch (_) {
    /* sem armazenamento: o app funciona, só não lembra */
  }
}

let estado = carregar();

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num1 = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const SIGLA = { volume: 'L', massa: 'kg', unidade: 'un', comprimento: 'm' };
const BASE = { volume: 'ml', massa: 'g', unidade: 'un', comprimento: 'm' };

function fmtQtd(base, grupo) {
  if (grupo === 'volume') return base >= 1000 ? `${num1(base / 1000)} L` : `${num1(base)} ml`;
  if (grupo === 'massa') return base >= 1000 ? `${num1(base / 1000)} kg` : `${num1(base)} g`;
  if (grupo === 'comprimento') return `${num1(base)} m`;
  return `${num1(base)} un`;
}

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

const nomeDaOferta = (o) => o.titulo?.trim() || 'Anúncio sem título';
const lojaDaOferta = (o) => o.loja?.trim() || 'Loja sem nome';

/** "2 L", "1500 ml" ou "1500" (na unidade base do produto). */
function lerQuantidadeMinima(txt) {
  if (!txt || !String(txt).trim()) return 0;
  const lido = lerTitulo(txt);
  if (lido) return lido.embalagens * lido.conteudo * UNIDADES[lido.unidade].fator;
  return lerNumero(txt, 0);
}

// ---------------------------------------------------------------------------
// Ofertas (formulário)
// ---------------------------------------------------------------------------

const $ = (s, r = document) => r.querySelector(s);

function campo(o, nome, rotulo, { dica = '', tipo = 'decimal', ph = '', largura = '' } = {}) {
  const id = `${nome}-${o.id}`;
  const modo = tipo === 'texto' ? 'text' : tipo === 'url' ? 'url' : 'decimal';
  return `<label class="campo ${largura}" for="${id}">
    <span class="rotulo">${rotulo}</span>
    <input id="${id}" data-campo="${nome}" type="${tipo === 'url' ? 'url' : 'text'}" inputmode="${modo}"
      value="${esc(o[nome])}" placeholder="${esc(ph)}" autocomplete="off">
    ${dica ? `<span class="dica">${dica}</span>` : ''}
  </label>`;
}

function htmlOferta(o, i) {
  const unidades = Object.keys(UNIDADES)
    .map((u) => `<option value="${u}" ${o.unidade === u ? 'selected' : ''}>${u}</option>`)
    .join('');
  const faixas = (o.descontos || [])
    .map(
      (d, j) => `<div class="faixa" data-faixa="${j}">
        <span>A partir de</span>
        <input id="fx-min-${o.id}-${j}" aria-label="Quantidade mínima" data-faixa-campo="minQtd" inputmode="numeric" value="${esc(d.minQtd)}" placeholder="5">
        <span>unid.,</span>
        <input id="fx-pct-${o.id}-${j}" aria-label="Desconto em %" data-faixa-campo="pct" inputmode="decimal" value="${esc(d.pct)}" placeholder="5">
        <span>% de desconto</span>
        <button type="button" class="icone" data-acao="remover-faixa" aria-label="Remover faixa">×</button>
      </div>`
    )
    .join('');
  return `<fieldset class="oferta" data-id="${o.id}">
    <legend><span class="num">${i + 1}</span>${esc(lojaDaOferta(o))}</legend>
    <div class="grade">
      ${campo(o, 'loja', 'Loja', { tipo: 'texto', ph: 'Amazon, Mercado Livre…' })}
      ${campo(o, 'link', 'Link do anúncio', { tipo: 'url', ph: 'https://…', largura: 'meia' })}
      ${campo(o, 'titulo', 'Título do anúncio', { tipo: 'texto', ph: 'Cole o título: “Kit 3 Sabonete 250 ml”', largura: 'cheia', dica: `<span data-lido></span>` })}
      ${campo(o, 'preco', 'Preço do anúncio', { ph: '24,90', dica: 'R$' })}
      ${campo(o, 'embalagens', 'Embalagens no anúncio', { ph: '1', dica: 'kit de 3 = 3' })}
      <div class="campo conteudo">
        <label class="rotulo" for="conteudo-${o.id}">Conteúdo de cada</label>
        <div class="junto">
          <input id="conteudo-${o.id}" data-campo="conteudo" inputmode="decimal" value="${esc(o.conteudo)}" placeholder="900" autocomplete="off">
          <select id="unidade-${o.id}" data-campo="unidade" aria-label="Unidade">${unidades}</select>
        </div>
      </div>
      ${campo(o, 'frete', 'Frete', { ph: '0 = grátis', dica: 'R$ para o seu CEP' })}
      ${campo(o, 'freteGratisAcima', 'Frete grátis a partir de', { ph: 'ex.: 19', dica: 'R$ em produtos' })}
      ${campo(o, 'pixPct', 'Desconto no Pix', { ph: '0', dica: '%' })}
    </div>
    <div class="faixas">
      <span class="rotulo">Desconto por quantidade</span>
      ${faixas || '<p class="vazio">Nenhum. Use quando a loja dá desconto ao levar várias unidades.</p>'}
      <button type="button" class="link" data-acao="add-faixa">+ Adicionar faixa de desconto</button>
    </div>
    <div class="acoes-oferta">
      <button type="button" class="link perigo" data-acao="remover">Remover oferta</button>
    </div>
  </fieldset>`;
}

function desenharOfertas() {
  $('#ofertas').innerHTML = estado.ofertas.map(htmlOferta).join('');
  estado.ofertas.forEach(atualizarLeituraDoTitulo);
}

function atualizarLeituraDoTitulo(o) {
  const alvo = document.querySelector(`.oferta[data-id="${o.id}"] [data-lido]`);
  if (!alvo) return;
  const lido = lerTitulo(o.titulo);
  alvo.textContent = lido
    ? `Entendi: ${lido.embalagens > 1 ? `${lido.embalagens} × ` : ''}${num1(lido.conteudo)} ${lido.unidade}`
    : o.titulo
      ? 'Não achei o conteúdo no título. Preencha abaixo.'
      : '';
}

const ofertaDe = (el) => estado.ofertas.find((o) => o.id === el.closest('.oferta')?.dataset.id);

function aoDigitarOferta(ev) {
  const el = ev.target;
  const o = ofertaDe(el);
  if (!o) return;
  if (el.dataset.faixaCampo) {
    const j = Number(el.closest('.faixa').dataset.faixa);
    o.descontos[j][el.dataset.faixaCampo] = el.value;
  } else if (el.dataset.campo) {
    const c = el.dataset.campo;
    o[c] = el.value;
    if (c === 'conteudo' || c === 'embalagens' || c === 'unidade') o.manual = true;
    if (c === 'titulo') {
      const lido = lerTitulo(o.titulo);
      if (lido && !o.manual) {
        o.embalagens = String(lido.embalagens);
        o.conteudo = String(lido.conteudo).replace('.', ',');
        o.unidade = lido.unidade;
        const raiz = el.closest('.oferta');
        $('[data-campo="embalagens"]', raiz).value = o.embalagens;
        $('[data-campo="conteudo"]', raiz).value = o.conteudo;
        $('[data-campo="unidade"]', raiz).value = o.unidade;
      }
      atualizarLeituraDoTitulo(o);
    }
    if (c === 'loja') el.closest('.oferta').querySelector('legend').lastChild.textContent = lojaDaOferta(o);
  }
  sairDoExemplo();
  salvar();
  desenharResultado();
}

let removida = null;

function aoClicarOferta(ev) {
  const b = ev.target.closest('[data-acao]');
  if (!b) return;
  const o = ofertaDe(b);
  if (!o) return;
  const acao = b.dataset.acao;
  if (acao === 'add-faixa') {
    o.descontos.push({ minQtd: '', pct: '' });
    desenharOfertas();
    const ultimo = document.querySelectorAll(`.oferta[data-id="${o.id}"] .faixa input`);
    ultimo[ultimo.length - 2]?.focus();
  } else if (acao === 'remover-faixa') {
    o.descontos.splice(Number(b.closest('.faixa').dataset.faixa), 1);
    desenharOfertas();
  } else if (acao === 'remover') {
    const i = estado.ofertas.indexOf(o);
    removida = { oferta: o, i };
    estado.ofertas.splice(i, 1);
    desenharOfertas();
    avisar(`Oferta de ${lojaDaOferta(o)} removida.`, 'Desfazer', () => {
      if (!removida) return;
      estado.ofertas.splice(removida.i, 0, removida.oferta);
      removida = null;
      desenharOfertas();
      salvar();
      desenharResultado();
    });
  }
  sairDoExemplo();
  salvar();
  desenharResultado();
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

function linhasDoCupom(r, grupo) {
  const e = r.escolhida;
  const o = r.oferta;
  const linhas = [];
  linhas.push([`Produtos (${e.n} × ${brl(lerNumero(o.preco))})`, brl(e.bruto)]);
  if (e.pctQtd > 0) linhas.push([`Desconto por quantidade (${fmtPct(e.pctQtd)})`, `− ${brl(e.bruto - e.produtos)}`]);
  if (e.pctPix > 0) linhas.push([`Desconto no Pix (${fmtPct(e.pctPix)})`, `− ${brl(e.produtos - e.produtosPagos)}`]);
  if (e.ganhouFreteGratis) linhas.push([`Frete (grátis, era ${brl(e.freteCheio)})`, brl(0)]);
  else linhas.push([e.frete > 0 ? 'Frete' : 'Frete grátis', brl(e.frete)]);
  return linhas
    .map(([a, b]) => `<div class="linha"><span>${a}</span><span>${b}</span></div>`)
    .join('')
    .concat(
      `<div class="linha total"><span>Você paga</span><span>${brl(e.total)}</span></div>
       <div class="linha"><span>Você leva</span><span>${fmtQtd(e.quantidade, grupo)}</span></div>`
    );
}

function chips(e) {
  const c = [];
  if (e.frete === 0) c.push(`<span class="chip bom">${e.ganhouFreteGratis ? 'Ganha frete grátis' : 'Frete grátis'}</span>`);
  else c.push(`<span class="chip">Frete ${brl(e.frete)}</span>`);
  if (e.pctQtd > 0) c.push(`<span class="chip bom">−${fmtPct(e.pctQtd)} por quantidade</span>`);
  if (e.pctPix > 0) c.push(`<span class="chip">−${fmtPct(e.pctPix)} no Pix</span>`);
  return c.join('');
}

function desenharResultado() {
  const p = estado.produto;
  const opcoes = {
    quantidadeMinima: lerQuantidadeMinima(p.minimo),
    maxUnidades: Math.max(1, Math.min(50, Math.round(lerNumero(p.maxUnidades, 6)) || 6)),
  };
  const res = compararOfertas(estado.ofertas, opcoes);
  const { ranking, grupo } = res;
  const sigla = SIGLA[grupo];
  $('#unidade-minimo').textContent = BASE[grupo];

  const avisos = [];
  if (res.incompletas.length)
    avisos.push(`${res.incompletas.length === 1 ? '1 oferta está' : `${res.incompletas.length} ofertas estão`} sem preço ou conteúdo e ficou de fora.`);
  if (res.ignoradas.length)
    avisos.push(`${res.ignoradas.map(lojaDaOferta).join(', ')} usa outra unidade (${res.ignoradas.map((o) => o.unidade).join(', ')}) e não entra na comparação.`);
  $('#avisos').innerHTML = avisos.map((a) => `<p>${esc(a)}</p>`).join('');

  const vencedor = $('#vencedor');
  if (!ranking.length) {
    vencedor.innerHTML = `<div class="etiqueta vazia">
      <span class="eyebrow">Melhor compra</span>
      <p>Adicione ofertas com preço e conteúdo para ver qual sai mais barata.</p></div>`;
    $('#ranking').innerHTML = '';
    return;
  }

  const r = ranking[0];
  const e = r.escolhida;
  const link = linkSeguro(r.oferta.link);
  const economia =
    ranking.length > 1 && res.economiaVsMaisCara > 0.0005
      ? `<p class="economia">Sai ${fmtPct(res.economiaVsMaisCara * 100)} mais barato que a opção mais cara da lista.</p>`
      : '';
  vencedor.innerHTML = `
    <div class="etiqueta">
      <div class="etiqueta-topo">
        <span class="eyebrow">Melhor compra · preço por ${sigla === 'L' ? 'litro' : sigla === 'kg' ? 'quilo' : sigla === 'un' ? 'unidade' : 'metro'}</span>
        <span class="loja">${esc(lojaDaOferta(r.oferta))}</span>
      </div>
      <div class="preco-un"><span class="valor">${brl(precoExibido(e.custoPorBase, grupo))}</span><span class="por">/${sigla}</span></div>
      <p class="leve">Leve <strong>${e.n}</strong> × ${esc(nomeDaOferta(r.oferta))}</p>
    </div>
    <div class="cupom">${linhasDoCupom(r, grupo)}</div>
    ${r.dicas.length ? `<ul class="dicas">${r.dicas.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
    ${economia}
    ${link ? `<a class="botao" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Abrir na loja</a>` : ''}
  `;

  const maior = Math.max(...ranking.map((x) => x.escolhida.custoPorBase));
  $('#ranking').innerHTML = ranking
    .map((x, i) => {
      const ex = x.escolhida;
      const diff = i === 0 ? 'Mais barata' : `+${fmtPct((ex.custoPorBase / e.custoPorBase - 1) * 100)}`;
      const lk = linkSeguro(x.oferta.link);
      const larg = Math.max(4, (ex.custoPorBase / maior) * 100);
      return `<li class="${i === 0 ? 'primeira' : ''}">
        <div class="pos">${i + 1}</div>
        <div class="corpo">
          <div class="cabeca">
            <span class="r-loja">${esc(lojaDaOferta(x.oferta))}</span>
            <span class="r-preco">${brl(precoExibido(ex.custoPorBase, grupo))}<small>/${sigla}</small></span>
          </div>
          <div class="barra" aria-hidden="true"><span style="width:${larg.toFixed(1)}%"></span></div>
          <p class="r-titulo">Leve ${ex.n} × ${esc(nomeDaOferta(x.oferta))}</p>
          <div class="r-pe">
            <span class="r-total">${brl(ex.total)} por ${fmtQtd(ex.quantidade, grupo)}</span>
            <span class="r-diff ${i === 0 ? 'bom' : ''}">${diff}</span>
          </div>
          <div class="chips">${chips(ex)}${lk ? `<a class="chip link-loja" href="${esc(lk)}" target="_blank" rel="noopener noreferrer">Abrir ↗</a>` : ''}</div>
          ${i > 0 && x.dicas.length ? `<p class="r-dica">${esc(x.dicas[0])}</p>` : ''}
        </div>
      </li>`;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Produto, exemplo, avisos
// ---------------------------------------------------------------------------

function desenharProduto() {
  $('#produto-nome').value = estado.produto.nome || '';
  $('#produto-minimo').value = estado.produto.minimo || '';
  $('#produto-max').value = estado.produto.maxUnidades || '';
  $('#selo-exemplo').hidden = !estado.exemplo;
}

function sairDoExemplo() {
  if (estado.exemplo) {
    estado.exemplo = false;
    $('#selo-exemplo').hidden = true;
  }
}

let timerAviso;
function avisar(texto, rotuloAcao, acao) {
  const t = $('#aviso');
  t.innerHTML = `<span>${esc(texto)}</span>${rotuloAcao ? `<button type="button">${esc(rotuloAcao)}</button>` : ''}`;
  t.hidden = false;
  if (rotuloAcao) t.querySelector('button').onclick = () => { acao(); t.hidden = true; };
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => { t.hidden = true; removida = null; }, 6000);
}

function iniciar() {
  desenharProduto();
  desenharOfertas();
  desenharResultado();

  $('#ofertas').addEventListener('input', aoDigitarOferta);
  $('#ofertas').addEventListener('change', aoDigitarOferta);
  $('#ofertas').addEventListener('click', aoClicarOferta);

  for (const [id, chave] of [['produto-nome', 'nome'], ['produto-minimo', 'minimo'], ['produto-max', 'maxUnidades']]) {
    $(`#${id}`).addEventListener('input', (ev) => {
      estado.produto[chave] = ev.target.value;
      sairDoExemplo();
      salvar();
      desenharResultado();
    });
  }

  $('#add-oferta').addEventListener('click', () => {
    const o = ofertaVazia();
    const ultima = estado.ofertas[estado.ofertas.length - 1];
    if (ultima) o.unidade = ultima.unidade;
    estado.ofertas.push(o);
    sairDoExemplo();
    salvar();
    desenharOfertas();
    desenharResultado();
    $(`#loja-${o.id}`).focus();
  });

  // Trocar a lista inteira pede confirmação na própria página
  const painel = $('#confirmar');
  let pendente = null;
  const pedir = (texto, rotulo, acao) => {
    if (estado.exemplo) return acao(); // o exemplo pode ser trocado sem perguntar
    pendente = acao;
    $('#confirmar-texto').textContent = texto;
    $('#confirmar-sim').textContent = rotulo;
    painel.hidden = false;
    $('#confirmar-sim').focus();
  };
  $('#confirmar-nao').addEventListener('click', () => { painel.hidden = true; pendente = null; });
  $('#confirmar-sim').addEventListener('click', () => { painel.hidden = true; pendente?.(); pendente = null; });

  const redesenhar = () => { salvar(); desenharProduto(); desenharOfertas(); desenharResultado(); };
  $('#limpar').addEventListener('click', () =>
    pedir('Apagar o produto e todas as ofertas da lista?', 'Apagar e começar', () => {
      estado = { exemplo: false, produto: { nome: '', minimo: '', maxUnidades: '6' }, ofertas: [ofertaVazia()] };
      redesenhar();
      $('#produto-nome').focus();
    })
  );
  $('#ver-exemplo').addEventListener('click', () =>
    pedir('Trocar sua lista pelo exemplo do sabonete? Suas ofertas serão apagadas.', 'Trocar pelo exemplo', () => {
      estado = comIds(EXEMPLO);
      redesenhar();
    })
  );
}

iniciar();
