import { buildGrid, COST_MIN, Pathfinder, PathResult } from '@leptoquark1/openage-pfadfinder';
import { describe, expect, it } from 'vitest';
import * as crowd from '../src/index.ts';

describe('package entry', () => {
  it('exports the agent states', () => {
    expect(Object.values(crowd.AgentState)).toEqual(['IDLE', 'MOVING', 'ARRIVED', 'UNREACHABLE', 'STUCK']);
  });

  it('exports the vector helpers', () => {
    expect(crowd.length(crowd.vec2(3, 4))).toBe(5);
  });

  it('resolves the pathfinder peer', () => {
    const pathfinder = new Pathfinder();
    pathfinder.addGrid(buildGrid(new Uint8Array(32 * 32).fill(COST_MIN), { width: 32, height: 32 }, 16));
    const path = pathfinder.getPath({ gridId: 0, start: { ne: 1, se: 1 }, target: { ne: 30, se: 30 } });
    expect(path.result).toBe(PathResult.FOUND);
  });
});
