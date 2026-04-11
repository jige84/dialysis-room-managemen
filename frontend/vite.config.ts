/**
 * Vite 构建与开发服务器配置
 * 主要作用：配置 React 插件、开发端口及将 /api 代理到后端，便于本地联调。
 * 主要功能：server.port 5173；proxy /api → localhost:3080（与 backend .env PORT 一致）；生产分包 manualChunks。
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3080',
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
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }
          if (id.includes('react-router')) {
            return 'router-vendor';
          }
          if (id.includes('node_modules/recharts')) {
            return 'chart-vendor';
          }
          if (id.includes('node_modules/tesseract.js')) {
            return 'ocr-vendor';
          }
          if (id.includes('@ant-design/icons')) {
            return 'antd-icons';
          }
          if (id.includes('node_modules/dayjs')) {
            return 'dayjs-vendor';
          }
          if (id.includes('node_modules/zustand') || id.includes('node_modules/axios')) {
            return 'data-vendor';
          }
        }
      }
    }
  }
})
