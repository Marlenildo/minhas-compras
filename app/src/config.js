// Endereço do servidor de busca (pasta worker/), sem barra no final.
// O app e o servidor ficam no mesmo Worker (minhas-compras), então a página
// chama o próprio endereço: compras.marlenildo.online, ou o workers.dev.
// Aberto como arquivo (dist/minhas-compras.html), usa o endereço principal.
// Vazio = modo demonstração, com produtos e preços fictícios.
const ENDERECO_PRINCIPAL = 'https://compras.marlenildo.online';

export const API_URL =
  typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? location.origin
    : ENDERECO_PRINCIPAL;
