// Dados de demonstração: produtos e preços fictícios, usados quando o
// servidor de busca não está disponível (por exemplo, na página publicada no Claude).
// As imagens são ilustrações desenhadas aqui, não fotos de produtos reais.

function svg(conteudo, fundo) {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="${fundo}"/>${conteudo}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
}

const frasco = (x, y, e, cor) => `
  <g transform="translate(${x} ${y}) scale(${e})">
    <rect x="-6" y="-78" width="12" height="18" rx="2" fill="#2b2f2d"/>
    <path d="M-6 -74 h-22 a6 6 0 0 0 -6 6 v3 h6 v-3 h22z" fill="#2b2f2d"/>
    <rect x="-14" y="-62" width="28" height="12" rx="3" fill="#3c423f"/>
    <path d="M-30 -48 q0 -6 8 -6 h44 q8 0 8 6 v96 q0 10 -10 10 h-40 q-10 0 -10 -10z" fill="${cor}"/>
    <rect x="-20" y="-20" width="40" height="34" rx="4" fill="#ffffff" opacity=".85"/>
    <rect x="-14" y="-12" width="28" height="4" rx="2" fill="${cor}" opacity=".8"/>
    <rect x="-14" y="-3" width="20" height="3" rx="1.5" fill="#9aa5a0"/>
  </g>`;

const refil = (x, y, e, cor) => `
  <g transform="translate(${x} ${y}) scale(${e})">
    <path d="M-40 -60 h80 l6 112 q1 10 -9 10 h-74 q-10 0 -9 -10z" fill="${cor}"/>
    <rect x="-40" y="-66" width="80" height="10" rx="2" fill="${cor}" opacity=".7"/>
    <rect x="12" y="-80" width="16" height="16" rx="3" fill="#2b2f2d"/>
    <rect x="-26" y="-18" width="52" height="40" rx="5" fill="#ffffff" opacity=".85"/>
    <rect x="-18" y="-9" width="36" height="5" rx="2.5" fill="${cor}" opacity=".85"/>
  </g>`;

const fone = (cor, corAlmofada) => `
  <g transform="translate(100 104)">
    <path d="M-58 10 v-18 a58 58 0 0 1 116 0 v18" fill="none" stroke="${cor}" stroke-width="12" stroke-linecap="round"/>
    <rect x="-74" y="0" width="34" height="58" rx="14" fill="${cor}"/>
    <rect x="40" y="0" width="34" height="58" rx="14" fill="${cor}"/>
    <rect x="-66" y="8" width="18" height="42" rx="8" fill="${corAlmofada}"/>
    <rect x="48" y="8" width="18" height="42" rx="8" fill="${corAlmofada}"/>
  </g>`;

const foneIntra = (cor) => `
  <g transform="translate(100 100)">
    <rect x="-50" y="-26" width="100" height="62" rx="28" fill="${cor}"/>
    <rect x="-50" y="-26" width="100" height="22" rx="11" fill="#ffffff" opacity=".25"/>
    <circle cx="-22" cy="-44" r="16" fill="${cor}"/><rect x="-26" y="-44" width="8" height="34" rx="4" fill="${cor}"/>
    <circle cx="22" cy="-44" r="16" fill="${cor}"/><rect x="18" y="-44" width="8" height="34" rx="4" fill="${cor}"/>
    <circle cx="0" cy="22" r="3" fill="#ffffff" opacity=".8"/>
  </g>`;

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
  id: `demo:${++seq}`,
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
  token: `demo-${seq}`,
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
    item('Mercado Livre', 'Kit 3 Sabonete Líquido Marca X Algodão 250ml', 29.9, {
      foto: img.kit3('algodao'), freteGratis: true, frete: 0, embalagens: 3, conteudo: 250, unidade: 'ml', precoOriginal: 34.9, avaliacao: 4.8, avaliacoes: 2140,
    }),
    item('Mercado Livre', 'Sabonete Líquido Marca X Erva-doce Refil 900ml', 21.49, {
      foto: img.refil('erva'), frete: null, embalagens: 1, conteudo: 900, unidade: 'ml', avaliacao: 4.7, avaliacoes: 860,
    }),
    item('Amazon', 'Sabonete Líquido Marca X Lavanda Refil 2x900ml', 39.9, {
      foto: img.refil2('lavanda'), freteGratis: true, frete: 0, embalagens: 2, conteudo: 900, unidade: 'ml', precoOriginal: 47.8, avaliacao: 4.8, avaliacoes: 5310,
    }),
    item('Amazon', 'Sabonete Líquido Marca X Lavanda 650ml com válvula', 19.9, {
      foto: img.frasco('lavanda'), freteGratis: true, frete: 0, embalagens: 1, conteudo: 650, unidade: 'ml', avaliacao: 4.6, avaliacoes: 1205,
    }),
    item('Magalu', 'Sabonete Líquido Marca X Mel Refil 900 ml', 23.9, {
      foto: img.refil('mel'), frete: 14.9, embalagens: 1, conteudo: 900, unidade: 'ml', avaliacao: 4.5, avaliacoes: 312,
    }),
    item('Drogasil', 'Sabonete Líquido Marca X Algodão Refil 1L', 27.9, {
      foto: img.refil('algodao'), freteGratis: true, frete: 0, embalagens: 1, conteudo: 1, unidade: 'l', avaliacao: 4.7, avaliacoes: 98,
    }),
    item('Carrefour', 'Sabonete Líquido Marca X Mel 400 ml', 12.9, {
      foto: img.frascoPequeno('mel'), frete: 6.9, embalagens: 1, conteudo: 400, unidade: 'ml', avaliacao: 4.4, avaliacoes: 57,
    }),
    item('Magalu', 'Kit 6 Sabonete Líquido Marca X Erva-doce 250ml', 54.9, {
      foto: img.kit3('erva'), freteGratis: true, frete: 0, embalagens: 6, conteudo: 250, unidade: 'ml', avaliacao: 4.9, avaliacoes: 420,
    }),
    // Fora do assunto: o Google às vezes mistura produtos parecidos, e mais baratos
    item('Drogasil', 'Hidratante Corporal Marca X Algodão 400ml', 9.9, {
      foto: img.frascoPequeno('algodao'), freteGratis: true, frete: 0, embalagens: 1, conteudo: 400, unidade: 'ml', avaliacao: 4.6, avaliacoes: 3100,
    }),
    item('Carrefour', 'Sabonete em Barra Marca Z Erva-doce 90g', 2.49, {
      foto: img.frascoPequeno('erva'), frete: 6.9, embalagens: 1, conteudo: 90, unidade: 'g', avaliacao: 4.3, avaliacoes: 88,
    }),
  ];
}

function fones() {
  return [
    item('Amazon', 'Fone de Ouvido Bluetooth Marca Y Over-ear com Cancelamento de Ruído', 389.9, {
      foto: img.fonePreto, freteGratis: true, frete: 0, precoOriginal: 499, avaliacao: 4.7, avaliacoes: 8320,
    }),
    item('Magalu', 'Fone de Ouvido Bluetooth Marca Y Over-ear com Cancelamento de Ruído', 379, {
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
    item('Amazon', 'Fone Intra-auricular Bluetooth Marca V Branco à prova d’água', 119, {
      foto: img.intraBranco, freteGratis: true, frete: 0, precoOriginal: 149, avaliacao: 4.6, avaliacoes: 1520,
    }),
    item('Fast Shop', 'Fone de Ouvido Bluetooth Marca Y Over-ear Edição Azul', 429, {
      foto: img.foneAzul, freteGratis: true, frete: 0, avaliacao: 4.8, avaliacoes: 230,
    }),
  ];
}

const ehFone = (q) => /fone|headphone|headset|earbud|ouvido/i.test(q);

/** Resultados de demonstração para uma busca. */
export function buscaDemo(q) {
  seq = 0;
  const fone = ehFone(q);
  const conhecida = fone || /sabonete|sab[aã]o|refil/i.test(q);
  return {
    itens: fone ? fones() : sabonetes(),
    // Como os filtros que o Google devolve junto com a busca
    filtros: fone
      ? [{ nome: 'Marca', opcoes: ['Marca Y', 'Marca Z', 'Marca W', 'Marca V'] }, { nome: 'Tipo', opcoes: ['Over-ear', 'On-ear', 'Intra-auricular'] }]
      : [{ nome: 'Fragrância', opcoes: ['Lavanda', 'Mel', 'Algodão', 'Erva-doce'] }],
    aviso: conhecida
      ? 'Demonstração: produtos e preços fictícios.'
      : 'Demonstração: esta versão só tem dois exemplos (sabonete líquido e fone bluetooth), com preços fictícios. Mostrando o sabonete.',
  };
}

/** Lojas de demonstração para um produto: variações de preço e frete em torno da oferta. */
export function lojasDemo(item) {
  const base = item.preco;
  const lojas = [
    { loja: item.loja, preco: base, frete: item.frete ?? 0, freteGratis: item.freteGratis, parcelas: base > 100 ? `10x de ${(base / 10).toFixed(2).replace('.', ',')} sem juros` : null },
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

/** Ilustração neutra para quando a foto real não carregar. */
export const fotoReserva = svg(
  `<g transform="translate(100 100)" fill="none" stroke="#9aa5a0" stroke-width="6" stroke-linejoin="round"><path d="M-40 -20 h80 v60 h-80z"/><path d="M-40 -20 l40 -22 l40 22"/></g>`,
  '#eef1ef'
);
