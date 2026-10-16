import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FAVORITOS, garantirSalvos, salvarItem, estaSalvo, tirarDaLista, alternarLista, criarLista, renomearLista, apagarLista,
  itensDaLista, contarLista, totalDaLista, mudarQuantidade, registrarPrecosVistos, variacao, removerSalvo,
} from '../app/src/salvos.js';

const oferta = (id, preco, extra = {}) => ({ id, titulo: `Produto ${id}`, loja: 'Loja', preco, frete: 5, ...extra });

test('salvar nos favoritos guarda o preço e o total de quando salvou', () => {
  const p = garantirSalvos({});
  salvarItem(p, oferta('a', 20), FAVORITOS, '2026-10-16T10:00:00Z');
  assert.equal(estaSalvo(p, 'a'), true);
  assert.equal(p.salvos.a.precoSalvo, 20);
  assert.equal(p.salvos.a.totalSalvo, 25);
  assert.deepEqual(p.salvos.a.listas, [FAVORITOS]);
  assert.equal(contarLista(p, FAVORITOS), 1);
});

test('listas: criar, acrescentar, tirar, renomear e apagar', () => {
  const p = garantirSalvos({});
  const mes = criarLista(p, '  Compras do mês ');
  assert.equal(criarLista(p, 'compras do MÊS'), mes); // não duplica
  salvarItem(p, oferta('a', 10), FAVORITOS);
  alternarLista(p, oferta('a', 10), mes);
  salvarItem(p, oferta('b', 30), mes);
  assert.deepEqual(p.salvos.a.listas, [FAVORITOS, mes]);
  assert.equal(contarLista(p, mes), 2);

  renomearLista(p, mes, 'Mercado');
  assert.equal(p.listas.find((l) => l.id === mes).nome, 'Mercado');

  // Tirar de uma lista mantém nas outras
  assert.equal(tirarDaLista(p, 'a', mes), null);
  assert.equal(estaSalvo(p, 'a'), true);

  // Apagar a lista: quem só estava nela deixa de estar salvo
  apagarLista(p, mes);
  assert.equal(estaSalvo(p, 'b'), false);
  assert.equal(estaSalvo(p, 'a'), true);
  apagarLista(p, FAVORITOS); // Favoritos não se apaga
  assert.ok(p.listas.some((l) => l.id === FAVORITOS));
});

test('total da lista com quantidades e preço mais recente', () => {
  const p = garantirSalvos({});
  salvarItem(p, oferta('a', 10), FAVORITOS);
  salvarItem(p, oferta('b', 4.5), FAVORITOS);
  mudarQuantidade(p, 'b', +2);
  mudarQuantidade(p, 'a', -5); // nunca abaixo de 1
  assert.equal(p.salvos.a.qtd, 1);
  assert.equal(totalDaLista(p, FAVORITOS), 10 + 4.5 * 3);

  registrarPrecosVistos(p, [oferta('a', 8)], '2026-10-17T10:00:00Z');
  assert.equal(p.salvos.a.precoSalvo, 10);
  assert.equal(p.salvos.a.ultimoPreco, 8);
  assert.equal(variacao(p.salvos.a), -2);
  assert.equal(totalDaLista(p, FAVORITOS), 8 + 4.5 * 3);
  assert.equal(itensDaLista(p, FAVORITOS).length, 2);
});

test('remover devolve o registro para poder desfazer', () => {
  const p = garantirSalvos({});
  salvarItem(p, oferta('a', 10), FAVORITOS);
  const r = removerSalvo(p, 'a');
  assert.equal(estaSalvo(p, 'a'), false);
  p.salvos.a = r;
  assert.equal(estaSalvo(p, 'a'), true);
});

test('juntar aparelho e conta: soma os dois lados sem perder nada', async () => {
  const { juntarConteudo } = await import('../app/src/salvos.js');
  const conta = garantirSalvos({});
  salvarItem(conta, oferta('a', 10), FAVORITOS, '2026-10-10T10:00:00Z');
  const casaConta = criarLista(conta, 'Casa');
  salvarItem(conta, oferta('b', 20), casaConta, '2026-10-11T10:00:00Z');

  const celular = garantirSalvos({ cep: '58397000' });
  salvarItem(celular, oferta('a', 12), FAVORITOS, '2026-10-12T10:00:00Z'); // mesmo item, salvo depois
  const casaCel = criarLista(celular, 'casa'); // mesmo nome, outro id
  salvarItem(celular, oferta('c', 5), casaCel, '2026-10-12T11:00:00Z');
  mudarQuantidade(celular, 'a', +2);

  const j = juntarConteudo(celular, conta);
  assert.deepEqual(Object.keys(j.salvos).sort(), ['a', 'b', 'c']);
  assert.equal(j.salvos.a.precoSalvo, 10); // preço de quando salvou primeiro
  assert.equal(j.salvos.a.qtd, 3);
  assert.equal(j.listas.filter((l) => l.nome.toLowerCase() === 'casa').length, 1); // uma lista "Casa" só
  assert.deepEqual(j.salvos.c.listas, [casaConta]);
  assert.equal(j.cep, '58397000');
});

test('juntar: o que foi apagado num aparelho não volta pelo outro', async () => {
  const { juntarConteudo } = await import('../app/src/salvos.js');
  const conta = garantirSalvos({});
  salvarItem(conta, oferta('a', 10), FAVORITOS, '2026-10-10T10:00:00Z');
  salvarItem(conta, oferta('b', 10), FAVORITOS, '2026-10-10T10:00:00Z');
  const celular = structuredClone(conta);
  removerSalvo(celular, 'a'); // apagou no celular
  const j = juntarConteudo(celular, conta);
  assert.deepEqual(Object.keys(j.salvos), ['b']);

  // Salvo de novo depois de apagado: volta
  salvarItem(conta, oferta('a', 9), FAVORITOS, '2099-01-01T00:00:00Z');
  delete conta.salvos.a; salvarItem(conta, oferta('a', 9), FAVORITOS, '2099-01-01T00:00:00Z');
  const k = juntarConteudo(celular, conta, new Date('2099-01-02T00:00:00Z'));
  assert.ok(k.salvos.a);
});
