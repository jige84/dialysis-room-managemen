/**
 * 隔离区标签展示组件
 * 主要作用：根据患者隔离区枚举渲染带颜色的 Tag，与 constants/isolation 配置一致。
 * 主要功能：接收 isolation_zone；映射为中文标签与样式类名。
 */
import {
  ISOLATION_ZONE_DISPLAY,
  type IsolationZone,
} from '../../constants/isolation';

type Props = {
  zone: IsolationZone | string;
  className?: string;
};

/**
 * 隔离区展示 — 样式类来自 index.css，文案来自 constants/isolation
 */
export default function IsolationZoneTag({ zone, className }: Props) {
  const key = zone in ISOLATION_ZONE_DISPLAY ? (zone as IsolationZone) : 'normal';
  const cfg = ISOLATION_ZONE_DISPLAY[key];
  return (
    <span className={`${cfg.className}${className ? ` ${className}` : ''}`}>
      {cfg.label}
    </span>
  );
}
