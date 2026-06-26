// FIX (R-06.a) : build separe, navigateur uniquement (IIFE), pour permettre
// le snippet <script src="https://cdn.money-pulse.org/checkout.js"></script>
// affiche aux marchands (cf. ClientPaymentSettings.tsx / ClientIntegration.tsx).
// N'affecte PAS le build npm existant (tsc -> dist/index.js, CommonJS,
// consomme par require()/import depuis Node ou un bundler tiers) : ce
// fichier est un point d'entree de build additionnel, jamais appele par
// `npm run build` (qui reste `tsc`), seulement par le nouveau script
// `build:cdn` ajoute dans package.json.
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'MoneyPulse',
      formats: ['iife'],
      fileName: () => 'checkout.iife.js',
    },
    outDir: 'dist',
    emptyOutDir: false, // ne pas effacer dist/index.js produit par tsc
    rollupOptions: {
      output: {
        // Le SDK n'a aucune dependance externe (verifie : aucun import
        // tiers dans src/index.ts), donc aucun "global" a mapper ici.
        extend: true,
      },
    },
  },
});
