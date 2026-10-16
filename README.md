# Minhas Compras

Busque um produto e veja onde cada **litro, quilo ou unidade** sai mais barato, com fotos, frete e descontos já somados.

> Nome provisório. O nome definitivo do app ainda será escolhido.

## Como funciona

1. Você busca um produto ("sabonete líquido refil") e, se quiser, informa o CEP.
2. O servidor de busca consulta o Google Shopping e devolve as ofertas de várias lojas, com foto, preço, frete e link.
3. O app lê o tamanho de cada oferta pelo título, calcula o preço por litro e testa levar de 1 até o máximo de unidades que você aceita.
4. A melhor compra aparece em destaque, seguida de todas as ofertas da mais barata para a mais cara.

Também dá para:

- **corrigir o tamanho** de um anúncio, ou informar o tamanho quando o anúncio não traz;
- **adicionar uma oferta de outra loja** à mão (supermercado do bairro, outro site);
- filtrar por **frete grátis** e **loja oficial**, e ordenar por preço total.

Sem o servidor ligado, o app roda em **modo demonstração**, com produtos e preços fictícios.

### Regras do cálculo

1. O desconto por quantidade vale sobre o valor dos produtos.
2. O frete grátis por valor mínimo é conferido depois do desconto por quantidade.
3. O desconto no Pix não vale sobre o frete.
4. O frete é do pedido inteiro, não por unidade.
5. Levar mais unidades só é sugerido se economizar pelo menos 1%.

## Estrutura

```
index.html              página e estilos
src/core.js             motor de cálculo (funções puras, testadas)
src/app.js              tela: busca, resultado, filtros
src/fontes.js           de onde vêm os produtos (servidor ou demonstração)
src/demo.js             dados e ilustrações da demonstração
src/config.js           endereço do servidor de busca
worker/                 servidor de busca (Cloudflare Workers)
scripts/build.mjs       junta tudo num arquivo só (dist/)
test/                   testes do motor e do servidor
```

```bash
npm test        # roda os testes
npm run build   # gera dist/minhas-compras.html, que abre direto no navegador
```

Não há dependências para instalar no app. Basta ter o Node.js 18 ou mais novo.

## Fontes de preço

O servidor (`worker/`) roda no Cloudflare Workers e guarda as chaves de acesso. A página nunca chama as lojas direto.

- **Google Shopping, pela [SerpApi](https://serpapi.com)** (fonte principal): uma busca traz ofertas de várias lojas, com foto, preço e frete quando o Google informa. Plano gratuito de 250 buscas por mês. Cada busca fica guardada por 6 horas (`CACHE_HORAS`), então buscas repetidas não gastam a cota.
- **Mercado Livre (API oficial)**: o código está pronto, inclusive a conexão da conta do dono (`/api/conectar`), mas o Mercado Livre bloqueia a busca de anúncios e a do catálogo para apps como este ("At least one policy returned UNAUTHORIZED"). Fica como reserva.

### Configuração no Cloudflare (pelo painel)

1. Crie um Worker chamado `minhas-compras-api` e cole o conteúdo de `worker/pronto/worker.js` (gerado com `npm run build:worker`).
2. Em *Settings → Variables and secrets*:
   - `SERPAPI_KEY` (Secret): chave da SerpApi;
   - `ORIGENS_PERMITIDAS` (Text): `*`, ou o endereço do app publicado;
   - opcionais: `CACHE_HORAS`, `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ADMIN_CHAVE`.
3. Em *Bindings*, ligue um namespace KV com o nome `TOKENS` (cache das buscas e tokens).
4. Confira em `/api/diagnostico`: mostra a fonte ativa e as buscas restantes, sem mostrar as chaves.

### Publicar o app

No GitHub: *Settings → Pages → Deploy from a branch → main / (root)*. O app fica em `https://marlenildo.github.io/minhas-compras/` e já aponta para o servidor (`src/config.js`).

## Contas

Hoje o app funciona **sem conta**: CEP, ajustes e ofertas adicionadas ficam salvos só no aparelho (localStorage).

A conta será opcional. Ela serve para:

- ver as listas em qualquer aparelho;
- montar a lista do mês dos produtos que você sempre compra;
- receber aviso quando o preço por litro cair.

Plano técnico: login com Google ou link por e-mail (sem senha) usando Supabase, que guarda as listas num banco de dados com acesso só do próprio usuário. Ao criar a conta, o que já está salvo no aparelho é copiado para ela.

## Próximos passos

1. Conferir os resultados reais do Google Shopping e ajustar a leitura de tamanhos.
2. Perfil com assinaturas (Prime, Meli+) para aplicar frete e benefícios sozinho.
3. Mais lojas por API oficial ou redes de afiliados (Amazon Creators API, Awin, Lomadee). Sem raspar sites.
4. Contas opcionais, lista do mês e alertas de preço.

## Princípio

O ranking é sempre pelo menor custo real. Se o app ganhar comissão de alguma loja no futuro, isso nunca muda a ordem das ofertas.

## Licença

MIT
