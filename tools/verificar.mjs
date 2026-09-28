// Chequeos antes de publicar: node tools/verificar.mjs
//  - version.json y APP_VERSION (js/config.js) coinciden;
//  - todos los ASSETS de sw.js existen;
//  - todos los archivos de js/, css/, vendor/ e icons/ están en ASSETS (si no, no funcionan offline).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const leer = (p) => readFileSync(join(RAIZ, p), 'utf8');
const errores = [];

const versionJson = JSON.parse(leer('version.json')).version;
const appVersion = leer('js/config.js').match(/APP_VERSION\s*=\s*'([^']+)'/)?.[1];
if (versionJson !== appVersion) errores.push(`version.json (${versionJson}) ≠ APP_VERSION en js/config.js (${appVersion})`);

const assets = [...leer('sw.js').match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
for (const a of assets) {
  if (a !== './' && !existsSync(join(RAIZ, a))) errores.push(`sw.js: ASSETS incluye '${a}', que no existe`);
}

function archivos(dir) {
  return readdirSync(join(RAIZ, dir)).flatMap((n) => {
    const p = join(dir, n);
    return statSync(join(RAIZ, p)).isDirectory() ? archivos(p) : [relative('.', p).replaceAll('\\', '/')];
  });
}
for (const f of ['js', 'css', 'vendor', 'icons'].flatMap(archivos)) {
  if (!assets.includes(f)) errores.push(`sw.js: falta '${f}' en ASSETS`);
}

if (errores.length) {
  console.error('✗ ' + errores.join('\n✗ '));
  process.exit(1);
}
console.log(`✓ Versión ${appVersion} consistente, ${assets.length} assets en el precache.`);
