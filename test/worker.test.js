import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarItemML, fotoGrande, limparTokenEmCache } from '../worker/src/mercadolivre.js';
import { tratar } from '../worker/src/index.js';

const itemML = (extra = {}) => ({
  id: 'MLB123',
  title: 'Kit 3 Sabonete Líquido Marca X 250ml',
  price: 29.9,
  original_price: 34.9,
  condition: 'new',
  thumbnail: 'http://http2.mlstatic.com/D_NQ_NP_123-I.jpg',
  permalink: 'https://produto.mercadolivre.com.br/MLB-123',
  shipping: { free_shipping: true, logistic_type: 'fulfillment' },
  official_store_id: 77,
  official_store_name: 'Marca X',
  attributes: [],
  ...extra,
});

beforeEach(() => limparTokenEmCache());

test('foto em tamanho maior e por https', () => {
  assert.equal(fotoGrande('http://http2.mlstatic.com/D_NQ_NP_123-I.jpg'), 'https://http2.mlstatic.com/D_NQ_NP_123-O.jpg');
  assert.equal(fotoGrande(null), null);
});

test('normaliza um anúncio do Mercado Livre', () => {
  const n = normalizarItemML(itemML());
  assert.equal(n.id, 'ml:MLB123');
  assert.equal(n.embalagens, 3);
  assert.equal(n.conteudo, 250);
  assert.equal(n.unidade, 'ml');
  assert.equal(n.fonteConteudo, 'titulo');
  assert.equal(n.freteGratis, true);
  assert.equal(n.frete, 0);
  assert.equal(n.full, true);
  assert.equal(n.lojaOficial, true);
  assert.equal(n.vendedor, 'Marca X');
});

test('usa os atributos do anúncio quando o título não traz o tamanho', () => {
  const n = normalizarItemML(
    itemML({
      title: 'Sabonete Líquido Marca X Lavanda',
      shipping: { free_shipping: false },
      attributes: [
        { id: 'NET_VOLUME', value_name: '900 mL', value_struct: { number: 900, unit: 'mL' } },
        { id: 'UNITS_PER_PACK', value_name: '2' },
      ],
    })
  );
  assert.equal(n.conteudo, 900);
  assert.equal(n.unidade, 'ml');
  assert.equal(n.embalagens, 2);
  assert.equal(n.fonteConteudo, 'atributo');
  assert.equal(n.frete, null);
});

function fetchFalso(respostas) {
  const chamadas = [];
  const f = async (url, opcoes = {}) => {
    chamadas.push({ url: String(url), opcoes });
    for (const [trecho, corpo, status = 200] of respostas) {
      if (String(url).includes(trecho)) return new Response(JSON.stringify(corpo), { status });
    }
    return new Response('{}', { status: 404 });
  };
  f.chamadas = chamadas;
  return f;
}

const env = { ML_CLIENT_ID: 'id', ML_CLIENT_SECRET: 'segredo', ORIGENS_PERMITIDAS: '*' };

test('servidor busca, calcula frete pelo CEP e responde com CORS', async () => {
  const f = fetchFalso([
    ['/oauth/token', { access_token: 'tok', expires_in: 21600 }],
    ['/sites/MLB/search', { results: [itemML(), itemML({ id: 'MLB9', shipping: { free_shipping: false } })] }],
    ['/items/MLB9/shipping_options', { options: [{ cost: 18.5 }, { cost: 12.9 }] }],
  ]);
  const r = await tratar(new Request('https://api.exemplo/api/buscar?q=sabonete&cep=58397-000'), env, {}, f);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const j = await r.json();
  assert.equal(j.itens.length, 2);
  assert.equal(j.itens[1].frete, 12.9);
  const busca = f.chamadas.find((c) => c.url.includes('/sites/MLB/search'));
  assert.equal(busca.opcoes.headers.authorization, 'Bearer tok');
});

test('servidor sem chaves explica o que falta', async () => {
  const r = await tratar(new Request('https://api.exemplo/api/buscar?q=sabonete'), {}, {}, fetchFalso([]));
  assert.equal(r.status, 503);
  assert.match((await r.json()).erro, /chaves do Mercado Livre/);
});

test('busca curta demais é recusada', async () => {
  const r = await tratar(new Request('https://api.exemplo/api/buscar?q=a'), env, {}, fetchFalso([]));
  assert.equal(r.status, 400);
});
