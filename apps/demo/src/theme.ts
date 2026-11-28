import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight,
  Circle,
  Droplets,
  Flag,
  Footprints,
  SignpostBig,
  Square,
  Target,
  Trees,
  WavesHorizontal,
} from 'lucide-react';
import { TERRAINS, type TerrainId } from './world/terrain.js';

/**
 * Design tokens, derived from the grid/flow-field vocabulary of the domain.
 * Canvas drawing reads these directly; the JSX uses the matching Tailwind
 * theme colors declared in `index.css` — keep both in sync.
 */
export const COLORS = {
  primary: '#4fd1c5',
  secondary: '#F5A623',
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

/** Fill of each terrain on the canvas, drawn translucent under the flow field. */
export const TERRAIN_COLORS: Record<TerrainId, string> = {
  sand: '#D9B26F',
  forest: '#3E9A5C',
  mud: '#9A6B43',
  swamp: '#7C8A3A',
};

const TERRAIN_ICONS: Record<TerrainId, LucideIcon> = {
  sand: Footprints,
  forest: Trees,
  mud: Droplets,
  swamp: WavesHorizontal,
};

export type Mode = 'target' | 'start' | 'mob' | 'obstacle' | 'movingObstacle' | 'patrolObstacle' | TerrainId;
export type ModeType = 'target' | 'spawn' | 'obstacle' | 'terrain';

export interface ModeDescriptor {
  readonly id: Mode;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly type: ModeType;
  /** Cell cost the mode paints — terrain modes only. */
  readonly cost?: number;
}

export const MODES: ModeDescriptor[] = [
  { id: 'target', label: 'Target', icon: Target, type: 'target' },
  // crowd scene only: the selected group's start
  { id: 'start', label: 'Start', icon: Flag, type: 'target' },
  { id: 'mob', label: 'Mob', icon: Circle, type: 'spawn' },
  { id: 'obstacle', label: 'Wall', icon: Square, type: 'obstacle' },
  { id: 'movingObstacle', label: 'Moving', icon: SignpostBig, type: 'obstacle' },
  { id: 'patrolObstacle', label: 'Patrol', icon: ArrowLeftRight, type: 'obstacle' },
  ...TERRAINS.map(t => ({
    id: t.id,
    label: t.label,
    icon: TERRAIN_ICONS[t.id],
    type: 'terrain' as const,
    cost: t.cost,
  })),
];

/** The terrain a mode paints, or null when it paints none. */
export function terrainOfMode(mode: Mode): TerrainId | null {
  return TERRAINS.some(t => t.id === mode) ? (mode as TerrainId) : null;
}
