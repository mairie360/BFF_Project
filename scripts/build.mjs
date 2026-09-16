// Construit dist/index.js pour l'image de production.
//
// Les paquets @mairie360/*-openapi sont publiés en TypeScript (leur `main` est un .ts) : `tsc` ne les
// compile pas et `node dist/index.js` ne peut donc pas les charger. esbuild les intègre au bundle ; les
// autres dépendances restent externes et sont résolues dans node_modules comme avant.
import { build } from 'esbuild';

const bundleOnlyGeneratedClients = {
  name: 'bundle-only-generated-clients',
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, ({ path }) =>
      path.startsWith('@mairie360/') ? undefined : { external: true },
    );
  },
};

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  plugins: [bundleOnlyGeneratedClients],
});
