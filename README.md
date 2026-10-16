# Minhas Compras

Busque um produto e veja onde cada **litro, quilo ou unidade** sai mais barato, com fotos, frete e descontos já somados.

> Nome provisório. O nome definitivo do app ainda será escolhido.

## Como funciona

1. Você busca um produto ("sabonete líquido refil") e, se quiser, informa o CEP.
2. O servidor de busca consulta a API oficial do Mercado Livre e devolve os anúncios com foto, preço, frete e link.
3. O app lê o tamanho de cada anúncio (pelo título ou pelos atributos do anúncio), calcula o preço por litro e testa levar de 1 até o máximo de unidades que você aceita.
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

## Ligar a busca real (Mercado Livre)

A página não pode chamar a API da loja direto: a chave de acesso precisa ficar escondida num servidor. Por isso existe a pasta `worker/`, que roda de graça no Cloudflare Workers.

1. **Crie um aplicativo no Mercado Livre**: em [developers.mercadolivre.com.br](https://developers.mercadolivre.com.br), entre com sua conta e crie um aplicativo. Anote o *Client ID* e o *Client Secret*. Nunca coloque o Secret no código nem envie por chat.
2. **Crie uma conta no Cloudflare** (gratuita) em [cloudflare.com](https://cloudflare.com).
3. No computador, dentro da pasta `worker/`:
   ```bash
   npx wrangler login
   npx wrangler secret put ML_CLIENT_ID       # cole o Client ID quando pedir
   npx wrangler secret put ML_CLIENT_SECRET   # cole o Client Secret quando pedir
   npx wrangler deploy
   ```
   O último comando mostra o endereço do servidor, algo como `https://minhas-compras-api.SEU-USUARIO.workers.dev`.
4. Confira abrindo `ENDEREÇO/api/saude` no navegador. Deve aparecer `"mercadolivre": true`.
5. Coloque o endereço em `src/config.js` (`API_URL`).
6. **Publique o app no GitHub Pages**: no repositório, *Settings → Pages → Deploy from a branch → main / (root)*. Depois troque `ORIGENS_PERMITIDAS` em `worker/wrangler.toml` pelo endereço do app e rode `npx wrangler deploy` de novo.

O servidor guarda cada busca por 10 minutos, para não consultar a loja à toa.

## Contas

Hoje o app funciona **sem conta**: CEP, ajustes e ofertas adicionadas ficam salvos só no aparelho (localStorage).

A conta será opcional. Ela serve para:

- ver as listas em qualquer aparelho;
- montar a lista do mês dos produtos que você sempre compra;
- receber aviso quando o preço por litro cair.

Plano técnico: login com Google ou link por e-mail (sem senha) usando Supabase, que guarda as listas num banco de dados com acesso só do próprio usuário. Ao criar a conta, o que já está salvo no aparelho é copiado para ela.

## Próximos passos

1. Ligar o servidor ao Mercado Livre e conferir os resultados reais.
2. Perfil com assinaturas (Prime, Meli+) para aplicar frete e benefícios sozinho.
3. Mais lojas por API oficial ou redes de afiliados (Amazon Creators API, Awin, Lomadee). Sem raspar sites.
4. Contas opcionais, lista do mês e alertas de preço.

## Princípio

O ranking é sempre pelo menor custo real. Se o app ganhar comissão de alguma loja no futuro, isso nunca muda a ordem das ofertas.

## Licença

MIT
