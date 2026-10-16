import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizar, termos, combina, eRelevante, parecenca, buscaParecida, LIMIAR_PARECIDO } from '../app/src/relevancia.js';

test('normaliza e separa as palavras que importam', () => {
  assert.equal(normalizar('Sabonete Líquido NUTRI-MILK'), 'sabonete liquido nutri milk');
  assert.deepEqual(termos('sabonete de palmolive com nutrimilk'), ['sabonete', 'palmolive', 'nutrimilk']);
  assert.deepEqual(termos('Sabonetes Fraldas'), ['sabonete', 'fralda']);
});

test('o caso do sabonete Palmolive Nutri Milk', () => {
  const q = 'sabonete palmolive nutrimilk';
  assert.equal(eRelevante('Sabonete Líquido Palmolive Nutri-Milk Refil 900ml', q), true);
  assert.equal(eRelevante('Kit 12 Sabonete Palmolive Nutrimilk Original 85g', q), true);
  assert.equal(eRelevante('Sabonetes em barra Palmolive NutriMilk 6 unidades', q), true);
  assert.equal(eRelevante('Sabonete Líquido Protex Erva-doce 250ml', q), false);
  assert.equal(eRelevante('Sabonete Palmolive Naturals Oliva e Aloe', q), false);
  assert.equal(eRelevante('Hidratante Nivea Milk 400ml', q), false);
});

test('busca longa aceita faltar uma palavra a cada quatro', () => {
  const q = 'fone bluetooth jbl tune 520 preto';
  assert.equal(eRelevante('Fone de Ouvido JBL Tune 520BT Bluetooth', q), true); // falta "preto"
  assert.equal(eRelevante('Fone JBL Tune 720 Bluetooth Azul', q), false);
  assert.ok(combina('Fone JBL Tune 520 Preto Bluetooth', q) === 1);
});

test('produtos parecidos', () => {
  const a = 'Sabonete Líquido Palmolive Nutri-Milk Refil 900ml';
  assert.ok(parecenca(a, 'Refil Sabonete Liquido Palmolive Nutri Milk 900 ml') >= LIMIAR_PARECIDO);
  assert.ok(parecenca(a, 'Sabonete Líquido Palmolive Nutri-Milk 250ml') >= LIMIAR_PARECIDO);
  assert.ok(parecenca(a, 'Sabonete Líquido Protex Erva-doce 250ml') < LIMIAR_PARECIDO);
});

test('busca de parecidos usa as primeiras palavras do título', () => {
  assert.equal(buscaParecida('Sabonete Líquido Palmolive Nutri-Milk Refil 900ml - Original com Leite'), 'Sabonete Líquido Palmolive Nutri-Milk Refil Leite');
  assert.equal(buscaParecida('Kit 3 Sabonete Líquido Marca X Algodão 250ml'), 'Sabonete Líquido Marca Algodão');
  assert.equal(buscaParecida('Fone de Ouvido JBL Tune 520BT Bluetooth Preto'), 'Fone Ouvido JBL Tune 520BT Bluetooth');
});

test('"de ouvido" é opcional quando a busca é de fone', () => {
  assert.equal(eRelevante('Fone Bluetooth JBL Tune 520BT', 'fone de ouvido bluetooth'), true);
  assert.equal(eRelevante('Caixa de Som Bluetooth JBL', 'fone de ouvido bluetooth'), false);
  assert.equal(eRelevante('Protetor de ouvido', 'ouvido'), true);
});
