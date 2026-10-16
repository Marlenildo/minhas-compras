# Minhas Compras

Busque qualquer produto e veja onde comprar mais barato: ofertas de várias lojas, com frete, promoções, avaliações e, quando dá, o preço por litro, quilo ou unidade.

> Nome provisório. O nome definitivo do app ainda será escolhido.

## O que o app faz

- **Busca em várias lojas de uma vez** (Google Shopping): foto, ícone da loja, preço na loja, preço antigo e desconto, frete e avaliação.
- **Preço claro**: o preço da loja aparece em destaque; o frete e o total com frete logo abaixo; o preço por litro, kg ou unidade só aparece como etiqueta extra quando o tamanho é conhecido.
- **Destaques**: menor preço, menor total com frete, melhor preço por unidade e mais bem avaliado.
- **Filtros**: lojas (com ícone, quantidade de ofertas e menor preço de cada uma), faixa de preço, frete grátis, em promoção, 4 estrelas ou mais, com preço por unidade.
- **Ordenação**: relevância, menor preço, menor total com frete, menor preço por unidade, maior desconto, melhor avaliação.
- **Comparar**: escolha até 4 ofertas e veja lado a lado, com o melhor valor de cada linha em verde.
- **Onde comprar**: abre todas as lojas que vendem o produto, da menor para a maior total, com frete, cupom, parcelamento e **link direto para a loja**.
- **Corrigir ou informar o tamanho** de uma oferta ("900 ml", "1 kg", "12 unidades") para ganhar o preço por unidade.

Sem o servidor, o app roda em **modo demonstração**, com dois exemplos (sabonete líquido e fone bluetooth) e preços fictícios.

## Estrutura

```
app/index.html          página e estilos
app/src/core.js         motor de cálculo (funções puras, testadas)
app/src/app.js          tela: busca, filtros, destaques, comparação, onde comprar
app/src/fontes.js       de onde vêm os produtos (servidor ou demonstração)
app/src/demo.js         dados e ilustrações da demonstração
app/src/config.js       endereço do servidor de busca
app/assets/             logo
worker/                 servidor de busca (Google Shopping e Mercado Livre)
wrangler.toml           publicação no Cloudflare (app + servidor juntos)
scripts/build.mjs       versão de arquivo único (dist/)
test/                   testes do motor e do servidor
```

```bash
npm test                # testes
npm run build           # dist/minhas-compras.html, versão de arquivo único
npm run build:worker    # worker/pronto/worker.js, para colar no painel do Cloudflare
```

## Fontes de preço

O servidor (`worker/`) guarda as chaves de acesso; a página nunca chama as lojas direto.

- **Google Shopping, pela [SerpApi](https://serpapi.com)** (fonte principal). Plano gratuito de 250 buscas por mês.
  - `/api/buscar?q=...`: ofertas de várias lojas. 1 busca da cota.
  - `/api/lojas?token=...`: todas as lojas de um produto, com link direto. 1 busca da cota, só quando a pessoa clica em "Ver onde comprar".
  - Cada resposta fica guardada por 6 horas (`CACHE_HORAS`) no KV, então repetir não gasta cota.
- **Mercado Livre (API oficial)**: código pronto, inclusive a conexão da conta do dono (`/api/conectar`), mas o Mercado Livre bloqueia a busca de anúncios e a do catálogo para apps como este ("At least one policy returned UNAUTHORIZED"). Fica como reserva.

`/api/diagnostico` mostra a fonte ativa e as buscas restantes, sem mostrar as chaves.

## Hospedagem: tudo no Cloudflare

O app (`app/`) e o servidor (`worker/`) ficam no mesmo Worker, `minhas-compras-api` (veja `wrangler.toml`): o endereço principal abre o app e `/api/*` vai para o servidor. Com o repositório conectado ao Cloudflare, cada envio ao GitHub publica tudo sozinho.

1. No `wrangler.toml`, troque `COLE_AQUI_O_ID_DO_KV` pelo ID do namespace KV `minhas-compras-tokens`.
2. No Cloudflare: *Workers & Pages → minhas-compras-api → Settings → Build → Connect*, repositório `minhas-compras`, ramo `main`. Comando de build vazio; comando de deploy `npx wrangler deploy`.
3. Segredos no painel (*Settings → Variables and secrets*): `SERPAPI_KEY` e, para o Mercado Livre, `ML_CLIENT_ID`, `ML_CLIENT_SECRET` e `ADMIN_CHAVE`.

Sem a conexão com o GitHub, dá para publicar à mão com `npx wrangler deploy` na raiz do projeto.

## Favoritos, listas e conta

- **Sem conta:** favoritos, listas, quantidades, CEP e preferências ficam no aparelho (localStorage).
- **Com conta (entrar com Google):** o mesmo conteúdo vai para o banco D1 do Cloudflare e aparece em qualquer aparelho. O aparelho continua com uma cópia, então o app funciona sem internet e sincroniza quando a conexão volta.
- O Google só identifica a pessoa (nome, e-mail, foto). Nada do Gmail ou Drive.
- **Login:** `/api/auth/google` → Google → `/api/auth/google/retorno` → volta ao app com um código de uso único (`#login=...`, 2 minutos) → `POST /api/auth/trocar` devolve a sessão (90 dias; no banco fica só o hash).
- **Sincronização:** `GET /api/conta` e `PUT /api/conta/dados` com número de versão. Se outro aparelho salvou antes, o servidor responde 409 e o app junta os dois lados (`juntarConteudo`, em `app/src/salvos.js`): nada se perde, e o que foi apagado num aparelho não volta pelo outro.
- **Sair** (`POST /api/auth/sair`) encerra a sessão do aparelho. **Apagar minha conta** (`DELETE /api/conta`) apaga usuário, sessões e dados.
- Política de privacidade: `app/privacidade.html`.

Configuração no Cloudflare: banco D1 ligado como `DB`, KV como `TOKENS`, segredos `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`. No Google Cloud, o URI de redirecionamento é `https://minhas-compras-api.marlenildo.workers.dev/api/auth/google/retorno`.

## Próximos passos

1. Conferir os resultados reais e ajustar a leitura de tamanhos.
2. Histórico de preço e alerta de queda.
3. Alerta de queda de preço para os salvos.
4. Mais fontes por API oficial ou afiliados (Amazon Creators API, Awin). Sem raspar sites.

## Princípio

O ranking é sempre pelo menor custo real. Se o app ganhar comissão de alguma loja no futuro, isso nunca muda a ordem das ofertas.

## Licença

MIT
