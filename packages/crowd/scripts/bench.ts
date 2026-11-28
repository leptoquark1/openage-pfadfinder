// Time per CrowdSimulation.step() for growing crowds, uniformly spread and
// jammed into one spot. Runs the built package: `pnpm benchmark` builds first.
import { buildGrid, COST_MIN, Pathfinder } from '@leptoquark1/openage-pfadfinder';
import { CrowdSimulation, DensityCostModel } from '../dist/index.js';

const COUNTS = [100, 500, 1_000, 5_000, 10_000];
const SIZE = 256;
const WARMUP = 40;
const TICKS = 60;

type Scenario = 'uniform' | 'jam';

function measure(count: number, scenario: Scenario, congestion: boolean): number {
  const pathfinder = new Pathfinder();
  pathfinder.addGrid(buildGrid(new Uint8Array(SIZE * SIZE).fill(COST_MIN), { width: SIZE, height: SIZE }, 16));
  const sim = new CrowdSimulation(pathfinder, 0, {
    timestep: 1 / 20,
    congestion: congestion ? new DensityCostModel() : null,
  });
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  // jam: everyone starts in a square of about 1.5 agents per cell around the goal
  const side = Math.sqrt(count / 1.5);
  for (let k = 0; k < count; k++) {
    const uniform = scenario === 'uniform';
    sim.addAgent({
      position: uniform
        ? { x: rnd() * SIZE, y: rnd() * SIZE }
        : { x: SIZE / 2 - side / 2 + rnd() * side, y: SIZE / 2 - side / 2 + rnd() * side },
      radius: 0.4,
      maxSpeed: 1.5 + rnd(),
      group: k % 8,
      goal: uniform ? { ne: Math.floor(rnd() * SIZE), se: Math.floor(rnd() * SIZE) } : { ne: SIZE / 2, se: SIZE / 2 },
    });
  }
  for (let t = 0; t < WARMUP; t++) {
    sim.step();
  }
  const times: number[] = [];
  for (let t = 0; t < TICKS; t++) {
    const t0 = performance.now();
    sim.step();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
}

const fmt = (ms: number) => `${ms.toFixed(2)}&#x2009;<small>ms</small>`;
const rows = [
  `Median time per \`step()\` (${TICKS} ticks after ${WARMUP} warm-up), ${SIZE}×${SIZE} map, sector size 16`,
  '',
  '| Agents | Uniform | Uniform + congestion | Jam | Jam + congestion |',
  '| ---: | ---: | ---: | ---: | ---: |',
];
for (const count of COUNTS) {
  const cells = [
    measure(count, 'uniform', false),
    measure(count, 'uniform', true),
    measure(count, 'jam', false),
    measure(count, 'jam', true),
  ];
  rows.push(`| **${count.toLocaleString('en')}** | ${cells.map(fmt).join(' | ')} |`);
}
console.log(rows.join('\n'));
