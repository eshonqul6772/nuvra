import { URL, fileURLToPath } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

import pkg from './package.json' with { type: 'json' };

/** Packages the consuming app resolves itself; bundling them would duplicate Vue. */
const EXTERNAL_PACKAGES = Object.keys(pkg.peerDependencies);

// https://vite.dev/guide/build#library-mode
export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'index',
      cssFileName: 'style'
    },
    rolldownOptions: {
      // Subpath imports such as `vue/...` stay external as well.
      external: id => EXTERNAL_PACKAGES.some(name => id === name || id.startsWith(`${name}/`))
    },
    sourcemap: true
  }
});
