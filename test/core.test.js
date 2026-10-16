import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lerNumero,
  lerTitulo,
  quantidadeDoAnuncio,
  descontoPorQuantidade,
  custoParaQuantidade,
  melhorCompraDaOferta,
  compararOfertas,
  precoExibido,
} from '../src/core.js';

const perto = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('lê números no formato brasileiro e internacional', () => {
  assert.equal(lerNumero('29,90'), 29.9);
  assert.equal(lerNumero('1.234,56'), 1234.56);
  assert.equal(lerNumero('R$ 19,00'), 19);
  assert.equal(lerNumero('12.5'), 12.5);
  assert.equal(lerNumero(''), 0);
  assert.equal(lerNumero('abc', 7), 7);
});

test('lê o título do anúncio', () => {
  assert.deepEqual(lerTitulo('Sabonete Líquido Marca X Refil 900ml'), { embalagens: 1, conteudo: 900, unidade: 'ml' });
  assert.deepEqual(lerTitulo('Kit 3 Sabonete Líquido 250 ml'), { embalagens: 3, conteudo: 250, unidade: 'ml' });
  assert.deepEqual(lerTitulo('Refil 2x900ml'), { embalagens: 2, conteudo: 900, unidade: 'ml' });
  assert.deepEqual(lerTitulo('Sabonete 500 ml x 4'), { embalagens: 4, conteudo: 500, unidade: 'ml' });
  assert.deepEqual(lerTitulo('Amaciante 1,5 L'), { embalagens: 1, conteudo: 1.5, unidade: 'l' });
  assert.deepEqual(lerTitulo('Café 500g pack com 6'), { embalagens: 6, conteudo: 500, unidade: 'g' });
  assert.deepEqual(lerTitulo('Sabão em pó 1kg - 6 unidades'), { embalagens: 6, conteudo: 1, unidade: 'kg' });
  assert.equal(lerTitulo('Sabonete líquido lavanda'), null);
});

test('quantidade do anúncio na unidade base', () => {
  assert.equal(quantidadeDoAnuncio({ embalagens: 3, conteudo: 250, unidade: 'ml' }), 750);
  assert.equal(quantidadeDoAnuncio({ embalagens: 1, conteudo: 1.5, unidade: 'l' }), 1500);
  assert.equal(quantidadeDoAnuncio({ conteudo: 2, unidade: 'kg' }), 2000);
});

test('desconto por quantidade pega a maior faixa atingida', () => {
  const faixas = [{ minQtd: 5, pct: 5 }, { minQtd: 10, pct: 10 }];
  assert.equal(descontoPorQuantidade(faixas, 4), 0);
  assert.equal(descontoPorQuantidade(faixas, 5), 5);
  assert.equal(descontoPorQuantidade(faixas, 9), 5);
  assert.equal(descontoPorQuantidade(faixas, 12), 10);
});

test('frete grátis acima de um valor e desconto no Pix', () => {
  const oferta = { preco: 12, conteudo: 250, unidade: 'ml', frete: 10, freteGratisAcima: 19, pixPct: 5 };
  const um = custoParaQuantidade(oferta, 1);
  assert.equal(um.frete, 10);
  perto(um.faltaParaFreteGratis, 7);
  perto(um.total, 12 * 0.95 + 10);
  const dois = custoParaQuantidade(oferta, 2);
  assert.equal(dois.ganhouFreteGratis, true);
  assert.equal(dois.frete, 0);
  perto(dois.total, 24 * 0.95);
  perto(dois.custoPorBase, (24 * 0.95) / 500);
});

test('o mínimo do frete grátis considera o desconto por quantidade', () => {
  const oferta = { preco: 10, conteudo: 100, unidade: 'ml', frete: 8, freteGratisAcima: 50, descontos: [{ minQtd: 5, pct: 10 }] };
  // 5 × 10 = 50, mas com 10% vira 45: ainda não ganha frete grátis
  assert.equal(custoParaQuantidade(oferta, 5).ganhouFreteGratis, false);
  assert.equal(custoParaQuantidade(oferta, 6).ganhouFreteGratis, true);
});

test('sugere levar mais quando compensa', () => {
  const oferta = { preco: 20, conteudo: 650, unidade: 'ml', frete: 15, freteGratisAcima: 79 };
  const r = melhorCompraDaOferta(oferta, { maxUnidades: 10 });
  assert.equal(r.minima.n, 1);
  assert.equal(r.escolhida.n, 4); // 4 × 20 = 80 ≥ 79 → frete grátis
  assert.ok(r.dicas[0].includes('Levando 4 em vez de 1'));
});

test('não sugere levar mais quando a economia é pequena', () => {
  const oferta = { preco: 20, conteudo: 650, unidade: 'ml', frete: 0, descontos: [{ minQtd: 10, pct: 0.5 }] };
  const r = melhorCompraDaOferta(oferta, { maxUnidades: 10 });
  assert.equal(r.escolhida.n, 1);
  assert.equal(r.dicas.length, 0);
});

test('respeita a quantidade mínima desejada', () => {
  const oferta = { preco: 10, conteudo: 250, unidade: 'ml' };
  const r = melhorCompraDaOferta(oferta, { quantidadeMinima: 1000, maxUnidades: 2 });
  assert.equal(r.minima.n, 4); // precisa de 4 × 250 ml, mesmo acima do máximo
});

test('compara ofertas e ordena pelo menor custo real', () => {
  const ofertas = [
    { loja: 'A', preco: 30, conteudo: 900, unidade: 'ml', frete: 0 }, // 0,0333/ml
    { loja: 'B', preco: 10, embalagens: 1, conteudo: 250, unidade: 'ml', frete: 12, freteGratisAcima: 19 },
    { loja: 'C', preco: 25, conteudo: 650, unidade: 'ml', frete: 0 }, // 0,0385/ml
    { loja: 'D', preco: 50, conteudo: 1, unidade: 'kg' }, // outro grupo: ignorada
    { loja: 'E', preco: '', conteudo: 100, unidade: 'ml' }, // incompleta
  ];
  const r = compararOfertas(ofertas, { maxUnidades: 10 });
  assert.deepEqual(r.ranking.map((x) => x.oferta.loja), ['A', 'C', 'B']);
  assert.equal(r.ignoradas.length, 1);
  assert.equal(r.incompletas.length, 1);
  perto(precoExibido(r.ranking[0].escolhida.custoPorBase, 'volume'), 33.333333, 1e-4);
  assert.ok(r.economiaVsMaisCara > 0);
});
