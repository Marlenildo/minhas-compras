// De onde vêm os produtos: o servidor de busca (lojas reais) ou a demonstração.
import { API_URL } from './config.js';
import { buscaDemo, lojasDemo } from './demo.js';

export const modoDemo = () => !API_URL;

async function pedir(caminho) {
  let r;
  try {
    r = await fetch(`${API_URL}${caminho}`, { headers: { accept: 'application/json' } });
  } catch (_) {
    throw new Error('Não consegui falar com o servidor de busca. Confira sua internet e tente de novo.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `O servidor respondeu com erro (HTTP ${r.status}).`);
  return j;
}

/**
 * Busca produtos. Devolve { itens, verificadoEm, fontes, demo, aviso }.
 * Cada item segue o formato comum: loja, lojaIcone, titulo, preco, precoOriginal, foto,
 * link, linkDireto, token, frete (null = a calcular), freteGratis, avaliacao, tamanho...
 */
export async function buscarProdutos(q, { cep = '' } = {}) {
  if (modoDemo()) {
    await new Promise((r) => setTimeout(r, 300));
    const d = buscaDemo(q);
    const c = String(cep).replace(/\D/g, '');
    const local = c.length === 8 ? { cep: c, cidade: 'sua região', uf: '', nivel: 'demo' } : null;
    return { ...d, local, verificadoEm: new Date().toISOString(), fontes: ['demo'], demo: true };
  }
  const c = String(cep).replace(/\D/g, '');
  const j = await pedir(`/api/buscar?${new URLSearchParams(c.length === 8 ? { q, cep: c } : { q })}`);
  return { itens: j.itens || [], verificadoEm: j.verificadoEm, fontes: j.fontes || [], local: j.local || null, demo: false, aviso: '' };
}

/** Todas as lojas que vendem um produto, com link direto. Gasta 1 busca da cota (guardada por horas). */
export async function buscarLojas(item) {
  if (modoDemo() || item.fonte === 'demo') {
    await new Promise((r) => setTimeout(r, 250));
    return lojasDemo(item);
  }
  if (!item.token) throw new Error('Esta oferta não traz a lista de lojas.');
  return pedir(`/api/lojas?${new URLSearchParams({ token: item.token })}`);
}
