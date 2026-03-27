import type { ReactNode } from 'react';

export type PageShellProps = {
  children: ReactNode;
  /** 页面内副标题（顶栏已有主标题时可用于说明） */
  subtitle?: ReactNode;
  /** 标题右侧操作区 */
  extra?: ReactNode;
  /** 是否取消最大宽度（仪表盘等全宽图表页） */
  fullWidth?: boolean;
  className?: string;
};

/**
 * 统一页面内容区内边距与最大宽度；须包在 AppLayout 的 Outlet 内使用。
 */
export default function PageShell({
  children,
  subtitle,
  extra,
  fullWidth = false,
  className = '',
}: PageShellProps) {
  const shellClass = `hd-page-shell${fullWidth ? ' hd-page-shell--full' : ''} ${className}`.trim();

  const showHeader = subtitle != null || extra != null;

  return (
    <div className={shellClass}>
      {showHeader && (
        <div className="hd-page-shell__header">
          {subtitle != null && (
            <h2 className="hd-page-shell__title">{subtitle}</h2>
          )}
          {extra != null && <div className="hd-page-shell__extra">{extra}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
