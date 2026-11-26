import { build, transform } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
const out = 'dist';
await mkdir(out, { recursive: true });
await copyFile('src/overlay/OFL.txt', `${out}/OFL.txt`);
// Every browser entry shares the overlay implementation and this one lazy font URL.
const lazyFont = {
  name: 'shared-font',
  setup(builder) {
    builder.onResolve({ filter: /^\.\/font-loader$/ }, () => ({ path: 'font-loader', namespace: 'browser-font' }));
    builder.onLoad({ filter: /.*/, namespace: 'browser-font' }, () => ({
      contents:
        "export async function loadHandwritingFont(){return (await import('./proofmarks-font.js')).handwritingFont;}",
      loader: 'js',
    }));
    builder.onResolve({ filter: /^\.\/proofmarks-font\.js$/ }, () => ({
      path: './proofmarks-font.js',
      external: true,
    }));
  },
};
// Protect colors with var() placeholders while minifying: esbuild otherwise rounds alpha and clips wide-gamut colors.
async function minifyStylesheet(text) {
  const kept = [],
    hexColor = /#[0-9a-fA-F]{3,8}\b/y,
    colorFunction = /(oklch|oklab|lch|lab|hwb|hsla?|rgba?|color-mix|color)\(/y;
  let protectedText = '';
  for (let i = 0; i < text.length;) {
    hexColor.lastIndex = colorFunction.lastIndex = i;
    const hex = hexColor.exec(text);
    if (hex) {
      protectedText += `var(--proofmarks-kept-${kept.push(hex[0]) - 1})`;
      i += hex[0].length;
      continue;
    }
    const name = colorFunction.exec(text);
    if (!name || /[\w-]/.test(text[i - 1] ?? '')) {
      protectedText += text[i++];
      continue;
    }
    let depth = 0,
      end = i + name[1].length;
    do {
      if (text[end] === '(') depth++;
      else if (text[end] === ')') depth--;
      end++;
    } while (depth > 0 && end < text.length);
    protectedText += `var(--proofmarks-kept-${kept.push(text.slice(i, end).replace(/\s+/g, ' ')) - 1})`;
    i = end;
  }
  const { code } = await transform(protectedText, { loader: 'css', minify: true });
  return code.trim().replace(/var\(--proofmarks-kept-(\d+)\)/g, (_, n) => kept[Number(n)]);
}
const minifyCss = {
  name: 'minify-css',
  setup(builder) {
    builder.onLoad({ filter: /[\\/]src[\\/]overlay[\\/][^\\/]+\.tsx?$/ }, async args => {
      const source = await readFile(args.path, 'utf8');
      if (!source.includes('css`')) return undefined;
      let contents = '',
        last = 0;
      for (const match of source.matchAll(/\bcss`([^`]*)`/g)) {
        if (match[1].includes('${')) throw new Error(`${args.path}: a css\`\` stylesheet can't interpolate values`);
        contents += source.slice(last, match.index) + JSON.stringify(await minifyStylesheet(match[1]));
        last = match.index + match[0].length;
      }
      return { contents: contents + source.slice(last), loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts' };
    });
  },
};
// Keep the React development guard for the consuming application's bundler.
const common = {
  define: { 'process.env.NODE_ENV': 'process.env.NODE_ENV' },
  bundle: true,
  minify: true,
  platform: 'browser',
  target: 'es2022',
  write: false,
  format: 'esm',
};
const entries = await build({
  ...common,
  entryPoints: {
    index: 'src/overlay/index.ts',
    'overlay/react': 'src/overlay/react.tsx',
    'script-entry': 'src/overlay/script.ts',
  },
  splitting: true,
  outdir: out,
  chunkNames: 'chunk-[hash]',
  external: ['react'],
  plugins: [lazyFont, minifyCss],
});
const font = await build({
  ...common,
  entryPoints: ['src/overlay/font-data.ts'],
  outfile: `${out}/proofmarks-font.js`,
});
const bootstrap = `(()=>{const script=document.currentScript;const source=script?.src||location.href;import(new URL('script-entry.js',source).href).then(module=>module.bootProofmarks(script)).catch(()=>console.warn('Proofmarks could not load its page script.'));})();\n`;
const files = [...entries.outputFiles, ...font.outputFiles];
for (const file of files) {
  await mkdir(path.dirname(file.path), { recursive: true });
  await writeFile(file.path, file.contents);
}
await writeFile(`${out}/script.js`, bootstrap);
const sizes = [
  ...files.map(file => ({
    file: path.relative(path.resolve(out), file.path),
    bytes: file.contents.byteLength,
    gzip: gzipSync(file.contents).byteLength,
  })),
  { file: 'script.js', bytes: Buffer.byteLength(bootstrap), gzip: gzipSync(bootstrap).byteLength },
];
await writeFile(`${out}/sizes.json`, JSON.stringify(sizes, null, 2) + '\n');
console.error(JSON.stringify(sizes, null, 2));
