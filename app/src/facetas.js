// Filtros que mudam conforme a busca: os do Google (marca, cor, tipo...) e os
// que o app monta lendo os títulos (tamanho, kit, cor, características).
// Funções puras, sem tela.
import { normalizar, termos, combina } from './relevancia.js';

const CORES = [
  ['preto', 'Preto'], ['preta', 'Preto'], ['branco', 'Branco'], ['branca', 'Branco'], ['azul', 'Azul'], ['vermelho', 'Vermelho'],
  ['vermelha', 'Vermelho'], ['verde', 'Verde'], ['rosa', 'Rosa'], ['pink', 'Rosa'], ['cinza', 'Cinza'], ['grafite', 'Grafite'],
  ['prata', 'Prata'], ['dourado', 'Dourado'], ['dourada', 'Dourado'], ['amarelo', 'Amarelo'], ['amarela', 'Amarelo'],
  ['roxo', 'Roxo'], ['roxa', 'Roxo'], ['lilas', 'Lilás'], ['bege', 'Bege'], ['marrom', 'Marrom'], ['laranja', 'Laranja'],
  ['nude', 'Nude'], ['transparente', 'Transparente'], ['vinho', 'Vinho'], ['creme', 'Creme'], ['off white', 'Off-white'],
  ['black', 'Preto'], ['white', 'Branco'], ['blue', 'Azul'], ['red', 'Vermelho'], ['green', 'Verde'], ['gray', 'Cinza'], ['silver', 'Prata'],
];

// Palavras comuns demais para virar filtro
const GENERICAS = new Set([
  'kit', 'combo', 'unidade', 'unidad', 'un', 'und', 'marca', 'original', 'novo', 'nova', 'produto', 'oferta', 'promocao', 'frete', 'gratis',
  'envio', 'imediato', 'pronta', 'entrega', 'lancamento', 'qualidade', 'premium', 'top', 'super', 'mega', 'mais', 'tamanho', 'cor',
  'linha', 'modelo', 'tipo', 'pacote', 'caixa', 'cx', 'ml', 'kg', 'gr', 'lt', 'litro', 'ate', 'cada', 'leve', 'pague', 'brasil', 'oficial',
]);

// Grupos do Google que o app já cobre de outro jeito (preço, loja, frete, promoção, avaliação...)
const GRUPO_IGNORADO = /pre[cç]o|price|loja|store|seller|vendedor|merchant|frete|shipping|entrega|delivery|promo|sale|deal|oferta|avalia|rating|review|condi|used|usado|refine|refinar|nearby|perto|hoje|today|small business/i;

/** Filtros do Google, já limpos: [{ nome, opcoes: [texto] }]. */
export function limparFiltrosGoogle(filtros) {
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
  const t = ` ${normalizar(titulo)} `;
  const achadas = new Set();
  for (const [palavra, rotulo] of CORES) if (t.includes(` ${palavra} `)) achadas.add(rotulo);
  return [...achadas];
}

/**
 * Palavras inteiras do título: "Over-ear" vira uma chave só ("overear"), com a grafia original.
 * Devolve Map(chave → { grafia, partes }).
 */
function palavrasDoTitulo(titulo) {
  const mapa = new Map();
  for (const p of String(titulo || '').split(/[\s/|,;()[\]+]+/)) {
    const limpa = p.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!limpa) continue;
    const partes = termos(limpa);
    if (!partes.length) continue;
    const chave = partes.join('');
    if (!mapa.has(chave)) mapa.set(chave, { grafia: limpa, partes });
  }
  return mapa;
}

/**
 * A opção de filtro aparece no título? Como frase inteira ("Marca Z", "Over-ear"),
 * ou grudada ("Nutri Milk" = "nutrimilk"), ou, se tiver 2+ palavras que importam, todas elas.
 */
export function opcaoNoTitulo(titulo, opcao) {
  const t = ` ${normalizar(titulo)} `;
  const o = normalizar(opcao);
  if (!o) return false;
  if (t.includes(` ${o} `)) return true;
  const oc = o.replace(/ /g, '');
  if (oc.length >= 4 && t.replace(/ /g, '').includes(oc)) return true;
  return termos(opcao).length >= 2 && combina(titulo, opcao) === 1;
}

const capitalizar = (s) => (s === s.toLowerCase() ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Monta os grupos de filtro para as ofertas de uma busca.
 * itens: [{ id, titulo, qtd, grupo, embalagens, rotuloTamanho }]
 * Devolve [{ id, nome, opcoes: [{ valor, rotulo, n }] }] e um mapa id da oferta → { grupo → Set(valores) }.
 */
export function montarFacetas(itens, { busca = '', filtrosGoogle = [] } = {}) {
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

  // 1. Filtros do Google (marca, cor, tipo...): a opção vale se aparece no título
  filtrosGoogle.forEach((f, k) => {
    const id = `g${k}`;
    for (const i of itens) for (const op of f.opcoes) if (opcaoNoTitulo(i.titulo, op)) marcar(id, i, op);
    const n = contar(id);
    const opcoes = f.opcoes.filter((op) => n.get(op)).map((op) => ({ valor: op, rotulo: op, n: n.get(op) }));
    if (opcoes.length >= 2 || (opcoes.length === 1 && opcoes[0].n < itens.length)) grupos.push({ id, nome: f.nome, opcoes });
  });
  const palavrasDoGoogle = new Set(filtrosGoogle.flatMap((f) => f.opcoes.flatMap((o) => termos(o))));

  // 2. Tamanho (quantidade total do anúncio)
  for (const i of itens) if (i.rotuloTamanho) marcar('tamanho', i, i.rotuloTamanho);
  {
    const n = contar('tamanho');
    const base = new Map(itens.filter((i) => i.rotuloTamanho).map((i) => [i.rotuloTamanho, `${i.grupo}:${i.qtd}`]));
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
    marcar('pacote', i, i.embalagens > 1 ? (i.embalagens >= 6 ? 'Kit com 6 ou mais' : `Kit com ${i.embalagens}`) : 'Avulso');
  }
  {
    const n = contar('pacote');
    const ordem = (v) => (v === 'Avulso' ? 0 : Number(v.match(/\d+/)?.[0] || 99));
    const opcoes = [...n.entries()].sort((a, b) => ordem(a[0]) - ordem(b[0])).map(([v, c]) => ({ valor: v, rotulo: v, n: c }));
    if (opcoes.length >= 2) grupos.push({ id: 'pacote', nome: 'Kit ou avulso', opcoes });
  }

  // 4. Cor (se o Google já não trouxe cor)
  if (!grupos.some((g) => /cor|color/i.test(g.nome))) {
    for (const i of itens) for (const c of coresDoTitulo(i.titulo)) marcar('cor', i, c);
    const n = contar('cor');
    const opcoes = [...n.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => ({ valor: v, rotulo: v, n: c }));
    if (opcoes.length >= 2) grupos.push({ id: 'cor', nome: 'Cor', opcoes });
  }

  // 5. Características: palavras que aparecem em várias ofertas, mas não em todas
  if (itens.length >= 4) {
    const daBusca = new Set(termos(busca));
    const cores = new Set(CORES.map(([p]) => p));
    const grafia = new Map();
    const conta = new Map();
    const chavesPorItem = new Map();
    const ignorar = (t, partes) =>
      t.length < 3 || /\d/.test(t) || cores.has(t) || palavrasDoGoogle.has(t) ||
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
      grupos.push({ id: 'carac', nome: 'Características', opcoes: escolhidas.map((t) => ({ valor: t, rotulo: grafia.get(t), n: n.get(t) || 0 })) });
    }
  }

  return { grupos, valores };
}

/**
 * A oferta passa nos filtros escolhidos? Dentro de um grupo vale qualquer opção marcada;
 * entre grupos, precisa passar em todos.
 */
export function passaNasFacetas(valoresDaOferta, escolhidas) {
  for (const [grupo, set] of Object.entries(escolhidas)) {
    if (!set || !set.size) continue;
    const tem = valoresDaOferta?.[grupo];
    if (!tem || ![...set].some((v) => tem.has(v))) return false;
  }
  return true;
}
