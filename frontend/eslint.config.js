/**
 * ESLint 扁平配置（ESLint 9+）
 * 主要作用：对 `src` 下 TS/TSX 启用推荐规则、React Hooks 与 Vite Fast Refresh。
 * 主要功能：忽略 `dist`；浏览器全局；与 TypeScript ESLint 推荐集成的基线代码质量门禁。
 */
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
