// Quanto uma oferta combina com a busca, e quanto duas ofertas se parecem.
// Funções puras, sem tela, para poderem ser testadas.

const PALAVRAS_VAZIAS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'com', 'para', 'pra', 'por', 'a', 'o', 'as', 'os', 'um', 'uma',
  'no', 'na', 'nos', 'nas', 'ao', 'sem', 'the', 'and', 'with', 'for', '-', 'original', 'novo', 'nova',
]);

/** Minúsculas, sem acento, só letras e números. */
export function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Tira plural simples: "sabonetes" → "sabonete", "refis" fica. */
function singular(p) {
  if (p.length > 4 && p.endsWith('oes')) return `${p.slice(0, -3)}ao`;
  if (p.length > 4 && p.endsWith('aes')) return `${p.slice(0, -3)}ao`;
  if (p.length > 4 && p.endsWith('res')) return p.slice(0, -2);
  if (p.length > 3 && p.endsWith('s') && !p.endsWith('ss')) return p.slice(0, -1);
  return p;
}

/** Palavras que importam numa busca ou título, sem repetidas. */
export function termos(texto) {
  const vistos = new Set();
  for (const p of normalizar(texto).split(' ')) {
    if (!p || PALAVRAS_VAZIAS.has(p)) continue;
    if (p.length < 2 && !/\d/.test(p)) continue;
    vistos.add(singular(p));
  }
  return [...vistos];
}

/** Uma palavra da busca aparece no título? Aceita plural, começo de palavra e palavras grudadas ("nutri milk" = "nutrimilk"). */
function aparece(termo, palavrasTitulo, tituloColado) {
  if (palavrasTitulo.has(termo)) return true;
  if (tituloColado.includes(termo) && termo.length >= 4) return true;
  const numerico = /\d/.test(termo);
  for (const p of palavrasTitulo) {
    if (termo.length >= 4 && p.startsWith(termo)) return true;
    // Modelo: "520" casa com "520bt", mas "52" não casa com "520"
    if (numerico && p.startsWith(termo) && !/\d/.test(p[termo.length] || '')) return true;
    if (p.length >= 5 && termo.startsWith(p) && termo.length - p.length <= 2) return true;
  }
  return false;
}

/** Fração (0 a 1) das palavras da busca que aparecem no título. */
export function combina(titulo, busca) {
  const t = termos(busca);
  if (!t.length) return 1;
  const palavras = new Set(termos(titulo));
  const colado = normalizar(titulo).replace(/ /g, '');
  const achadas = t.filter((x) => aparece(x, palavras, colado)).length;
  return achadas / t.length;
}

// Palavras que costumam faltar no título sem mudar o produto: "fone (de ouvido)"
const OPCIONAIS = { ouvido: ['fone'] };

function termosObrigatorios(busca) {
  const t = termos(busca);
  return t.filter((x) => !(OPCIONAIS[x] && OPCIONAIS[x].some((y) => t.includes(y))));
}

/**
 * A oferta é do assunto da busca?
 * Até 3 palavras na busca: todas precisam aparecer. Com mais: pode faltar 1 a cada 4.
 */
export function eRelevante(titulo, busca) {
  const obrigatorios = termosObrigatorios(busca);
  const n = obrigatorios.length;
  if (!n) return true;
  const minimo = n <= 3 ? 1 : (n - Math.floor(n / 4)) / n;
  return combina(titulo, obrigatorios.join(' ')) >= minimo - 1e-9;
}

/** Parecença entre dois títulos (0 a 1): palavras em comum sobre o total do menor. */
export function parecenca(a, b) {
  const ta = new Set(termos(a));
  const tb = new Set(termos(b));
  if (!ta.size || !tb.size) return 0;
  let comum = 0;
  for (const x of ta) if (tb.has(x)) comum++;
  return comum / Math.min(ta.size, tb.size);
}

export const LIMIAR_PARECIDO = 0.6;

const RUIDO_PARECIDO = /^(kit|combo|pack|leve|pague|cx|caixa|c\/|und|unid|unidades?|pcs|pecas|x)$/;
const TAMANHO = /^\d+([.,]\d+)?(ml|l|lt|g|gr|kg|un|m|cm|mm|w|v|gb|tb)?$/;

/** Busca curta para "mais parecidos nas lojas": marca e tipo do produto, sem kit, quantidade e tamanho. */
export function buscaParecida(titulo, max = 6) {
  return String(titulo || '')
    .replace(/[|•–—,;()[\]]/g, ' ')
    .split(/\s+/)
    .filter((p) => {
      const n = normalizar(p).replace(/ /g, '');
      return n && !PALAVRAS_VAZIAS.has(n) && !RUIDO_PARECIDO.test(n) && !TAMANHO.test(n);
    })
    .slice(0, max)
    .join(' ');
}
