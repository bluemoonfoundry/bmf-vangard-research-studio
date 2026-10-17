/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative asset paths so dist/index.html loads correctly over file:// in Electron.
  base: './',
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    sourcemap: true,
  },
  test: {
    projects: [
      {
        // Electron main-process code: plain Node, real filesystem.
        extends: true,
        test: {
          name: 'main',
          include: ['electron/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // React renderer.
        extends: true,
        test: {
          name: 'renderer',
          include: ['src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
        },
      },
    ],
  },
});
