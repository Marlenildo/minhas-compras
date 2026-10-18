// Entrada da versão de arquivo único do servidor (worker/pronto/worker.js), para colar no painel do Cloudflare.
// Leva o app junto: sem a pasta de arquivos (ASSETS), o endereço principal ainda abre o app.
import base from './index.js';
import APP from '../../dist/minhas-compras.html';
import PRIVACIDADE from '../../app/privacidade.html';
import LOGO from '../../app/assets/logo.svg';

const PAGINAS = {
  '/': [APP, 'text/html; charset=utf-8'],
  '/index.html': [APP, 'text/html; charset=utf-8'],
  '/privacidade.html': [PRIVACIDADE, 'text/html; charset=utf-8'],
  '/assets/logo.svg': [LOGO, 'image/svg+xml'],
};

export default {
  fetch(req, env, ctx) {
    const url = new URL(req.url);
    const pagina = !env.ASSETS && (req.method === 'GET' || req.method === 'HEAD') && PAGINAS[url.pathname];
    if (pagina) {
      return new Response(req.method === 'HEAD' ? null : pagina[0], {
        headers: { 'content-type': pagina[1], 'cache-control': 'public, max-age=300' },
      });
    }
    return base.fetch(req, env, ctx);
  },
};
