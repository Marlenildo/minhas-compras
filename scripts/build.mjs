// Junta index.html + src/core.js + src/app.js num único arquivo,
// que abre sozinho em qualquer navegador (dist/minhas-compras.html).
// Também gera dist/artifact.html, sem <html>/<head>/<body>, para publicar no Claude.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (p) => readFileSync(join(raiz, p), 'utf8');

// O motor fica no próprio escopo, para seus nomes internos não colidirem com os da tela
const fonteCore = ler('src/core.js');
const exportados = [...fonteCore.matchAll(/^export\s+(?:function|const|let|class)\s+(\w+)/gm)].map((m) => m[1]);
const core = fonteCore.replace(/^export\s+/gm, '');
const app = ler('src/app.js').replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*/m, '');
const script = `<script>\n(() => {\nconst { ${exportados.join(', ')} } = (() => {\n${core}\nreturn { ${exportados.join(', ')} };\n})();\n\n${app}\n})();\n</script>`;

const html = ler('index.html');
const completo = html.replace('<script type="module" src="src/app.js"></script>', () => script);
if (completo === html) throw new Error('Não achei a tag <script> de src/app.js em index.html');

const head = completo.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/, '')
  .replace(/<meta name="viewport"[^>]*>\s*/, '');
const body = completo.match(/<body>([\s\S]*?)<\/body>/)[1];

mkdirSync(join(raiz, 'dist'), { recursive: true });
writeFileSync(join(raiz, 'dist/minhas-compras.html'), completo);
writeFileSync(join(raiz, 'dist/artifact.html'), `${head.trim()}\n${body.trim()}\n`);
console.log('Gerado: dist/minhas-compras.html e dist/artifact.html');
