import { build } from 'esbuild';

const production = process.env.NODE_ENV === 'production';

await build({
  entryPoints: ['./src/index.jsx'],
  bundle: true,
  platform: 'neutral',
  outfile: './dist/index.js',
  conditions: [ 'fastly' ],
  external: [ 'fastly:*' ],
  minify: production,
});
