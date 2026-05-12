import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Resolve tfhe from @cofhe/sdk's nested node_modules (pnpm isolates it there)
let tfhePath: string;
try {
  tfhePath = path.dirname(
    require.resolve('tfhe/package.json', {
      paths: [path.resolve(__dirname, '../node_modules/@cofhe/sdk')],
    }),
  );
} catch {
  // Fallback to workspace root node_modules
  tfhePath = path.dirname(
    require.resolve('tfhe/package.json', {
      paths: [path.resolve(__dirname, '../node_modules')],
    }),
  );
}

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
        const url = req.url || '';

        if (url.includes('zkProve.worker.js')) {
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
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
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
  envDir: '..',
  plugins: [cofheWorkerPlugin(), react(), wasm()],
  resolve: {
    alias: {
      tfhe: tfhePath,
      // @cofhe/react imports @cofhe/abi — pnpm stores it in frontend's own node_modules
      '@cofhe/abi': path.resolve(__dirname, 'node_modules/@cofhe/abi'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3002',
      '/mcp': {
        target: 'http://localhost:3001',
        ws: false,
        rewrite: (path) => path.replace(/^\/mcp/, ''),
      },
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
      '@cofhe/sdk/web',
      '@cofhe/sdk > tweetnacl',
      '@cofhe/sdk > zustand',
      '@cofhe/sdk > immer',
      '@cofhe/sdk > zod',
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
