// SPDX-License-Identifier: GPL-3.0-only
//
// Builds the exit page into dist/: one self-contained index.html (its script
// and style inline, allowed by their sha256 in the page's Content-Security-
// Policy, and the licences of the bundled packages in a comment at its end),
// plus the same licences as licenses.txt. The same source always
// gives the same bytes: no time stamps, no paths of this machine.
//
//   node scripts/build-page.ts            build and write dist/
//   node scripts/build-page.ts --twice    build twice and compare (as CI does)

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build, transform, type Plugin } from 'esbuild';
import { NODES, OWN_NODE_HOSTS } from '../page/src/config.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const at = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

export interface PageBuild {
  html: string;
  licenses: string;
  sha256: string;
  csp: string;
  /** The npm packages inside the page's script, as name@version. */
  packages: string[];
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest();

export function contentSecurityPolicy(scriptHash: string, styleHash: string): string {
  // "Use my own node" takes http or https on this device only (chain.ts ownNodeUrl): exactly these.
  const ownNodes = OWN_NODE_HOSTS.flatMap((h) => [`http://${h}:*`, `https://${h}:*`]);
  return [
    "default-src 'none'",
    `script-src 'sha256-${scriptHash}'`,
    `style-src 'sha256-${styleHash}'`,
    `connect-src ${[...NODES, ...ownNodes].join(' ')}`,
    "img-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
  ].join('; ');
}

function packageOf(input: string): string | null {
  const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//u.exec(input);
  return m ? m[1]! : null;
}

function licenseText(name: string): { version: string; license: string; text: string } {
  const dir = at(`node_modules/${name}`);
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) as { version: string; license?: string };
  const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE'].find((f) => existsSync(`${dir}/${f}`));
  return { version: pkg.version, license: pkg.license ?? 'UNKNOWN', text: file ? readFileSync(`${dir}/${file}`, 'utf8').trim() : '(no licence file in the package)' };
}

/**
 * viem's accounts module names every BIP-39 word list, but the page uses only the English one. The lists are plain
 * data with no side effects, so the build may leave out the ones nothing uses.
 */
const unusedWordLists: Plugin = {
  name: 'unused-word-lists',
  setup(b) {
    // esbuild filters are Go regular expressions (no look-ahead), so English is let through in the handler.
    b.onResolve({ filter: /^@scure\/bip39\/wordlists\/[a-z-]+$/ }, async (args) => {
      if (args.pluginData === 'inner' || args.path.endsWith('/english')) return undefined;
      const r = await b.resolve(args.path, { kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, pluginData: 'inner' });
      return { ...r, sideEffects: false };
    });
  },
};

export async function buildPage(): Promise<PageBuild> {
  const js = await build({
    absWorkingDir: ROOT,
    entryPoints: ['page/src/main.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
    // ASCII only (other characters as \u escapes): the bytes the browser hashes for the CSP are then the same
    // whatever character set a host names.
    charset: 'ascii',
    metafile: true,
    logLevel: 'silent',
    plugins: [unusedWordLists],
  });
  const script = js.outputFiles[0]!.text.trim();
  if (/<\/script|<!--|<script/iu.test(script)) throw new Error('the bundled script holds a sequence that would end an inline script');
  const css = await transform(await readFile(at('page/style.css'), 'utf8'), { loader: 'css', minify: true, charset: 'ascii', legalComments: 'none' });
  const style = css.code.trim();
  if (/<\/style/iu.test(style)) throw new Error('the style holds </style');
  if (/[^\x00-\x7f]/u.test(script + style)) throw new Error('the script or style holds a character outside ASCII');

  const csp = contentSecurityPolicy(sha256(script).toString('base64'), sha256(style).toString('base64'));
  // Only what is really in the script: a module the build left out entirely brings no code and no licence.
  const used = Object.entries(Object.values(js.metafile.outputs)[0]!.inputs).filter(([, i]) => i.bytesInOutput > 0).map(([path]) => path);
  const names = [...new Set(used.map(packageOf).filter((n): n is string => n !== null))].sort();
  const packages: string[] = [];
  const parts = [
    'Tytle account exit: the packages bundled into index.html, with their licences.',
    'The page itself is GPL-3.0-only: https://github.com/loekj/tytle-recovery',
  ];
  for (const name of names) {
    const l = licenseText(name);
    packages.push(`${name}@${l.version}`);
    parts.push(`${'='.repeat(78)}\n${name}@${l.version} (${l.license})\n\n${l.text}`);
  }
  const licenses = parts.join('\n\n') + '\n';
  // The licences go into an HTML comment, so every copy of the one file carries them. "--" could end it early.
  if (licenses.includes('--')) throw new Error('a licence text holds "--": it cannot go into an HTML comment as it is');

  const template = await readFile(at('page/index.html'), 'utf8');
  const html = template
    .replace('{{CSP}}', () => csp)
    .replace('{{STYLE}}', () => style)
    .replace('{{SCRIPT}}', () => script)
    .replace('{{LICENSES}}', () => licenses);
  return { html, licenses, sha256: sha256(html).toString('hex'), csp, packages };
}

if (import.meta.main) {
  const first = await buildPage();
  if (process.argv.includes('--twice')) {
    const second = await buildPage();
    if (first.html !== second.html || first.licenses !== second.licenses) throw new Error('two builds differ: the build is not reproducible');
    console.log('two builds are byte for byte the same');
  }
  await mkdir(at('dist'), { recursive: true });
  await writeFile(at('dist/index.html'), first.html);
  await writeFile(at('dist/licenses.txt'), first.licenses);
  console.log(`dist/index.html  ${Buffer.byteLength(first.html)} bytes  sha256 ${first.sha256}`);
  console.log(`bundled: ${first.packages.join(', ')}`);
}
