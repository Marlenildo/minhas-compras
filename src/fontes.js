// De onde vêm os produtos: o servidor de busca (lojas reais) ou a demonstração.
import { API_URL } from './config.js';
import { itensDemo } from './demo.js';

export const modoDemo = () => !API_URL;

/**
 * Busca produtos. Devolve { itens, verificadoEm, demo, aviso }.
 * Cada item segue o formato comum: loja, titulo, preco, foto, link,
 * frete (null = a calcular), freteGratis, embalagens, conteudo, unidade...
 */
export async function buscarProdutos(q, { cep = '' } = {}) {
  if (modoDemo()) {
    await new Promise((r) => setTimeout(r, 350));
    return {
      itens: itensDemo(),
      verificadoEm: new Date().toISOString(),
      demo: true,
      aviso: 'Demonstração: a busca sempre mostra este exemplo, com produtos e preços fictícios.',
    };
  }
  const url = `${API_URL}/api/buscar?${new URLSearchParams({ q, cep: String(cep).replace(/\D/g, '') })}`;
  let r;
  try {
    r = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (_) {
    throw new Error('Não consegui falar com o servidor de busca. Confira sua internet e tente de novo.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `A busca falhou (HTTP ${r.status}).`);
  return { itens: j.itens || [], verificadoEm: j.verificadoEm, demo: false, aviso: '' };
}
