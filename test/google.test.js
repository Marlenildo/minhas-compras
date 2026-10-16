import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerFrete, normalizarResultadoGoogle } from '../worker/src/google.js';
import { tratar } from '../worker/src/index.js';

test('lê o frete do texto do Google', () => {
  assert.deepEqual(lerFrete('Frete grátis'), { freteGratis: true, frete: 0 });
  assert.deepEqual(lerFrete('Entrega grátis até sex.'), { freteGratis: true, frete: 0 });
  assert.deepEqual(lerFrete('Frete: R$ 12,90'), { freteGratis: false, frete: 12.9 });
  assert.deepEqual(lerFrete('+R$ 9,99 de frete'), { freteGratis: false, frete: 9.99 });
  assert.deepEqual(lerFrete('Devolução grátis'), { freteGratis: false, frete: null });
  assert.deepEqual(lerFrete(null), { freteGratis: false, frete: null });
});

test('normaliza um resultado do Google Shopping', () => {
  const n = normalizarResultadoGoogle({
    position: 1,
    title: 'Kit 3 Sabonete Líquido Marca X 250ml',
    product_id: '123',
    source: 'Amazon.com.br',
    extracted_price: 29.9,
    extracted_old_price: 34.9,
    thumbnail: 'https://encrypted-tbn0.gstatic.com/x.jpg',
    product_link: 'https://www.google.com.br/shopping/product/123',
    delivery: 'Frete grátis',
    rating: 4.7,
    reviews: 1200,
  });
  assert.equal(n.loja, 'Amazon.com.br');
  assert.equal(n.preco, 29.9);
  assert.equal(n.precoOriginal, 34.9);
  assert.equal(n.embalagens, 3);
  assert.equal(n.conteudo, 250);
  assert.equal(n.freteGratis, true);
  assert.equal(n.link, 'https://www.google.com.br/shopping/product/123');
  assert.equal(n.foto, 'https://encrypted-tbn0.gstatic.com/x.jpg');
});

class KVFalso {
  constructor() { this.m = new Map(); }
  async get(k, tipo) { const v = this.m.get(k); return v == null ? null : tipo === 'json' ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
}

function fetchFalso(corpo, status = 200) {
  const f = async (url) => {
    f.chamadas.push(String(url));
    return new Response(JSON.stringify(corpo), { status });
  };
  f.chamadas = [];
  return f;
}

const resultados = {
  shopping_results: [
    { position: 1, title: 'Sabonete Líquido Marca X Refil 900ml', source: 'Magalu', extracted_price: 21.9, delivery: 'Frete R$ 10,00' },
    { position: 2, title: 'Sabonete Líquido Marca X Refil 900ml', source: 'Magalu', extracted_price: 21.9, delivery: 'Frete R$ 10,00' },
    { position: 3, title: 'Sabonete Líquido Marca X usado', source: 'OLX', extracted_price: 5, second_hand_condition: 'usado' },
    { position: 4, title: 'Sabonete Líquido Marca X 650 ml', source: 'Amazon.com.br', extracted_price: 19.9, delivery: 'Frete grátis' },
  ],
};

test('com a chave da SerpApi, a busca usa o Google e guarda no cache', async () => {
  const kv = new KVFalso();
  const env = { SERPAPI_KEY: 'CHAVE-SERP', TOKENS: kv };
  const f = fetchFalso(resultados);
  const r = await tratar(new Request('https://api.exemplo/api/buscar?q=Sabonete%20liquido'), env, {}, f);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.fontes, ['google']);
  assert.deepEqual(j.itens.map((i) => i.loja), ['Magalu', 'Amazon.com.br']); // sem repetido e sem usado
  assert.equal(j.itens[0].frete, 10);
  const pedido = new URL(f.chamadas[0]);
  assert.equal(pedido.searchParams.get('engine'), 'google_shopping');
  assert.equal(pedido.searchParams.get('gl'), 'br');

  // Segunda busca igual não gasta cota: vem do cache
  const r2 = await tratar(new Request('https://api.exemplo/api/buscar?q=sabonete%20LIQUIDO'), env, {}, f);
  assert.equal((await r2.json()).doCache, true);
  assert.equal(f.chamadas.length, 1);
});

test('cota esgotada vira uma mensagem clara', async () => {
  const env = { SERPAPI_KEY: 'CHAVE-SERP' };
  const r = await tratar(
    new Request('https://api.exemplo/api/buscar?q=sabonete'),
    env,
    {},
    fetchFalso({ error: 'Your account has run out of searches.' }, 429)
  );
  assert.equal(r.status, 429);
  assert.match((await r.json()).erro, /buscas gratuitas do mês acabaram/);
});

test('diagnóstico mostra as buscas restantes sem expor a chave', async () => {
  const env = { SERPAPI_KEY: 'CHAVE-SERP' };
  const r = await tratar(
    new Request('https://api.exemplo/api/diagnostico'),
    env,
    {},
    fetchFalso({ plan_name: 'Free Plan', total_searches_left: 248 })
  );
  const texto = await r.text();
  assert.ok(!texto.includes('CHAVE-SERP'));
  const j = JSON.parse(texto);
  assert.equal(j.fontePrincipal, 'google');
  assert.equal(j.passos[0].buscasRestantes, 248);
});
