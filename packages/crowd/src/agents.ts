import type { AgentView } from './context.js';
import { type AgentId, AgentState } from './types.js';

const STATES: readonly AgentState[] = [
  AgentState.IDLE,
  AgentState.MOVING,
  AgentState.ARRIVED,
  AgentState.UNREACHABLE,
  AgentState.STUCK,
];
const STATE_CODE: Readonly<Record<AgentState, number>> = {
  IDLE: 0,
  MOVING: 1,
  ARRIVED: 2,
  UNREACHABLE: 3,
  STUCK: 4,
};

/** Numeric code of a state, as stored in `AgentStore.stateCode`. */
export function stateCode(state: AgentState): number {
  return STATE_CODE[state];
}

/**
 * Agents as structure of arrays, densely packed in ascending id.
 *
 * Removing an agent only marks it; `compact()` closes the gaps, keeping the
 * order, so iteration by index is always iteration by id.
 */
export class AgentStore implements AgentView {
  count = 0;
  ids = new Float64Array(16);
  px = new Float64Array(16);
  py = new Float64Array(16);
  pvx = new Float64Array(16);
  pvy = new Float64Array(16);
  rad = new Float64Array(16);
  speed = new Float64Array(16);
  accel = new Float64Array(16);
  grp = new Float64Array(16);
  goalX = new Int32Array(16);
  goalY = new Int32Array(16);
  goalSet = new Uint8Array(16);
  stateCode = new Uint8Array(16);
  alive = new Uint8Array(16);
  /** Where the agent stood when it last made progress, and since when (seconds). */
  refX = new Float64Array(16);
  refY = new Float64Array(16);
  stall = new Float64Array(16);

  private readonly indexById = new Map<AgentId, number>();
  private dead = 0;
  private nextId = 0;
  /** Largest radius ever added. */
  maxRadius = 0;

  add(x: number, y: number, radius: number, maxSpeed: number, maxAccel: number, group: number): AgentId {
    if (this.count === this.ids.length) {
      this.grow(this.count * 2);
    }
    const i = this.count++;
    const id = this.nextId++;
    this.ids[i] = id;
    this.px[i] = x;
    this.py[i] = y;
    this.pvx[i] = 0;
    this.pvy[i] = 0;
    this.rad[i] = radius;
    this.speed[i] = maxSpeed;
    this.accel[i] = maxAccel;
    this.grp[i] = group;
    this.goalSet[i] = 0;
    this.stateCode[i] = STATE_CODE.IDLE;
    this.alive[i] = 1;
    this.refX[i] = x;
    this.refY[i] = y;
    this.stall[i] = 0;
    this.indexById.set(id, i);
    this.maxRadius = Math.max(this.maxRadius, radius);
    return id;
  }

  /** Mark an agent as removed; false if it did not exist. */
  remove(id: AgentId): boolean {
    const i = this.indexById.get(id);
    if (i === undefined) {
      return false;
    }
    this.indexById.delete(id);
    this.alive[i] = 0;
    this.dead++;
    return true;
  }

  /** Close the gaps of removed agents, keeping the id order. */
  compact(): void {
    if (this.dead === 0) {
      return;
    }
    let w = 0;
    for (let r = 0; r < this.count; r++) {
      if (!this.alive[r]) {
        continue;
      }
      if (w !== r) {
        this.ids[w] = this.ids[r]!;
        this.px[w] = this.px[r]!;
        this.py[w] = this.py[r]!;
        this.pvx[w] = this.pvx[r]!;
        this.pvy[w] = this.pvy[r]!;
        this.rad[w] = this.rad[r]!;
        this.speed[w] = this.speed[r]!;
        this.accel[w] = this.accel[r]!;
        this.grp[w] = this.grp[r]!;
        this.goalX[w] = this.goalX[r]!;
        this.goalY[w] = this.goalY[r]!;
        this.goalSet[w] = this.goalSet[r]!;
        this.stateCode[w] = this.stateCode[r]!;
        this.alive[w] = 1;
        this.refX[w] = this.refX[r]!;
        this.refY[w] = this.refY[r]!;
        this.stall[w] = this.stall[r]!;
        this.indexById.set(this.ids[w]!, w);
      }
      w++;
    }
    this.count = w;
    this.dead = 0;
  }

  /** Remove everything. */
  clear(): void {
    this.count = 0;
    this.dead = 0;
    this.indexById.clear();
  }

  isAlive(i: number): boolean {
    return this.alive[i] === 1;
  }

  indexOf(id: AgentId): number {
    return this.indexById.get(id) ?? -1;
  }

  id(i: number): AgentId {
    return this.ids[i]!;
  }

  x(i: number): number {
    return this.px[i]!;
  }

  y(i: number): number {
    return this.py[i]!;
  }

  vx(i: number): number {
    return this.pvx[i]!;
  }

  vy(i: number): number {
    return this.pvy[i]!;
  }

  radius(i: number): number {
    return this.rad[i]!;
  }

  maxSpeed(i: number): number {
    return this.speed[i]!;
  }

  group(i: number): number {
    return this.grp[i]!;
  }

  state(i: number): AgentState {
    return STATES[this.stateCode[i]!]!;
  }

  hasGoal(i: number): boolean {
    return this.goalSet[i] === 1;
  }

  goalNe(i: number): number {
    return this.goalX[i]!;
  }

  goalSe(i: number): number {
    return this.goalY[i]!;
  }

  private grow(capacity: number): void {
    const f64 = (a: Float64Array) => {
      const b = new Float64Array(capacity);
      b.set(a);
      return b;
    };
    const i32 = (a: Int32Array) => {
      const b = new Int32Array(capacity);
      b.set(a);
      return b;
    };
    const u8 = (a: Uint8Array) => {
      const b = new Uint8Array(capacity);
      b.set(a);
      return b;
    };
    this.ids = f64(this.ids);
    this.px = f64(this.px);
    this.py = f64(this.py);
    this.pvx = f64(this.pvx);
    this.pvy = f64(this.pvy);
    this.rad = f64(this.rad);
    this.speed = f64(this.speed);
    this.accel = f64(this.accel);
    this.grp = f64(this.grp);
    this.goalX = i32(this.goalX);
    this.goalY = i32(this.goalY);
    this.goalSet = u8(this.goalSet);
    this.stateCode = u8(this.stateCode);
    this.alive = u8(this.alive);
    this.refX = f64(this.refX);
    this.refY = f64(this.refY);
    this.stall = f64(this.stall);
  }
}
