// Builds everything from src/ and connector/:
//   index.html                          the calculator as one file (what people download)
//   dist/dcf-calculator-v<version>.html  the same file, named for a release
//   dist/artifact.html                  the calculator for publishing inside claude.ai
//   dist/dcf-connector-v<version>.js     the Claude connector for a Cloudflare Worker
// The maths in src/dcf-core.js is pasted into the calculator and bundled into the connector,
// and the connector's code is embedded in the calculator so Settings → Claude can hand it out.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');
const CORE_FILE = join(here, 'src/dcf-core.js');

// The core is a plain script (const DCF = …); the connector imports it as a module.
const coreModule = {
  name: 'dcf-core',
  setup(b) {
    b.onResolve({ filter: /dcf-core\.js$/ }, (args) => ({ path: resolve(args.resolveDir, args.path) }));
    b.onLoad({ filter: /dcf-core\.js$/ }, (args) => ({ contents: readFileSync(args.path, 'utf8') + '\nexport default DCF;\n', loader: 'js' }));
  },
};

export async function bundle(entry, { minify = false } = {}) {
  const out = await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', target: ['es2022'],
    write: false, minify, legalComments: 'none', charset: 'utf8', logLevel: 'warning', plugins: [coreModule],
  });
  return out.outputFiles[0].text;
}

export async function buildConnector() {
  let code = await bundle(join(here, 'connector/src/worker.js'));
  const version = /VERSION = "([^"]+)"/.exec(code)[1];
  const cfg = /var CONFIG = \(?\s*(?:\/\*DCF_CONFIG\*\/)?\s*\{\s*apiKey: "",\s*projectId: "",\s*secret: ""\s*\}\s*(?:\/\*END_DCF_CONFIG\*\/)?\s*\)?;/;
  if (!cfg.test(code)) throw new Error('Could not find the CONFIG line in the connector bundle');
  code = code.replace(cfg, 'var CONFIG = /*DCF_CONFIG*/{"apiKey":"","projectId":"","secret":""}/*END_DCF_CONFIG*/;');
  const head = `// DCF Calculator connector for Claude, version ${version}
// Paste this whole file into a Cloudflare Worker (Edit code → select all → paste → Deploy).
// It lets Claude run DCF valuations with the calculator's own maths and save them to your
// calculator. It signs in to your own Firebase project as you and keeps no data of its own.
// Get your personal copy from the calculator → Sync & Claude; the values in CONFIG are yours.
`;
  return { code: head + code, version };
}

// The page as published in claude.ai (no <html> or <head>: the artifact host adds them).
function assemble(connector) {
  let s = read('src/app.html');
  const core = readFileSync(CORE_FILE, 'utf8');
  if (!s.includes('/*@DCF_CORE@*/')) throw new Error('src/app.html has no /*@DCF_CORE@*/ marker');
  s = s.replace('/*@DCF_CORE@*/', () => core.trim());
  if (s.includes('/*@CONNECTOR_CODE@*/')) {
    // A JSON string, with "</" broken up so the code can't end the page's <script>.
    const lit = JSON.stringify(connector.code).replace(/<\//g, '<\\/').split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');
    s = s.replace('/*@CONNECTOR_CODE@*/', () => lit);
  }
  return s;
}

// The downloadable page: the artifact source wrapped in a full HTML document.
function wrap(src) {
  const version = /const APP_VERSION = '([0-9.]+)';/.exec(src)[1];
  const cut = src.indexOf('</style>\n') + '</style>\n'.length;
  const headPart = src.slice(0, cut).replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '');
  const body = src.slice(cut);
  const skeleton = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    + '<meta name="version" content="' + version + '">\n'
    + '<meta name="description" content="A free stock valuation calculator: estimate what a share is worth from the cash the company should bring in over the next ten years.">\n'
    + '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>\n';
  return { html: skeleton + headPart + '</head>\n<body>\n' + body.trimEnd() + '\n</body>\n</html>\n', version };
}

export async function buildAll() {
  const connector = existsSync(join(here, 'connector/src/worker.js')) ? await buildConnector() : { code: '', version: '' };
  const artifact = assemble(connector);
  const { html, version } = wrap(artifact);
  mkdirSync(join(here, 'dist'), { recursive: true });
  writeFileSync(join(here, 'dist/artifact.html'), artifact);
  writeFileSync(join(here, 'index.html'), html);
  writeFileSync(join(here, `dist/dcf-calculator-v${version}.html`), html);
  if (connector.code) writeFileSync(join(here, `dist/dcf-connector-v${connector.version}.js`), connector.code);
  return { version, connectorVersion: connector.version, sizes: { page: html.length, connector: connector.code.length } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await buildAll();
  console.log(`index.html  ${(r.sizes.page / 1024).toFixed(0)} KB  (calculator v${r.version})`);
  if (r.connectorVersion) console.log(`dist/dcf-connector-v${r.connectorVersion}.js  ${(r.sizes.connector / 1024).toFixed(0)} KB`);
}
