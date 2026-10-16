// Junta index.html e os módulos de src/ num único arquivo, que abre sozinho
// em qualquer navegador (dist/minhas-compras.html). Também gera
// dist/artifact.html, sem <html>/<head>/<body>, para publicar no Claude.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (p) => readFileSync(join(raiz, p), 'utf8');

// Ordem: cada módulo só depende dos anteriores
const MODULOS = ['core.js', 'config.js', 'demo.js', 'fontes.js', 'app.js'];

function empacotar(nome) {
  let fonte = ler(`src/${nome}`);
  const exportados = [...fonte.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map((m) => m[1]);
  fonte = fonte
    .replace(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/([\w.-]+)['"];?/g, (_, nomes, mod) => {
      if (!MODULOS.includes(mod)) throw new Error(`${nome} importa ${mod}, que não está na lista de módulos`);
      return `const {${nomes}} = M['${mod}'];`;
    })
    .replace(/^export\s+/gm, '');
  return `M['${nome}'] = (() => {\n${fonte}\nreturn { ${exportados.join(', ')} };\n})();`;
}

const script = `<script>\n(() => {\nconst M = {};\n${MODULOS.map(empacotar).join('\n\n')}\n})();\n</script>`;

const html = ler('index.html');
const completo = html.replace('<script type="module" src="src/app.js"></script>', () => script);
if (completo === html) throw new Error('Não achei a tag <script> de src/app.js em index.html');

const head = completo
  .match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/, '')
  .replace(/<meta name="viewport"[^>]*>\s*/, '');
const body = completo.match(/<body>([\s\S]*?)<\/body>/)[1];

mkdirSync(join(raiz, 'dist'), { recursive: true });
writeFileSync(join(raiz, 'dist/minhas-compras.html'), completo);
writeFileSync(join(raiz, 'dist/artifact.html'), `${head.trim()}\n${body.trim()}\n`);
console.log('Gerado: dist/minhas-compras.html e dist/artifact.html');
