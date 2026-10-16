import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limparFiltrosGoogle, montarFacetas, passaNasFacetas } from '../app/src/facetas.js';

const item = (id, titulo, extra = {}) => ({ id, titulo, ...extra });

test('filtros do Google: tira preço, loja, frete e promoção', () => {
  const f = limparFiltrosGoogle([
    { type: 'Refine results', options: [{ text: 'On sale' }, { text: 'Nearby' }] },
    { type: 'Preço', options: [{ text: 'Até R$ 20' }, { text: 'R$ 20 a R$ 50' }] },
    { type: 'Marca', options: [{ text: 'Palmolive' }, { text: 'Dove' }, { text: 'Protex' }] },
    { type: 'Loja', options: [{ text: 'Amazon' }, { text: 'Magalu' }] },
    { type: 'Cor', options: [{ text: 'Preto' }] }, // só 1 opção: sai
  ]);
  assert.deepEqual(f, [{ nome: 'Marca', opcoes: ['Palmolive', 'Dove', 'Protex'] }]);
});

test('monta filtros de marca, tamanho, kit, cor e características', () => {
  const itens = [
    item('a', 'Sabonete Líquido Palmolive Nutri-Milk Refil 900ml', { qtd: 900, grupo: 'volume', rotuloTamanho: '900 ml', embalagens: 1 }),
    item('b', 'Sabonete Líquido Dove Original Refil 900ml', { qtd: 900, grupo: 'volume', rotuloTamanho: '900 ml', embalagens: 1 }),
    item('c', 'Kit 3 Sabonete Líquido Palmolive Lavanda 250ml', { qtd: 750, grupo: 'volume', rotuloTamanho: '750 ml', embalagens: 3 }),
    item('d', 'Sabonete Líquido Dove Lavanda Frasco Rosa 250ml', { qtd: 250, grupo: 'volume', rotuloTamanho: '250 ml', embalagens: 1 }),
    item('e', 'Sabonete Líquido Protex Frasco Azul 250ml', { qtd: 250, grupo: 'volume', rotuloTamanho: '250 ml', embalagens: 1 }),
  ];
  const { grupos, valores } = montarFacetas(itens, {
    busca: 'sabonete líquido',
    filtrosGoogle: [{ nome: 'Marca', opcoes: ['Palmolive', 'Dove', 'Protex', 'Lux'] }],
  });
  const porId = Object.fromEntries(grupos.map((g) => [g.id, g]));
  assert.deepEqual(porId.g0.opcoes.map((o) => [o.valor, o.n]), [['Palmolive', 2], ['Dove', 2], ['Protex', 1]]); // Lux some
  assert.deepEqual(porId.tamanho.opcoes.map((o) => o.valor), ['250 ml', '750 ml', '900 ml']);
  assert.deepEqual(porId.pacote.opcoes.map((o) => o.valor), ['Avulso', 'Kit com 3']);
  assert.deepEqual(porId.cor.opcoes.map((o) => o.valor).sort(), ['Azul', 'Rosa']);
  const carac = porId.carac.opcoes.map((o) => o.rotulo);
  assert.ok(carac.includes('Refil') && carac.includes('Lavanda') && carac.includes('Frasco'));
  assert.ok(!carac.includes('Sabonete') && !carac.includes('Palmolive') && !carac.includes('Kit'));

  // Dentro do grupo: qualquer opção; entre grupos: todas
  assert.equal(passaNasFacetas(valores.get('a'), { g0: new Set(['Palmolive', 'Dove']) }), true);
  assert.equal(passaNasFacetas(valores.get('e'), { g0: new Set(['Palmolive', 'Dove']) }), false);
  assert.equal(passaNasFacetas(valores.get('c'), { g0: new Set(['Palmolive']), tamanho: new Set(['900 ml']) }), false);
  assert.equal(passaNasFacetas(valores.get('a'), { g0: new Set(['Palmolive']), tamanho: new Set(['900 ml']) }), true);
  assert.equal(passaNasFacetas(valores.get('a'), {}), true);
});

test('fone: características de fone, sem tamanho', () => {
  const itens = [
    item('1', 'Fone de Ouvido Bluetooth JBL Tune 520BT Over-ear Preto'),
    item('2', 'Fone de Ouvido Bluetooth JBL Tune 720BT Over-ear Azul'),
    item('3', 'Fone Bluetooth Xiaomi Redmi Buds 4 Intra-auricular Branco'),
    item('4', 'Fone Bluetooth Samsung Galaxy Buds FE Intra-auricular Grafite'),
  ];
  const { grupos } = montarFacetas(itens, { busca: 'fone bluetooth' });
  const ids = grupos.map((g) => g.id);
  assert.ok(!ids.includes('tamanho'));
  assert.ok(ids.includes('cor'));
  const carac = grupos.find((g) => g.id === 'carac').opcoes.map((o) => o.rotulo);
  assert.ok(carac.includes('JBL') && carac.includes('Tune') && carac.includes('Buds'));
  assert.ok(carac.includes('Over-ear') && carac.includes('Intra-auricular'));
  assert.equal(new Set(carac).size, carac.length); // sem nomes repetidos
});

test('opção do filtro como frase inteira: "Marca Z" não casa com "Marca Y"', async () => {
  const { opcaoNoTitulo } = await import('../app/src/facetas.js');
  assert.equal(opcaoNoTitulo('Fone Bluetooth Marca Z On-ear', 'Marca Z'), true);
  assert.equal(opcaoNoTitulo('Fone Bluetooth Marca Y Over-ear', 'Marca Z'), false);
  assert.equal(opcaoNoTitulo('Fone Bluetooth Marca Y Over-ear', 'Over-ear'), true);
  assert.equal(opcaoNoTitulo('Sabonete Palmolive Nutrimilk', 'Nutri Milk'), true);
});
