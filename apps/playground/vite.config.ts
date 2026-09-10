import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const speachesTarget = process.env.SPEACHES_URL || process.env.VITE_SPEACHES_URL || 'http://127.0.0.1:8090'
const llmTarget = process.env.LLM_PROXY_TARGET || process.env.VITE_LLM_PROXY_TARGET || 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@openclaw/character-kit': fileURLToPath(
        new URL('../../packages/character-kit/src/index.ts', import.meta.url),
      ),
      '@openclaw/voice-kit': fileURLToPath(
        new URL('../../packages/voice-kit/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5177,
    host: true,
    proxy: {
      '/api/speaches': {
        target: speachesTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/speaches/, ''),
      },
      '/api/llm': {
        target: llmTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/llm/, ''),
      },
    },
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
})
