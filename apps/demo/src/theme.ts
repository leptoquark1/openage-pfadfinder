import type { LucideIcon } from 'lucide-react';
import { ArrowLeftRight, Circle, SignpostBig, Square, Target } from 'lucide-react';

/**
 * Design tokens, derived from the grid/flow-field vocabulary of the domain.
 * Canvas drawing reads these directly; the JSX uses the matching Tailwind
 * theme colors declared in `index.css` — keep both in sync.
 */
export const COLORS = {
  bg: '#0D1114',
  panel: '#14181C',
  border: '#242A30',
  borderStrong: '#333B43',
  textPrimary: '#E7EBEE',
  textSecondary: '#8A95A1',
  grid: '#1B2126',
  sector: '#242A30',
  target: '#F5A623',
  mob: '#4FD1C5',
  obstacle: '#FB7185',
  obstacleMoving: '#FDBA74',
  flow: '#2A3138',
  flowStrong: '#3E4954',
  // Performance panel — inside the frame budget, close to it, over it.
  perfGood: '#3FBF7F',
  perfWarn: '#F5A623',
  perfBad: '#E5484D',
} as const;

export type Mode = 'target' | 'mob' | 'obstacle' | 'movingObstacle' | 'patrolObstacle';
export type ModeType = 'target' | 'spawn' | 'obstacle';

export interface ModeDescriptor {
  readonly id: Mode
  readonly label: string
  readonly icon: LucideIcon
  readonly type: ModeType
}

export const MODES: ModeDescriptor[] = [
  { id: 'target', label: 'Target', icon: Target, type: 'target' },
  { id: 'mob', label: 'Mob', icon: Circle, type: 'spawn' },
  { id: 'obstacle', label: 'Wall', icon: Square, type: 'obstacle' },
  { id: 'movingObstacle', label: 'Moving', icon: SignpostBig, type: 'obstacle' },
  { id: 'patrolObstacle', label: 'Patrol', icon: ArrowLeftRight, type: 'obstacle' },
];
