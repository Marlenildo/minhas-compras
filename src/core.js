// Motor de cálculo do app de compras.
// Funções puras, sem dependência de tela, para poderem ser testadas
// e reaproveitadas depois (app de celular, servidor, extensão etc.).

/** Unidades aceitas e como cada uma vira a unidade base do seu grupo. */
export const UNIDADES = {
  ml: { grupo: 'volume', fator: 1 },
  l: { grupo: 'volume', fator: 1000 },
  g: { grupo: 'massa', fator: 1 },
  kg: { grupo: 'massa', fator: 1000 },
  un: { grupo: 'unidade', fator: 1 },
  m: { grupo: 'comprimento', fator: 1 },
};

/** Como mostrar o preço de cada grupo: por litro, por kg, por unidade, por metro. */
export const EXIBICAO = {
  volume: { fator: 1000, rotulo: 'litro', base: 'ml' },
  massa: { fator: 1000, rotulo: 'kg', base: 'g' },
  unidade: { fator: 1, rotulo: 'unidade', base: 'un' },
  comprimento: { fator: 1, rotulo: 'metro', base: 'm' },
};

const num = (v, padrao = 0) => {
  if (v === null || v === undefined || v === '') return padrao;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : padrao;
};

/** Lê um número digitado no formato brasileiro ("1.234,56") ou internacional ("1234.56"). */
export function lerNumero(v, padrao = 0) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : padrao;
  if (v === null || v === undefined) return padrao;
  const s = String(v).trim().replace(/^r\$\s*/i, '');
  if (s === '') return padrao;
  // "1.234,56" → vírgula decimal; "1234.56" → ponto decimal
  if (s.includes(',')) return num(s, padrao);
  const n = Number(s);
  return Number.isFinite(n) ? n : padrao;
}

/** Quantidade total do anúncio na unidade base (ml, g, un, m). */
export function quantidadeDoAnuncio(oferta) {
  const u = UNIDADES[oferta.unidade] || UNIDADES.ml;
  const embalagens = Math.max(1, lerNumero(oferta.embalagens, 1));
  return embalagens * lerNumero(oferta.conteudo, 0) * u.fator;
}

export function grupoDaOferta(oferta) {
  return (UNIDADES[oferta.unidade] || UNIDADES.ml).grupo;
}

/** Maior desconto por quantidade válido para n unidades compradas. */
export function descontoPorQuantidade(descontos, n) {
  let melhor = 0;
  for (const d of descontos || []) {
    const min = lerNumero(d.minQtd, 0);
    const pct = lerNumero(d.pct, 0);
    if (min > 0 && n >= min && pct > melhor) melhor = pct;
  }
  return Math.min(melhor, 100);
}

/**
 * Custo de comprar n anúncios de uma oferta.
 * Regras:
 * - desconto por quantidade vale sobre o valor dos produtos;
 * - frete grátis é conferido sobre o valor dos produtos já com esse desconto
 *   (é assim que lojas como Mercado Livre e Amazon comparam com o mínimo);
 * - desconto no Pix vale sobre os produtos, não sobre o frete;
 * - o frete informado é o do pedido, não por unidade.
 */
export function custoParaQuantidade(oferta, n) {
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

/** Uma oferta só entra no cálculo se tiver preço e conteúdo. */
export function ofertaValida(oferta) {
  return lerNumero(oferta.preco, 0) > 0 && quantidadeDoAnuncio(oferta) > 0;
}

/**
 * Escolhe, para uma oferta, quantas unidades vale a pena comprar.
 * - respeita a quantidade mínima que a pessoa precisa;
 * - não passa do máximo de unidades que ela aceita comprar;
 * - se levar mais economiza menos que a tolerância (padrão 1%), fica com menos.
 */
export function melhorCompraDaOferta(oferta, { quantidadeMinima = 0, maxUnidades = 10, tolerancia = 0.01 } = {}) {
  if (!ofertaValida(oferta)) return null;
  const porAnuncio = quantidadeDoAnuncio(oferta);
  const minimoN = Math.max(1, Math.ceil(lerNumero(quantidadeMinima, 0) / porAnuncio - 1e-9));
  const maxN = Math.max(minimoN, Math.floor(lerNumero(maxUnidades, 10)));
  const opcoes = [];
  for (let n = minimoN; n <= maxN; n++) opcoes.push(custoParaQuantidade(oferta, n));

  let melhor = opcoes[0];
  for (const o of opcoes) if (o.custoPorBase < melhor.custoPorBase - 1e-12) melhor = o;
  // Prefere a menor quantidade que fique dentro da tolerância da melhor
  const escolhida = opcoes.find((o) => o.custoPorBase <= melhor.custoPorBase * (1 + tolerancia)) || melhor;
  const minima = opcoes[0];
  return { oferta, escolhida, minima, opcoes, dicas: dicasDaOferta(oferta, minima, escolhida) };
}

const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Frases curtas que explicam por que levar mais (ou o que falta para o frete grátis). */
export function dicasDaOferta(oferta, minima, escolhida) {
  const dicas = [];
  if (escolhida.n > minima.n) {
    const economia = 1 - escolhida.custoPorBase / minima.custoPorBase;
    const motivos = [];
    if (escolhida.pctQtd > minima.pctQtd) motivos.push(`${fmtPct(escolhida.pctQtd)} de desconto por quantidade`);
    if (escolhida.ganhouFreteGratis && !minima.ganhouFreteGratis) motivos.push('frete grátis');
    dicas.push(
      `Levando ${escolhida.n} em vez de ${minima.n}, cada ${EXIBICAO[grupoDaOferta(oferta)].rotulo} sai ${fmtPct(economia * 100)} mais barato` +
        (motivos.length ? ` (${motivos.join(' e ')}).` : '.')
    );
  }
  if (escolhida.faltaParaFreteGratis > 0) {
    dicas.push(`Faltam ${brl(escolhida.faltaParaFreteGratis)} em produtos para o frete grátis nesta loja.`);
  }
  return dicas;
}

export function fmtPct(v) {
  const arred = Math.round(v * 10) / 10;
  return `${arred.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

/**
 * Compara todas as ofertas e devolve o ranking do menor custo real.
 * Ofertas de outro grupo de unidade (ex.: gramas quando o produto é em ml)
 * ficam de fora e são avisadas.
 */
export function compararOfertas(ofertas, opcoes = {}) {
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

/** Preço na unidade de exibição (por litro, por kg...). */
export function precoExibido(custoPorBase, grupo) {
  return custoPorBase * EXIBICAO[grupo].fator;
}

// ---------------------------------------------------------------------------
// Leitura do título do anúncio
// ---------------------------------------------------------------------------

const RX_UNIDADE = '(ml|mililitros?|l|lt|litros?|g|gr|gramas?|kg|quilos?)';
const MAPA_UNIDADE = (u) => {
  u = u.toLowerCase();
  if (u.startsWith('ml') || u.startsWith('mili')) return 'ml';
  if (u === 'l' || u === 'lt' || u.startsWith('litro')) return 'l';
  if (u === 'kg' || u.startsWith('quilo')) return 'kg';
  return 'g';
};
const FIM = '(?![a-zà-ú])';

/**
 * Tenta descobrir no título quantas embalagens vêm e o conteúdo de cada uma.
 * Ex.: "Kit 3 Sabonete Líquido 250ml" → { embalagens: 3, conteudo: 250, unidade: 'ml' }
 *      "Refil 2x900 ml"               → { embalagens: 2, conteudo: 900, unidade: 'ml' }
 * Devolve null quando não encontra o conteúdo.
 */
export function lerTitulo(titulo) {
  if (!titulo) return null;
  const t = String(titulo).toLowerCase().replace(/\s+/g, ' ');

  // "2x500ml", "2 x 500 ml", "2 un x 500ml"
  const mx = t.match(new RegExp(`(\\d+)\\s*(?:un\\w*\\s*)?[x×]\\s*(\\d+(?:[.,]\\d+)?)\\s*${RX_UNIDADE}${FIM}`));
  if (mx) {
    return { embalagens: Number(mx[1]), conteudo: lerNumero(mx[2]), unidade: MAPA_UNIDADE(mx[3]) };
  }
  // "500ml x 2"
  const mx2 = t.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${RX_UNIDADE}${FIM}\\s*[x×]\\s*(\\d+)`));
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
    /\bc\/\s*(\d+)/,
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
