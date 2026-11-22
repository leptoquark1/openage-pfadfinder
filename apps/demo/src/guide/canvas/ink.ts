import { COLORS } from '../../theme.js';

export const INK = {
  free: '#171D22',
  freeAlt: '#1A2127',
  mud: '#3B3320',
  mudLine: '#7A6733',
  wall: '#3A2029',
  wallTop: COLORS.obstacle,
  frame: '#4A5563',
  portal: '#7DD3FC',
  open: COLORS.target,
  closed: '#5C6773',
  chain: COLORS.mob,
  shadow: COLORS.obstacle,
  sight: '#FDE68A',
  text: COLORS.textPrimary,
  muted: COLORS.textSecondary,
} as const;

export const AREA_COLORS = ['#4FD1C5', '#A78BFA', '#F5A623', '#FB7185', '#7DD3FC', '#86EFAC'] as const;
