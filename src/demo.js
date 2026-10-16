// Dados de demonstração: produtos e preços fictícios, usados quando o
// servidor de busca ainda não está ligado. As imagens são ilustrações
// desenhadas aqui mesmo, não fotos de produtos reais.

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
    <path d="M-24 -40 v70" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".35"/>
  </g>`;

const refil = (x, y, e, cor) => `
  <g transform="translate(${x} ${y}) scale(${e})">
    <path d="M-40 -60 h80 l6 112 q1 10 -9 10 h-74 q-10 0 -9 -10z" fill="${cor}"/>
    <rect x="-40" y="-66" width="80" height="10" rx="2" fill="${cor}" opacity=".7"/>
    <rect x="12" y="-80" width="16" height="16" rx="3" fill="#2b2f2d"/>
    <rect x="-26" y="-18" width="52" height="40" rx="5" fill="#ffffff" opacity=".85"/>
    <rect x="-18" y="-9" width="36" height="5" rx="2.5" fill="${cor}" opacity=".85"/>
    <rect x="-18" y="1" width="24" height="3" rx="1.5" fill="#9aa5a0"/>
    <text x="0" y="40" font-family="Arial, sans-serif" font-size="9" font-weight="700" text-anchor="middle" fill="#ffffff">REFIL</text>
  </g>`;

const CORES = { lavanda: '#8c7ac9', erva: '#4f9b78', algodao: '#5f93c6', mel: '#d39b3a' };
const FUNDOS = { lavanda: '#efedf8', erva: '#e8f3ee', algodao: '#e9f0f8', mel: '#f8f0e2' };

const img = {
  frasco: (c) => svg(frasco(100, 112, 1, CORES[c]), FUNDOS[c]),
  frascoPequeno: (c) => svg(frasco(100, 120, 0.8, CORES[c]), FUNDOS[c]),
  refil: (c) => svg(refil(100, 112, 1, CORES[c]), FUNDOS[c]),
  refil2: (c) => svg(refil(72, 116, 0.82, CORES[c]) + refil(128, 116, 0.82, CORES[c]), FUNDOS[c]),
  kit3: (c) => svg(frasco(56, 124, 0.68, CORES[c]) + frasco(100, 118, 0.74, CORES[c]) + frasco(144, 124, 0.68, CORES[c]), FUNDOS[c]),
};

const item = (id, loja, titulo, preco, extra) => ({
  id: `demo:${id}`,
  fonte: 'demo',
  loja,
  vendedor: null,
  lojaOficial: false,
  titulo,
  preco,
  precoOriginal: null,
  foto: null,
  link: '',
  condicao: 'new',
  freteGratis: false,
  frete: null,
  full: false,
  embalagens: null,
  conteudo: null,
  unidade: null,
  ...extra,
});

export function itensDemo() {
  return [
    item(1, 'Mercado Livre', 'Kit 3 Sabonete Líquido Marca X Algodão 250ml', 29.9, {
      foto: img.kit3('algodao'), freteGratis: true, frete: 0, full: true, lojaOficial: true, vendedor: 'Loja oficial Marca X',
      embalagens: 3, conteudo: 250, unidade: 'ml', precoOriginal: 34.9,
    }),
    item(2, 'Mercado Livre', 'Sabonete Líquido Marca X Erva-doce Refil 900ml', 21.49, {
      foto: img.refil('erva'), frete: 8.9, embalagens: 1, conteudo: 900, unidade: 'ml', vendedor: 'Casa & Limpeza',
    }),
    item(3, 'Mercado Livre', 'Sabonete Líquido Marca X Lavanda Refil 2x900ml', 39.9, {
      foto: img.refil2('lavanda'), freteGratis: true, frete: 0, full: true, embalagens: 2, conteudo: 900, unidade: 'ml',
      vendedor: 'Atacado Bem Limpo', precoOriginal: 47.8,
    }),
    item(4, 'Amazon', 'Sabonete Líquido Marca X Lavanda 650ml com válvula', 19.9, {
      foto: img.frasco('lavanda'), freteGratis: true, frete: 0, embalagens: 1, conteudo: 650, unidade: 'ml',
      descontos: [{ minQtd: 5, pct: 5 }, { minQtd: 10, pct: 10 }],
    }),
    item(5, 'Magalu', 'Sabonete Líquido Marca X Mel Refil 900 ml', 23.9, {
      foto: img.refil('mel'), frete: 14.9, freteGratisAcima: 99, embalagens: 1, conteudo: 900, unidade: 'ml',
    }),
    item(6, 'Amazon', 'Sabonete Líquido Marca X Algodão Refil 1L', 27.9, {
      foto: img.refil('algodao'), freteGratis: true, frete: 0, embalagens: 1, conteudo: 1, unidade: 'l',
    }),
    item(7, 'Farmácia online', 'Sabonete Líquido Marca X Lavanda Hidratante', 18.9, {
      foto: img.frascoPequeno('lavanda'), frete: 0, freteGratis: true,
    }),
    item(8, 'Mercado Livre', 'Kit 6 Sabonete Líquido Marca X Erva-doce 250ml', 54.9, {
      foto: img.kit3('erva'), freteGratis: true, frete: 0, lojaOficial: true, vendedor: 'Loja oficial Marca X',
      embalagens: 6, conteudo: 250, unidade: 'ml',
    }),
    item(9, 'Magalu', 'Sabonete Líquido Marca X Mel 400 ml', 12.9, {
      foto: img.frascoPequeno('mel'), frete: 6.9, freteGratisAcima: 99, embalagens: 1, conteudo: 400, unidade: 'ml', pixPct: 5,
    }),
  ];
}

/** Ilustração neutra para quando a foto real não carregar. */
export const fotoReserva = svg(frasco(100, 112, 1, '#9aa5a0'), '#eef1ef');
