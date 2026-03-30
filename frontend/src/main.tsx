/**
 * 前端应用挂载入口
 * 主要作用：将根组件渲染到 DOM，并启用 React 18 StrictMode。
 * 主要功能：引入全局样式（index.css、page.css）；创建 createRoot 并渲染 App。
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './styles/page.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
