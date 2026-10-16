// Junta index.html e os módulos de src/ num único arquivo, que abre sozinho
// em qualquer navegador (dist/minhas-compras.html). Também gera
// dist/artifact.html, sem <html>/<head>/<body>, para publicar no Claude.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (p) => readFileSync(join(raiz, p), 'utf8');

// Ordem: cada módulo só depende dos anteriores
const MODULOS = ['core.js', 'config.js', 'demo.js', 'fontes.js', 'relevancia.js', 'facetas.js', 'salvos.js', 'conta.js', 'app.js'];

function empacotar(nome, { demo = false } = {}) {
  let fonte = ler(`app/src/${nome}`);
  // A versão publicada no Claude não pode chamar outros sites: fica em demonstração
  if (demo && nome === 'config.js') fonte = fonte.replace(/export const API_URL = '[^']*';/, "export const API_URL = '';");
  const exportados = [...fonte.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((m) => m[1]);
  fonte = fonte
    .replace(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/([\w.-]+)['"];?/g, (_, nomes, mod) => {
      if (!MODULOS.includes(mod)) throw new Error(`${nome} importa ${mod}, que não está na lista de módulos`);
      return `const {${nomes}} = M['${mod}'];`;
    })
    .replace(/^export\s+/gm, '');
  return `M['${nome}'] = (() => {\n${fonte}\nreturn { ${exportados.join(', ')} };\n})();`;
}

const script = (opcoes) => `<script>\n(() => {\nconst M = {};\n${MODULOS.map((m) => empacotar(m, opcoes)).join('\n\n')}\n})();\n</script>`;

const html = ler('app/index.html');
const TAG = '<script type="module" src="src/app.js"></script>';
if (!html.includes(TAG)) throw new Error('Não achei a tag <script> de src/app.js em index.html');
const completo = html.replace(TAG, () => script({}));
const demo = html.replace(TAG, () => script({ demo: true }));

const head = demo
  .match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/, '')
  .replace(/<meta name="viewport"[^>]*>\s*/, '')
  .replace(/<link rel="icon"[^>]*>\s*/, '');
const body = demo.match(/<body>([\s\S]*?)<\/body>/)[1];

mkdirSync(join(raiz, 'dist'), { recursive: true });
writeFileSync(join(raiz, 'dist/minhas-compras.html'), completo);
writeFileSync(join(raiz, 'dist/artifact.html'), `${head.trim()}\n${body.trim()}\n`);
console.log('Gerado: dist/minhas-compras.html e dist/artifact.html');
