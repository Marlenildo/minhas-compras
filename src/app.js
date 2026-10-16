import {
  UNIDADES,
  lerNumero,
  lerTitulo,
  grupoDaOferta,
  compararOfertas,
  precoExibido,
  quantidadeDoAnuncio,
  fmtPct,
} from './core.js';
import { buscarProdutos, modoDemo } from './fontes.js';
import { fotoReserva } from './demo.js';

// ---------------------------------------------------------------------------
// Preferências (ficam neste aparelho; nada vai para servidor)
// ---------------------------------------------------------------------------

const CHAVE = 'minhas-compras:v2';
const PADRAO = {
  cep: '',
  minimo: '',
  maxUnidades: '6',
  filtros: { freteGratis: false, oficial: false },
  ordem: 'unidade',
  tamanhos: {},
  manuais: {},
  ultimaBusca: '',
};

function carregar() {
  try {
    const p = JSON.parse(localStorage.getItem(CHAVE) || 'null');
    if (p && typeof p === 'object') return { ...PADRAO, ...p, filtros: { ...PADRAO.filtros, ...(p.filtros || {}) } };
  } catch (_) {
    /* sem armazenamento */
  }
  return structuredClone(PADRAO);
}
const prefs = carregar();
function salvar() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(prefs));
  } catch (_) {
    /* o app funciona sem lembrar */
  }
}

const busca = { q: '', itens: [], verificadoEm: null, fontes: [], demo: false, aviso: '', carregando: false, erro: '' };
let editando = null; // id do item com o tamanho em edição

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

const $ = (s, r = document) => r.querySelector(s);
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const SIGLA = { volume: 'L', massa: 'kg', unidade: 'un', comprimento: 'm' };
const POR = { volume: 'litro', massa: 'quilo', unidade: 'unidade', comprimento: 'metro' };
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
const chaveBusca = (q) => q.trim().toLowerCase().replace(/\s+/g, ' ');

function fmtQtd(base, grupo) {
  if (grupo === 'volume') return base >= 1000 ? `${num(base / 1000)} L` : `${num(base)} ml`;
  if (grupo === 'massa') return base >= 1000 ? `${num(base / 1000)} kg` : `${num(base)} g`;
  if (grupo === 'comprimento') return `${num(base)} m`;
  return `${num(base)} un`;
}

function descricaoTamanho(i) {
  const total = fmtQtd(quantidadeDoAnuncio(i), grupoDaOferta(i));
  return i.embalagens > 1 ? `${total} · ${i.embalagens} × ${num(i.conteudo)} ${i.unidade}` : total;
}

function lerQuantidadeMinima(txt) {
  if (!txt || !String(txt).trim()) return 0;
  const lido = lerTitulo(txt);
  if (lido) return lido.embalagens * lido.conteudo * UNIDADES[lido.unidade].fator;
  return lerNumero(txt, 0);
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

function itensDaBusca() {
  const manuais = prefs.manuais[chaveBusca(busca.q)] || [];
  return [...busca.itens, ...manuais].map((i) => {
    const t = prefs.tamanhos[i.id];
    return t ? { ...i, ...t, fonteConteudo: 'voce' } : i;
  });
}

function calcular() {
  const itens = itensDaBusca();
  const comTamanho = itens.filter((i) => lerNumero(i.conteudo) > 0 && UNIDADES[i.unidade]);
  const semTamanho = itens.filter((i) => !(lerNumero(i.conteudo) > 0 && UNIDADES[i.unidade]));

  // O grupo (litro, quilo...) é o mais comum entre os resultados
  const contagem = {};
  for (const i of comTamanho) contagem[grupoDaOferta(i)] = (contagem[grupoDaOferta(i)] || 0) + 1;
  const grupo = Object.entries(contagem).sort((a, b) => b[1] - a[1])[0]?.[0] || 'volume';

  const filtrados = comTamanho.filter(
    (i) => (!prefs.filtros.freteGratis || i.freteGratis || i.frete === 0) && (!prefs.filtros.oficial || i.lojaOficial)
  );
  const ofertas = filtrados.map((i) => ({
    loja: i.loja,
    titulo: i.titulo,
    preco: i.preco,
    embalagens: i.embalagens || 1,
    conteudo: i.conteudo,
    unidade: i.unidade,
    frete: i.frete ?? 0,
    freteGratisAcima: i.freteGratisAcima || '',
    pixPct: i.pixPct || '',
    descontos: i.descontos || [],
    item: i,
  }));
  const res = compararOfertas(ofertas, {
    grupo,
    quantidadeMinima: lerQuantidadeMinima(prefs.minimo),
    maxUnidades: Math.max(1, Math.min(50, Math.round(lerNumero(prefs.maxUnidades, 6)) || 6)),
  });
  const melhor = res.ranking[0] || null;
  const lista = [...res.ranking];
  if (prefs.ordem === 'total') lista.sort((a, b) => a.escolhida.total - b.escolhida.total);
  return {
    grupo, melhor, lista, semTamanho,
    ocultos: comTamanho.length - filtrados.length,
    outraUnidade: res.ignoradas.length,
    temOficial: itens.some((i) => i.lojaOficial),
  };
}

// ---------------------------------------------------------------------------
// Pedaços da tela
// ---------------------------------------------------------------------------

const foto = (i, classe = '') =>
  `<img class="${classe}" src="${esc(i.foto || fotoReserva)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;

function chipFrete(i, e) {
  if (e?.ganhouFreteGratis) return `<span class="chip bom">Frete grátis levando ${e.n}</span>`;
  if (i.freteGratis || i.frete === 0) return '<span class="chip bom">Frete grátis</span>';
  if (i.frete == null) return `<span class="chip" title="Informe seu CEP para incluir o frete">Frete a calcular</span>`;
  return `<span class="chip">Frete ${brl(i.frete)}</span>`;
}

function chips(i, e) {
  const c = [chipFrete(i, e)];
  if (i.full) c.push('<span class="chip">Full</span>');
  if (i.lojaOficial) c.push('<span class="chip">Loja oficial</span>');
  if (e?.pctQtd > 0) c.push(`<span class="chip bom">−${fmtPct(e.pctQtd)} levando ${e.n}</span>`);
  if (e?.pctPix > 0) c.push(`<span class="chip">−${fmtPct(e.pctPix)} no Pix</span>`);
  if (i.fonte === 'manual') c.push('<span class="chip">Adicionado por você</span>');
  return c.join('');
}

function editorTamanho(i) {
  return `<form class="tamanho" data-tamanho="${esc(i.id)}">
    <label class="sr" for="tam-${esc(i.id)}">Tamanho do produto</label>
    <input id="tam-${esc(i.id)}" name="tamanho" placeholder="ex.: 900 ml ou 3 x 250 ml" autocomplete="off"
      value="${i.conteudo ? esc(`${i.embalagens > 1 ? `${i.embalagens} x ` : ''}${num(i.conteudo)} ${i.unidade}`) : ''}">
    <button type="submit">Usar</button>
    <p class="erro-campo" hidden></p>
  </form>`;
}

function htmlMelhor(r, grupo) {
  const i = r.oferta.item;
  const e = r.escolhida;
  const link = linkSeguro(i.link);
  const levar = e.n > 1 ? `Leve <strong>${e.n}</strong> · ` : '';
  return `<article class="melhor">
    <div class="melhor-foto">${foto(i)}</div>
    <div class="melhor-info">
      <span class="eyebrow">Melhor compra</span>
      <div class="etiqueta">
        <span class="etq-rotulo">Preço por ${POR[grupo]}</span>
        <span class="etq-valor">${brl(precoExibido(e.custoPorBase, grupo))}<small>/${SIGLA[grupo]}</small></span>
      </div>
      <h2 class="melhor-titulo">${esc(i.titulo)}</h2>
      <p class="melhor-loja">${esc(i.loja)}${i.vendedor ? ` · ${esc(i.vendedor)}` : ''}</p>
      <p class="melhor-conta">${levar}${brl(e.total)} por ${fmtQtd(e.quantidade, grupo)}${e.frete > 0 ? ` (com ${brl(e.frete)} de frete)` : ''}</p>
      <div class="chips">${chips(i, e)}</div>
      ${r.dicas.length ? `<p class="dica-boa">${esc(r.dicas[0])}</p>` : ''}
      ${link ? `<a class="botao" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Ver na loja <span aria-hidden="true">↗</span></a>` : ''}
    </div>
  </article>`;
}

function htmlCartao(r, grupo, melhor, pos) {
  const i = r.oferta.item;
  const e = r.escolhida;
  const link = linkSeguro(i.link);
  const delta = r === melhor ? '<span class="delta bom">Mais barato</span>' : `<span class="delta">+${fmtPct((e.custoPorBase / melhor.escolhida.custoPorBase - 1) * 100)} por ${SIGLA[grupo]}</span>`;
  return `<article class="cartao${r === melhor ? ' primeiro' : ''}">
    <div class="foto">${foto(i)}<span class="tag">${brl(precoExibido(e.custoPorBase, grupo))}<small>/${SIGLA[grupo]}</small></span><span class="pos">${pos}</span></div>
    <div class="info">
      <p class="loja">${esc(i.loja)}</p>
      <h3 class="titulo" title="${esc(i.titulo)}">${esc(i.titulo)}</h3>
      <p class="qtd">${esc(descricaoTamanho(i))}
        <button type="button" class="mini" data-editar="${esc(i.id)}">${i.fonteConteudo === 'voce' ? 'alterar' : 'corrigir'}</button></p>
      ${editando === i.id ? editorTamanho(i) : ''}
      <p class="preco">${i.precoOriginal > i.preco ? `<s>${brl(i.precoOriginal)}</s>` : ''}${brl(i.preco)}${e.n > 1 ? `<span class="leve"> · leve ${e.n}</span>` : ''}</p>
      <div class="chips">${chips(i, e)}</div>
      <div class="pe">
        ${delta}
        ${link ? `<a class="ver" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Ver na loja ↗</a>` : ''}
        ${i.fonte === 'manual' ? `<button type="button" class="mini perigo" data-remover="${esc(i.id)}">Remover</button>` : ''}
      </div>
    </div>
  </article>`;
}

function htmlSemTamanho(lista) {
  if (!lista.length) return '';
  return `<section class="sem-tamanho" aria-labelledby="t-sem">
    <h2 id="t-sem">Sem tamanho no anúncio</h2>
    <p class="nota">Não achei o tamanho nestes anúncios. Diga o tamanho e eles entram na comparação.</p>
    <ul>${lista
      .map(
        (i) => `<li>
          ${foto(i, 'mini-foto')}
          <div class="st-info">
            <p class="st-titulo">${esc(i.titulo)}</p>
            <p class="st-loja">${esc(i.loja)} · ${brl(lerNumero(i.preco))}</p>
            ${editorTamanho(i)}
          </div>
        </li>`
      )
      .join('')}</ul>
  </section>`;
}

function esqueleto() {
  return `<div class="grade-cartoes" aria-hidden="true">${'<div class="cartao esq"><div class="foto"></div><div class="info"><span></span><span></span><span></span></div></div>'.repeat(6)}</div>`;
}

// ---------------------------------------------------------------------------
// Desenho do resultado
// ---------------------------------------------------------------------------

function desenhar() {
  const alvo = $('#resultado');

  if (busca.carregando) {
    alvo.innerHTML = `<p class="status">Buscando ofertas de “${esc(busca.q)}”…</p>${esqueleto()}`;
    return;
  }
  if (busca.erro) {
    alvo.innerHTML = `<div class="aviso-erro" role="alert"><strong>A busca não deu certo.</strong> ${esc(busca.erro)}
      <button type="button" class="botao-sec" data-acao="repetir">Tentar de novo</button></div>`;
    return;
  }
  if (!busca.q) {
    alvo.innerHTML = '';
    return;
  }

  const { grupo, melhor, lista, semTamanho, ocultos, outraUnidade, temOficial } = calcular();
  const NOMES_FONTE = { google: 'Google Shopping', mercadolivre: 'Mercado Livre' };
  const via = (busca.fontes || []).map((f) => NOMES_FONTE[f] || f).join(' e ');
  const hora = busca.verificadoEm ? new Date(busca.verificadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  const total = lista.length + semTamanho.length;
  const extras = [];
  if (ocultos) extras.push(`${ocultos} escondida${ocultos > 1 ? 's' : ''} pelos filtros`);
  if (outraUnidade) extras.push(`${outraUnidade} em outra unidade`);

  alvo.innerHTML = `
    ${busca.aviso ? `<p class="faixa-demo">${esc(busca.aviso)}</p>` : ''}
    <p class="status">${total} oferta${total === 1 ? '' : 's'} para “${esc(busca.q)}”${via ? ` · via ${esc(via)}` : ''}${hora ? ` · conferido às ${hora}` : ''}${extras.length ? ` · ${extras.join(', ')}` : ''}</p>
    ${melhor ? htmlMelhor(melhor, grupo) : '<div class="vazio-bloco">Nenhuma oferta com tamanho conhecido passou pelos filtros.</div>'}
    <div class="barra-ferramentas">
      <div class="segmentado" role="group" aria-label="Ordenar">
        <button type="button" data-ordem="unidade" aria-pressed="${prefs.ordem === 'unidade'}">Preço por ${POR[grupo]}</button>
        <button type="button" data-ordem="total" aria-pressed="${prefs.ordem === 'total'}">Preço total</button>
      </div>
      <div class="filtros">
        <button type="button" class="filtro" data-filtro="freteGratis" aria-pressed="${prefs.filtros.freteGratis}">Frete grátis</button>
        ${temOficial || prefs.filtros.oficial ? `<button type="button" class="filtro" data-filtro="oficial" aria-pressed="${prefs.filtros.oficial}">Loja oficial</button>` : ''}
      </div>
    </div>
    ${melhor ? `<div class="grade-cartoes">${lista.map((r, k) => htmlCartao(r, grupo, melhor, k + 1)).join('')}</div>` : ''}
    ${htmlSemTamanho(semTamanho)}
    <details class="manual" id="manual">
      <summary>Achou em outra loja? Adicione aqui</summary>
      <form id="form-manual" class="form-manual">
        <label for="m-loja">Loja<input id="m-loja" name="loja" placeholder="Supermercado do bairro" autocomplete="off"></label>
        <label for="m-titulo" class="largo">Produto e tamanho<input id="m-titulo" name="titulo" placeholder="Sabonete líquido Marca X refil 900 ml" autocomplete="off"></label>
        <label for="m-preco">Preço<input id="m-preco" name="preco" inputmode="decimal" placeholder="21,90" autocomplete="off"></label>
        <label for="m-frete">Frete<input id="m-frete" name="frete" inputmode="decimal" placeholder="0 = grátis" autocomplete="off"></label>
        <label for="m-link" class="largo">Link (opcional)<input id="m-link" name="link" type="url" placeholder="https://…" autocomplete="off"></label>
        <p class="erro-campo largo" hidden></p>
        <button type="submit" class="botao">Adicionar à comparação</button>
      </form>
    </details>
    <p class="regras">O preço por ${POR[grupo]} soma o produto e o frete. O desconto no Pix não vale sobre o frete, e o frete grátis por valor mínimo é conferido depois do desconto por quantidade. Os preços mudam o tempo todo: confira na loja antes de pagar.</p>
  `;
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

async function executarBusca(q) {
  q = q.trim();
  if (q.length < 2) {
    $('#q').focus();
    return;
  }
  busca.q = q;
  busca.carregando = true;
  busca.erro = '';
  editando = null;
  prefs.ultimaBusca = q;
  salvar();
  desenhar();
  try {
    const r = await buscarProdutos(q, { cep: prefs.cep });
    Object.assign(busca, r, { carregando: false });
  } catch (e) {
    Object.assign(busca, { itens: [], carregando: false, erro: e.message });
  }
  desenhar();
}

function aoClicar(ev) {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.ordem) {
    prefs.ordem = b.dataset.ordem;
  } else if (b.dataset.filtro) {
    prefs.filtros[b.dataset.filtro] = !prefs.filtros[b.dataset.filtro];
  } else if (b.dataset.editar) {
    editando = editando === b.dataset.editar ? null : b.dataset.editar;
    desenhar();
    $(`[data-tamanho="${CSS.escape(b.dataset.editar)}"] input`)?.focus();
    return;
  } else if (b.dataset.remover) {
    const k = chaveBusca(busca.q);
    prefs.manuais[k] = (prefs.manuais[k] || []).filter((i) => i.id !== b.dataset.remover);
  } else if (b.dataset.acao === 'repetir') {
    executarBusca(busca.q);
    return;
  } else return;
  salvar();
  desenhar();
}

function erroNoForm(form, texto) {
  const p = $('.erro-campo', form);
  p.textContent = texto;
  p.hidden = !texto;
}

function aoEnviar(ev) {
  const form = ev.target;
  ev.preventDefault();
  if (form.dataset.tamanho) {
    const lido = lerTitulo(form.tamanho.value);
    if (!lido) return erroNoForm(form, 'Escreva o tamanho com a unidade, como 900 ml, 1 kg ou 3 x 250 ml.');
    prefs.tamanhos[form.dataset.tamanho] = lido;
    editando = null;
  } else if (form.id === 'form-manual') {
    const d = Object.fromEntries(new FormData(form));
    const preco = lerNumero(d.preco, 0);
    const lido = lerTitulo(d.titulo);
    if (!d.loja.trim()) return erroNoForm(form, 'Diga o nome da loja.');
    if (!(preco > 0)) return erroNoForm(form, 'Informe o preço, por exemplo 21,90.');
    if (!lido) return erroNoForm(form, 'Coloque o tamanho no nome do produto, como “refil 900 ml”.');
    const frete = d.frete.trim() === '' ? 0 : lerNumero(d.frete, 0);
    const k = chaveBusca(busca.q);
    prefs.manuais[k] = [
      ...(prefs.manuais[k] || []),
      {
        id: `manual:${Math.random().toString(36).slice(2, 9)}`,
        fonte: 'manual',
        loja: d.loja.trim(),
        titulo: d.titulo.trim(),
        preco,
        frete,
        freteGratis: frete === 0,
        link: d.link.trim(),
        foto: null,
        ...lido,
      },
    ];
  } else return;
  salvar();
  desenhar();
}

function iniciar() {
  const fCep = $('#cep');
  fCep.value = prefs.cep;
  $('#minimo').value = prefs.minimo;
  $('#max').value = prefs.maxUnidades;

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
  fCep.addEventListener('input', () => {
    const d = fCep.value.replace(/\D/g, '').slice(0, 8);
    fCep.value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
    prefs.cep = fCep.value;
    salvar();
  });
  fCep.addEventListener('change', () => {
    if (busca.q && !busca.demo && prefs.cep.replace(/\D/g, '').length === 8) executarBusca(busca.q);
  });
  for (const [id, chave] of [['minimo', 'minimo'], ['max', 'maxUnidades']]) {
    $(`#${id}`).addEventListener('input', (ev) => {
      prefs[chave] = ev.target.value;
      salvar();
      desenhar();
    });
  }
  $('#resultado').addEventListener('click', aoClicar);
  $('#resultado').addEventListener('submit', aoEnviar);

  // Foto que não carrega vira ilustração neutra
  document.addEventListener(
    'error',
    (ev) => {
      const img = ev.target;
      if (img.tagName === 'IMG' && img.src !== fotoReserva) img.src = fotoReserva;
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

  const inicial = prefs.ultimaBusca || (modoDemo() ? 'sabonete líquido Marca X' : '');
  if (inicial) {
    $('#q').value = inicial;
    executarBusca(inicial);
  }
}

iniciar();
