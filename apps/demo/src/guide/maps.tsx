import { COST_IMPASSABLE } from '@leptoquark1/openage-pfadfinder/shared';
import { Check, ChevronLeft } from 'lucide-react';
import { type Ref, useEffect, useRef } from 'react';
import { INK } from './render.js';
import { type Cell, COLS, ROWS, SCENARIOS, type Scenario } from './scenarios.js';
import { CHAPTERS } from './timeline.js';

const PREVIEW_CELL = 3;

/** A miniature of the map, so the difference between maps is visible at a glance. */
export function MapPreview({ scenario }: { scenario: Scenario }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.fillStyle = INK.freeAlt;
    ctx.fillRect(0, 0, COLS * PREVIEW_CELL, ROWS * PREVIEW_CELL);
    scenario.costs.forEach((cost, i) => {
      if (cost > 1) {
        ctx.fillStyle = cost === COST_IMPASSABLE ? INK.wallTop : INK.mudLine;
        ctx.fillRect((i % COLS) * PREVIEW_CELL, Math.floor(i / COLS) * PREVIEW_CELL, PREVIEW_CELL, PREVIEW_CELL);
      }
    });
    const pin = (cell: Cell, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(cell.ne * PREVIEW_CELL - 1, cell.se * PREVIEW_CELL - 1, PREVIEW_CELL + 2, PREVIEW_CELL + 2);
    };
    pin(scenario.start, INK.chain);
    pin(scenario.target, INK.open);
  }, [scenario]);

  return (
    <span aria-hidden="true" className="shrink-0">
      <canvas
        ref={ref}
        width={COLS * PREVIEW_CELL}
        height={ROWS * PREVIEW_CELL}
        className="block h-[54px] w-[72px] rounded-sm ring-1 ring-border-strong [image-rendering:pixelated]"
      />
    </span>
  );
}

/** All maps with what each one demonstrates and where to look for it. */
export function MapPicker({
  scenario,
  onScenario,
  onBack,
  backRef,
}: {
  scenario: Scenario;
  onScenario: (scenario: Scenario) => void;
  onBack: () => void;
  backRef: Ref<HTMLButtonElement>;
}) {
  return (
    <div>
      <button
        ref={backRef}
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 rounded-md py-1 pr-2 pl-1 font-mono text-[11px] text-muted transition-colors hover:bg-border/60 hover:text-fg"
      >
        <ChevronLeft size={14} aria-hidden="true" />
        Chapters
      </button>
      <p className="px-2 pt-1.5 pb-2.5 text-[12px] leading-snug text-[#B4BEC8]">
        Each map puts the Pfadfinder in a different situation. You stay in your current chapter when you switch.
      </p>

      <fieldset aria-label="Map" className="flex flex-col gap-1">
        {SCENARIOS.map(option => {
          const active = scenario.id === option.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => onScenario(option)}
              className={`flex w-full items-start gap-2.5 rounded-lg border p-2 text-left transition-colors ${
                active ? 'border-mob/60 bg-mob/10' : 'border-transparent hover:bg-border/60'
              }`}
            >
              <MapPreview scenario={active ? scenario : option} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 font-mono text-[12px] font-semibold text-fg">
                  {option.name}
                  {active && <Check size={13} strokeWidth={3} className="text-mob" aria-hidden="true" />}
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-[#B4BEC8]">{option.hint}</span>
                <span className="mt-1 block font-mono text-[10px] text-mob">
                  Watch: {CHAPTERS.find(c => c.id === option.watch)!.title}
                </span>
              </span>
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}
