import {build} from 'esbuild';
import {cp, mkdir, rm, writeFile} from 'node:fs/promises';

await rm('dist', {recursive: true, force: true});
await mkdir('dist', {recursive: true});

await build({
  entryPoints: ['src/main.js'],
  outfile: 'dist/app.js',
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  sourcemap: true,
});

await cp('index.html', 'dist/index.html');
await cp('index.html', 'dist/404.html');
await cp('styles.css', 'dist/styles.css');
await writeFile('dist/.nojekyll', '');

console.log('built -> dist/');
