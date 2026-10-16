import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cidadeDoCep, localizacaoGoogle, localDoCep } from '../worker/src/cep.js';
import { tratar } from '../worker/src/index.js';

function fetchRotas(rotas) {
  const f = async (url) => {
    const u = String(url);
    f.chamadas.push(u);
    for (const [trecho, corpo, status = 200] of rotas) {
      if (typeof trecho === 'function' ? trecho(u) : u.includes(trecho)) return new Response(JSON.stringify(corpo), { status });
    }
    return new Response('{}', { status: 404 });
  };
  f.chamadas = [];
  return f;
}

class KVFalso {
  constructor() { this.m = new Map(); }
  async get(k, tipo) { const v = this.m.get(k); return v == null ? null : tipo === 'json' ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
}

test('cidade do CEP pelo ViaCEP, com BrasilAPI de reserva', async () => {
  const via = fetchRotas([['viacep.com.br/ws/58397000', { localidade: 'Areia', uf: 'PB' }]]);
  assert.deepEqual(await cidadeDoCep('58397-000', via), { cidade: 'Areia', uf: 'PB' });
  const reserva = fetchRotas([['viacep', {}, 500], ['brasilapi.com.br/api/cep/v1/01310100', { city: 'São Paulo', state: 'SP' }]]);
  assert.deepEqual(await cidadeDoCep('01310100', reserva), { cidade: 'São Paulo', uf: 'SP' });
  assert.equal(await cidadeDoCep('99999999', fetchRotas([['viacep', { erro: true }]])), null);
  assert.equal(await cidadeDoCep('123', fetchRotas([])), null);
});

test('localização do Google: cidade quando existe, senão o estado', async () => {
  const f = fetchRotas([
    [(u) => u.includes('locations.json') && u.includes('q=Sao+Paulo'), [{ name: 'Sao Paulo', canonical_name: 'Sao Paulo,State of Sao Paulo,Brazil', country_code: 'BR', target_type: 'City' }]],
    [(u) => u.includes('locations.json') && u.includes('q=Areia'), [{ name: 'Terra de Areia', canonical_name: 'Terra de Areia,State of Rio Grande do Sul,Brazil', country_code: 'BR', target_type: 'City' }]],
    [(u) => u.includes('locations.json') && u.includes('q=Paraiba'), [{ name: 'Paraiba', canonical_name: 'State of Paraiba,Brazil', country_code: 'BR', target_type: 'State' }]],
  ]);
  assert.deepEqual(await localizacaoGoogle({ cidade: 'São Paulo', uf: 'SP' }, f), { location: 'Sao Paulo,State of Sao Paulo,Brazil', nivel: 'cidade' });
  assert.deepEqual(await localizacaoGoogle({ cidade: 'Areia', uf: 'PB' }, f), { location: 'State of Paraiba,Brazil', nivel: 'estado' });
  assert.deepEqual(await localizacaoGoogle({ cidade: 'Lugar Nenhum', uf: 'XX' }, f), { location: 'Brazil', nivel: 'pais' });
});

test('busca com CEP usa a localização e guarda o CEP por 30 dias', async () => {
  const kv = new KVFalso();
  const env = { SERPAPI_KEY: 'CHAVE', TOKENS: kv };
  const f = fetchRotas([
    ['viacep.com.br/ws/58397000', { localidade: 'Areia', uf: 'PB' }],
    [(u) => u.includes('locations.json') && u.includes('q=Paraiba'), [{ name: 'Paraiba', canonical_name: 'State of Paraiba,Brazil', country_code: 'BR', target_type: 'State' }]],
    [(u) => u.includes('locations.json'), []],
    ['engine=google_shopping', { shopping_results: [{ title: 'Sabonete X', source: 'Loja', extracted_price: 10, delivery: 'Frete R$ 12,00' }] }],
  ]);
  const r = await tratar(new Request('https://api.exemplo/api/buscar?q=sabonete&cep=58397-000'), env, {}, f);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual([j.local.cidade, j.local.uf, j.local.nivel], ['Areia', 'PB', 'estado']);
  const busca = new URL(f.chamadas.find((u) => u.includes('engine=google_shopping')));
  assert.equal(busca.searchParams.get('location'), 'State of Paraiba,Brazil');
  assert.ok(await kv.get('cep:58397000'));
  assert.deepEqual(await localDoCep('58397000', { env, fetcher: fetchRotas([]) }), j.local); // vem do KV
});
