# Minhas Compras

App que encontra a compra de **menor custo real** de um produto, por litro, quilo ou unidade.

Você coloca as ofertas que achou (loja, preço, embalagem, frete, descontos) e o app calcula, para cada uma, quanto vale a pena levar e quanto você paga de verdade. No fim, mostra a melhor compra e o ranking de todas.

> Nome provisório. O nome definitivo do app ainda será escolhido.

## O que o app considera

- **Embalagem e tamanho**: sachê de 900 ml, kit com 3 de 250 ml, frasco de 650 ml. Tudo vira preço por litro (ou por kg, unidade, metro).
- **Leitura do título**: cole "Kit 3 Sabonete Líquido 250 ml" e o app preenche 3 embalagens de 250 ml.
- **Frete**, inclusive **frete grátis a partir de um valor** (como o do Meli+ no Mercado Livre).
- **Desconto por quantidade** em faixas (ex.: 5% a partir de 5 unidades, 10% a partir de 10).
- **Desconto no Pix**.
- **Levar mais unidades**: o app testa de 1 até o máximo que você aceita levar e sugere a quantidade que deixa o litro mais barato. Se levar mais economiza menos de 1%, ele fica com a quantidade menor.
- **Quantidade mínima**: se você precisa de pelo menos 2 L, ele só considera compras que cheguem lá.

### Regras do cálculo

1. O desconto por quantidade vale sobre o valor dos produtos.
2. O frete grátis é conferido no valor dos produtos já com o desconto por quantidade.
3. O desconto no Pix vale sobre os produtos, não sobre o frete.
4. O frete informado é o do pedido inteiro, não por unidade.

O preço final deve sempre ser conferido na loja antes de pagar.

## Como usar

Abra `index.html` num navegador servido por HTTP (por exemplo, pelo GitHub Pages) ou gere a versão de arquivo único:

```bash
npm run build   # gera dist/minhas-compras.html, que abre direto no navegador
npm test        # roda os testes do motor de cálculo
```

Não há dependências para instalar. Basta ter o Node.js 18 ou mais novo.

Os dados ficam só no seu navegador (localStorage).

## Estrutura

```
src/core.js         motor de cálculo (funções puras, sem tela)
src/app.js          tela: formulário de ofertas e resultado
index.html          página e estilos
scripts/build.mjs   junta tudo num arquivo só
test/core.test.js   testes do motor
```

O motor fica separado da tela para ser reaproveitado depois num app de celular, num servidor ou numa extensão de navegador.

## Próximos passos

1. **Versão 1 (atual)**: você informa as ofertas e o app calcula a melhor compra.
2. **Perfil**: CEP e assinaturas (Prime, Meli+) salvos, para o app aplicar frete e benefícios sozinho.
3. **Busca automática** nas lojas que oferecem API oficial ou catálogo de afiliados (Amazon, Mercado Livre, redes de afiliados).
4. **Lista do mês e alertas**: produtos que você compra sempre e aviso quando o preço por litro cair.

## Princípio

O ranking é sempre pelo menor custo real. Se o app ganhar comissão de alguma loja no futuro, isso nunca muda a ordem das ofertas.

## Licença

MIT
