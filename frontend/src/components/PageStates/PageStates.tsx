import { Empty, Result, Spin } from 'antd';
import type { ReactNode } from 'react';

type PageLoadingProps = {
  tip?: string;
  children?: ReactNode;
};

/** 页面级加载：居中 Spin */
export function PageLoading({ tip = '加载中…', children }: PageLoadingProps) {
  return (
    <div className="hd-page-loading" style={{ padding: '48px 24px', textAlign: 'center' }}>
      <Spin size="large" tip={tip}>
        {children ?? <div style={{ minHeight: 120 }} />}
      </Spin>
    </div>
  );
}

type PageEmptyProps = {
  description?: ReactNode;
  extra?: ReactNode;
};

/** 列表/区块空数据 */
export function PageEmpty({ description = '暂无数据', extra }: PageEmptyProps) {
  return (
    <div style={{ padding: '40px 16px' }}>
      <Empty description={description}>{extra}</Empty>
    </div>
  );
}

type PageErrorProps = {
  title?: string;
  subTitle?: ReactNode;
  extra?: ReactNode;
};

/** 权限或严重错误 */
export function PageErrorResult({
  title = '无法访问',
  subTitle = '您可能没有权限或资源不存在。',
  extra,
}: PageErrorProps) {
  return (
    <div style={{ padding: '48px 16px' }}>
      <Result status="403" title={title} subTitle={subTitle} extra={extra} />
    </div>
  );
}
