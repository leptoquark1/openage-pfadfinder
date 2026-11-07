import { type LucideIcon, MouseLeft, MouseRight } from 'lucide-react';
import { COLORS } from '../theme.js';

const ACTIONS: { label: string, icon: LucideIcon }[] = [
  { icon: MouseLeft, label: 'Place Object' },
  { icon: MouseRight, label: 'Remove Object' },
];

const ITEMS: { color: string, label: string, dashed?: boolean, collapse?: boolean }[] = [
  { color: COLORS.target, label: 'Target' },
  { color: COLORS.mob, label: 'Mob' },
  { color: COLORS.obstacle, label: 'Obstacle' },
  { color: COLORS.obstacleMoving, label: 'Moving Obstacle' },
  { color: COLORS.obstacleMoving, label: 'Patrol Obstacle', dashed: true, collapse: true },
  { color: COLORS.flowStrong, label: 'Flow-Field' },
];

function LegendSectionTitle({ label }: { label: string }) {
  return (
    <div className="mb-2 font-bold">
      <span className="border-b border-divider text-section pl-0.5 pb-1">
        {label}
        :
      </span>
    </div>
  );
}

export function Legend() {
  return (
    <div className="absolute bottom-3.5 right-3.5 flex flex-col gap-1 rounded-lg border border-border bg-panel/85 px-3 py-2 backdrop-blur-sm text-[11px] text-muted font-mono max-w-96">
      <LegendSectionTitle label="Actions" />

      <div className="flex flex-row gap-3.5">
        {ACTIONS.map(action => (
          <span key={action.label} className="flex flex-row gap-1.5 items-center justify-center">
            <action.icon className="inline-block font-mono text-[11px]" size={18} strokeWidth={1.75} />
            {' '}
            {action.label}
          </span>
        ))}
      </div>

      <div className="mb-3"></div>

      <LegendSectionTitle label="Identifiers" />

      <div className="flex flex-row gap-3.5 flex-wrap">
        {ITEMS.map(item => (
          <div key={item.label} className="flex items-center justify-center gap-1.5">
            {item.dashed
              ? (
                  <span className={'inline-block size-4 border-t-2 border-dashed' + (item.collapse ? ' h-1' : '')} style={{ borderColor: item.color }} />
                )
              : (
                  <span className={'inline-block size-4 rounded-[3px]' + (item.collapse ? ' h-1' : '')} style={{ background: item.color }} />
                )}
            <span className="font-mono">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
