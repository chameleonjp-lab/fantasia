import { defineConfig } from 'vite';
import { uiOnlyTestPlugin } from './vite.ui-only-plugin.mjs';

export default defineConfig({
  base: './',
  plugins: [uiOnlyTestPlugin()],
  server: { host: '127.0.0.1', port: 4177, strictPort: true },
  build: { sourcemap: false },
});
