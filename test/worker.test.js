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

const env = { ML_CLIENT_ID: 'id', ML_CLIENT_SECRET: 'SEGREDO-ML-555', ORIGENS_PERMITIDAS: '*' };

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
  assert.match((await r.json()).erro, /nenhuma fonte de preços/);
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
  assert.ok(!texto.includes('SEGREDO-ML-555') && !texto.includes('TOKEN-XYZ-987'));
  const { passos } = JSON.parse(texto);
  assert.equal(passos[0].etapa, 'Google Shopping (SerpApi)');
  const ml = passos.slice(1);
  assert.deepEqual(ml.map((p) => p.ok), [true, false, true, true, true, true]);
  assert.equal(ml[1].mensagem, 'forbidden');
});

class KVFalso {
  constructor() { this.m = new Map(); }
  async get(k, tipo) { const v = this.m.get(k); return v == null ? null : tipo === 'json' ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
}

test('conectar exige a senha e leva à autorização do Mercado Livre', async () => {
  const kv = new KVFalso();
  const e = { ...env, TOKENS: kv, ADMIN_CHAVE: 'minha-senha' };
  const errada = await tratar(new Request('https://api.exemplo/api/conectar?chave=outra'), e, {}, fetchFalso([]));
  assert.equal(errada.status, 403);
  const r = await tratar(new Request('https://api.exemplo/api/conectar?chave=minha-senha'), e, {}, fetchFalso([]));
  assert.equal(r.status, 302);
  const destino = new URL(r.headers.get('location'));
  assert.equal(destino.host, 'auth.mercadolivre.com.br');
  assert.equal(destino.searchParams.get('redirect_uri'), 'https://api.exemplo/api/retorno');
  assert.ok(await kv.get(`estado:${destino.searchParams.get('state')}`));
});

test('retorno troca o código, guarda o acesso e a busca passa a usar token de usuário', async () => {
  const kv = new KVFalso();
  const e = { ...env, TOKENS: kv, ADMIN_CHAVE: 'minha-senha' };
  const r1 = await tratar(new Request('https://api.exemplo/api/conectar?chave=minha-senha'), e, {}, fetchFalso([]));
  const estado = new URL(r1.headers.get('location')).searchParams.get('state');

  const f = fetchFalso([['/oauth/token', { access_token: 'USUARIO-1', refresh_token: 'R1', expires_in: 21600 }]]);
  const r2 = await tratar(new Request(`https://api.exemplo/api/retorno?code=ABC&state=${estado}`), e, {}, f);
  assert.equal(r2.status, 200);
  assert.match(await r2.text(), /Conectado ao Mercado Livre/);
  assert.equal(await kv.get('ml_refresh'), 'R1');
  const corpo = String(f.chamadas[0].opcoes.body);
  assert.match(corpo, /grant_type=authorization_code/);
  assert.match(corpo, /code=ABC/);

  // Estado já usado não vale de novo
  const r3 = await tratar(new Request(`https://api.exemplo/api/retorno?code=ABC&state=${estado}`), e, {}, f);
  assert.equal(r3.status, 400);

  // A busca usa o token de usuário guardado
  limparTokenEmCache();
  const fb = fetchFalso([['/sites/MLB/search', { results: [itemML()] }]]);
  const r4 = await tratar(new Request('https://api.exemplo/api/buscar?q=sabonete'), e, {}, fb);
  assert.equal(r4.status, 200);
  assert.equal(fb.chamadas.find((c) => c.url.includes('/sites/MLB/search')).opcoes.headers.authorization, 'Bearer USUARIO-1');
});

test('com o acesso vencido, renova pelo refresh token e guarda o novo', async () => {
  const kv = new KVFalso();
  await kv.put('ml_refresh', 'R1');
  const e = { ...env, TOKENS: kv };
  const f = fetchFalso([
    ['/oauth/token', { access_token: 'USUARIO-2', refresh_token: 'R2', expires_in: 21600 }],
    ['/sites/MLB/search', { results: [] }],
  ]);
  const r = await tratar(new Request('https://api.exemplo/api/buscar?q=sabonete'), e, {}, f);
  assert.equal(r.status, 200);
  assert.match(String(f.chamadas[0].opcoes.body), /grant_type=refresh_token/);
  assert.equal(await kv.get('ml_refresh'), 'R2');
});

test('sem KV ou sem senha, conectar explica o que falta', async () => {
  const r = await tratar(new Request('https://api.exemplo/api/conectar?chave=x'), env, {}, fetchFalso([]));
  assert.equal(r.status, 503);
  assert.match(await r.text(), /TOKENS/);
});
