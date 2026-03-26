import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('react-router')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/antd') || id.includes('@ant-design')) {
            return 'antd-vendor';
          }
          if (id.includes('node_modules/recharts')) {
            return 'chart-vendor';
          }
        }
      }
    }
  }
})
