import { it } from 'vitest';
import { CostField, Integrator } from '@leptoquark1/openage-pfadfinder';
import { COST_MIN } from '@leptoquark1/openage-pfadfinder/shared';

it('benchmark Integrator.get', () => {
  const integrator = new Integrator();
  const bench = (size: number) => {
    const costField = new CostField(size);
    const cells = costField.getCosts();
    for (let i = 0; i < cells.length; i++) {
      cells[i] = i % 7 === 0 ? 200 : COST_MIN;
    }
    const target = { ne: size >> 1, se: size >> 1 };

    // Warm-up.
    for (let i = 0; i < 5; i++) {
      integrator.get(costField, target);
    }
    const iters = size <= 8 ? 2000 : size <= 32 ? 300 : 50;
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) {
      integrator.get(costField, target);
    }
    console.log(`Integrator.get ${size}x${size}: ${((performance.now() - t0) / iters).toFixed(3)} ms per call`);
  };

  bench(8);
  bench(32);
  bench(128);
});
