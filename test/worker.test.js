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

test('quando a busca de anúncios é bloqueada, usa o catálogo', async () => {
  const f = fetchFalso([
    ['/oauth/token', { access_token: 'tok', expires_in: 21600 }],
    ['/sites/MLB/search', { message: 'forbidden' }, 403],
    ['/products/search', {
      results: [
        {
          id: 'MLB111',
          name: 'Sabonete Líquido Marca X Refil 900 ml',
          pictures: [{ url: 'https://http2.mlstatic.com/D_NQ_NP_1-F.jpg' }],
          attributes: [],
        },
        { id: 'MLB222', name: 'Produto sem ofertas', pictures: [], attributes: [] },
      ],
    }],
    ['/products/MLB111/items', {
      results: [
        { item_id: 'MLB9', price: 25, condition: 'new', shipping: { free_shipping: true } },
        { item_id: 'MLB8', price: 19.9, condition: 'new', shipping: { free_shipping: false } },
        { item_id: 'MLB7', price: 15, condition: 'used', shipping: { free_shipping: true } },
      ],
    }],
    ['/products/MLB222/items', { message: 'not found' }, 404],
    ['/items/MLB8/shipping_options', { options: [{ cost: 7.5 }] }],
  ]);
  const r = await tratar(new Request('https://api.exemplo/api/buscar?q=sabonete&cep=58397000'), env, {}, f);
  assert.equal(r.status, 200);
  const { itens } = await r.json();
  assert.deepEqual(itens.map((i) => [i.id, i.preco, i.frete]), [['ml:MLB8', 19.9, 7.5], ['ml:MLB9', 25, 0]]);
  assert.equal(itens[0].conteudo, 900);
  assert.equal(itens[0].link, 'https://www.mercadolivre.com.br/p/MLB111');
  assert.equal(itens[0].foto, 'https://http2.mlstatic.com/D_NQ_NP_1-O.jpg');
});

test('quando o catálogo também é bloqueado, a mensagem diz isso', async () => {
  const f = fetchFalso([
    ['/oauth/token', { access_token: 'tok', expires_in: 21600 }],
    ['/sites/MLB/search', {}, 403],
    ['/products/search', { message: 'forbidden' }, 403],
  ]);
  const r = await tratar(new Request('https://api.exemplo/api/buscar?q=sabonete'), env, {}, f);
  assert.equal(r.status, 502);
  assert.match((await r.json()).erro, /catálogo \(HTTP 403: forbidden\)/);
});

test('diagnóstico mostra o resultado de cada rota sem expor as chaves', async () => {
  const f = fetchFalso([
    ['/oauth/token', { access_token: 'TOKEN-XYZ-987', expires_in: 21600 }],
    ['/sites/MLB/search', { message: 'forbidden' }, 403],
    ['/products/search', { results: [{ id: 'MLB111' }] }],
    ['/products/MLB111/items', { results: [{ item_id: 'MLB9' }] }],
    ['/items/MLB9/shipping_options', { options: [] }],
    ['/items/MLB9', { id: 'MLB9' }],
  ]);
  const r = await tratar(new Request('https://api.exemplo/api/diagnostico'), env, {}, f);
  const texto = await r.text();
  assert.ok(!texto.includes('segredo') && !texto.includes('TOKEN-XYZ-987'));
  const { passos } = JSON.parse(texto);
  assert.deepEqual(passos.map((p) => p.ok), [true, false, true, true, true, true]);
  assert.equal(passos[1].mensagem, 'forbidden');
});
