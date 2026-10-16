// Conta no app: entrar com Google, manter a sessão e sincronizar os salvos com o servidor.
// A sessão fica só neste aparelho e nunca entra no conteúdo sincronizado.
import { API_URL } from './config.js';
import { juntarConteudo } from './salvos.js';

const CHAVE_SESSAO = 'minhas-compras:sessao';
const CHAVE_VERSAO = 'minhas-compras:versao';
const CHAVE_USUARIO = 'minhas-compras:usuario';

const ler = (k) => {
  try {
    return localStorage.getItem(k);
  } catch (_) {
    return null;
  }
};
const gravar = (k, v) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch (_) {
    /* sem armazenamento */
  }
};

/**
 * lerConteudo(): o que sincronizar (salvos, listas, preferências);
 * aplicarConteudo(c): grava no app o conteúdo juntado;
 * aoMudar(estado): redesenha a tela da conta.
 */
export function criarConta({ lerConteudo, aplicarConteudo, aoMudar, avisar }) {
  const estado = {
    disponivel: Boolean(API_URL),
    sessao: ler(CHAVE_SESSAO),
    usuario: (() => {
      try {
        return JSON.parse(ler(CHAVE_USUARIO) || 'null');
      } catch (_) {
        return null;
      }
    })(),
    versao: Number(ler(CHAVE_VERSAO) || 0),
    situacao: 'parado', // parado | sincronizando | sincronizado | offline | erro
    ultimaSinc: null,
    pendente: false,
  };
  let timer = null;
  let emAndamento = null;

  const mudou = () => aoMudar?.(estado);

  async function pedir(caminho, opcoes = {}) {
    const r = await fetch(`${API_URL}${caminho}`, {
      ...opcoes,
      headers: {
        accept: 'application/json',
        ...(opcoes.body ? { 'content-type': 'application/json' } : {}),
        ...(estado.sessao ? { authorization: `Bearer ${estado.sessao}` } : {}),
        ...(opcoes.headers || {}),
      },
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, j };
  }

  function guardarSessao(sessao, usuario) {
    estado.sessao = sessao;
    estado.usuario = usuario;
    gravar(CHAVE_SESSAO, sessao);
    gravar(CHAVE_USUARIO, usuario ? JSON.stringify(usuario) : null);
  }

  function esquecerSessao() {
    guardarSessao(null, null);
    estado.versao = 0;
    gravar(CHAVE_VERSAO, null);
    estado.situacao = 'parado';
    mudou();
  }

  function definirVersao(v) {
    estado.versao = v;
    gravar(CHAVE_VERSAO, String(v));
  }

  /** Manda o conteúdo do aparelho; se outro aparelho salvou antes, junta e tenta de novo. */
  async function enviar(tentativa = 0) {
    if (!estado.sessao) return;
    estado.situacao = 'sincronizando';
    mudou();
    let resp;
    try {
      resp = await pedir('/api/conta/dados', { method: 'PUT', body: JSON.stringify({ versaoBase: estado.versao, conteudo: lerConteudo() }) });
    } catch (_) {
      estado.situacao = 'offline';
      estado.pendente = true;
      return mudou();
    }
    if (resp.status === 401) {
      esquecerSessao();
      return avisar?.('Sua sessão terminou. Entre de novo para continuar sincronizando.');
    }
    if (resp.status === 409 && tentativa < 3) {
      aplicarConteudo(juntarConteudo(lerConteudo(), resp.j.conteudo || {}));
      definirVersao(resp.j.versao || 0);
      return enviar(tentativa + 1);
    }
    if (!resp.ok) {
      estado.situacao = 'erro';
      estado.pendente = true;
      return mudou();
    }
    definirVersao(resp.j.versao);
    estado.pendente = false;
    estado.situacao = 'sincronizado';
    estado.ultimaSinc = new Date();
    mudou();
  }

  /** Busca o que está na conta e junta com o aparelho. */
  async function sincronizar() {
    if (!estado.sessao) return;
    if (emAndamento) return emAndamento;
    emAndamento = (async () => {
      estado.situacao = 'sincronizando';
      mudou();
      let resp;
      try {
        resp = await pedir('/api/conta');
      } catch (_) {
        estado.situacao = 'offline';
        return mudou();
      }
      if (resp.status === 401) return esquecerSessao();
      if (!resp.ok) {
        estado.situacao = 'erro';
        return mudou();
      }
      estado.usuario = resp.j.usuario;
      gravar(CHAVE_USUARIO, JSON.stringify(resp.j.usuario));
      const remoto = resp.j.dados;
      if (!remoto) return enviar(); // conta nova: leva o que está no aparelho
      if (remoto.versao === estado.versao && !estado.pendente) {
        estado.situacao = 'sincronizado';
        estado.ultimaSinc = new Date();
        return mudou();
      }
      aplicarConteudo(juntarConteudo(lerConteudo(), remoto.conteudo));
      definirVersao(remoto.versao);
      return enviar();
    })().finally(() => (emAndamento = null));
    return emAndamento;
  }

  return {
    estado,

    /** Ao abrir o app: termina um login que voltou do Google, ou sincroniza a sessão guardada. */
    async iniciar() {
      if (!estado.disponivel) return mudou();
      const hash = location.hash || '';
      const codigo = hash.match(/[#&]login=([\w-]+)/)?.[1];
      const erro = hash.match(/[#&]login_erro=(\w+)/)?.[1];
      if (codigo || erro) history.replaceState(null, '', location.pathname + location.search);
      if (erro) avisar?.(erro === 'cancelado' ? 'Login cancelado.' : 'Não deu para entrar com o Google. Tente de novo.');
      if (codigo) {
        try {
          const r = await pedir('/api/auth/trocar', { method: 'POST', body: JSON.stringify({ codigo }) });
          if (!r.ok) throw new Error(r.j.erro || 'Não deu para entrar.');
          guardarSessao(r.j.sessao, r.j.usuario);
          estado.versao = 0; // primeira vez neste aparelho: junta tudo
          avisar?.(`Olá, ${(r.j.usuario?.nome || '').split(' ')[0] || 'tudo certo'}! Seus salvos agora vão para a sua conta.`);
        } catch (e) {
          avisar?.(e.message);
        }
      }
      mudou();
      await sincronizar();
      // Volta a sincronizar quando a pessoa volta para o app ou a internet volta
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sincronizar());
      addEventListener('online', () => (estado.pendente ? enviar() : sincronizar()));
    },

    entrar() {
      if (!estado.disponivel) return avisar?.('A conta funciona na versão publicada do app, não na demonstração.');
      const volta = `${location.origin}${location.pathname}`;
      location.href = `${API_URL}/api/auth/google?${new URLSearchParams({ volta })}`;
    },

    /** Avisa que algo mudou nos salvos: envia daqui a pouco, juntando várias mudanças. */
    mudou() {
      if (!estado.sessao) return;
      estado.pendente = true;
      clearTimeout(timer);
      timer = setTimeout(() => enviar(), 1200);
    },

    sincronizar,

    async sair() {
      try {
        if (estado.pendente) await enviar();
        await pedir('/api/auth/sair', { method: 'POST' });
      } catch (_) {
        /* sai mesmo sem internet */
      }
      esquecerSessao();
      avisar?.('Você saiu da conta. Seus salvos continuam neste aparelho.');
    },

    async apagarConta() {
      const r = await pedir('/api/conta', { method: 'DELETE' }).catch(() => null);
      if (!r || !r.ok) return avisar?.('Não deu para apagar agora. Confira a internet e tente de novo.');
      esquecerSessao();
      avisar?.('Sua conta e os dados dela foram apagados. O que está neste aparelho continua aqui.');
    },
  };
}
