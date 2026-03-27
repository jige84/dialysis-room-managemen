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
