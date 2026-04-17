import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Resolve tfhe from cofhejs's nested node_modules (pnpm isolates it there)
const tfhePath = path.dirname(
  require.resolve('tfhe/package.json', {
    paths: [path.resolve(__dirname, '../node_modules/cofhejs')],
  }),
);

// Resolve @cofhe/sdk dist directory for worker file serving
const cofheSdkDistPath = path.dirname(
  require.resolve('@cofhe/sdk/web'),
);

// Plugin to serve zkProve.worker.js from the correct location in dev mode.
// When @cofhe/sdk is pre-bundled, the worker URL resolves to .vite/deps/ but
// the worker file isn't copied there. This plugin intercepts that request and
// rewrites the bare `import('tfhe')` to a Vite-resolvable URL.
function cofheWorkerPlugin(): Plugin {
  return {
    name: 'cofhe-worker-serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.includes('zkProve.worker.js')) {
          const workerPath = path.join(cofheSdkDistPath, 'zkProve.worker.js');
          if (fs.existsSync(workerPath)) {
            let content = fs.readFileSync(workerPath, 'utf-8');
            // Rewrite bare `import('tfhe')` to absolute /@fs/ URL so the module
            // worker can resolve it through Vite's dev server
            const tfheEntry = path.join(tfhePath, 'tfhe.js');
            content = content.replace(
              /import\(\s*['"]tfhe['"]\s*\)/g,
              `import("/@fs${tfheEntry}")`,
            );
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(content);
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [cofheWorkerPlugin(), react(), wasm()],
  resolve: {
    alias: {
      'cofhejs/node': 'cofhejs/web',
      tfhe: tfhePath,
      // @cofhe/react imports @cofhe/abi but pnpm hoists it to the workspace root
      '@cofhe/abi': path.resolve(__dirname, '..', 'node_modules/@cofhe/abi'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3002',
    },
    fs: {
      allow: ['..', '../..', '../../node_modules'],
    },
    headers: {
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  build: {
    outDir: 'dist',
  },
  optimizeDeps: {
    exclude: ['tfhe'],
    include: [
      'cofhejs/web',
      'cofhejs > tweetnacl',
      'cofhejs > zustand',
      'cofhejs > immer',
      'cofhejs > zod',
    ],
  },
  assetsInclude: ['**/*.wasm'],
  define: {
    global: 'globalThis',
  },
  worker: {
    format: 'es',
  },
});
