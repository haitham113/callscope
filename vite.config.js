import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: process.env.CALLSCOPE_BASE_PATH || '/',
  plugins: [vue()],
  base: '/callscope/',
  build: {
    target: 'es2022',
  },
  test: {
    include: ['tests/unit/**/*.test.js'],
  },
})
