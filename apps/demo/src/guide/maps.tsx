import { COST_IMPASSABLE } from '@leptoquark1/openage-pfadfinder';
import { Check, ChevronLeft, RotateCcw } from 'lucide-react';
import { type Ref, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { INK } from './canvas/ink.js';
import { type Cell, COLS, differsFrom, ROWS, SCENARIOS, type Scenario } from './scenarios.js';
import { CHAPTERS } from './story/chapters.js';

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
  const activeMap = useRef<HTMLButtonElement>(null);
  const preset = SCENARIOS.find(option => option.id === scenario.id)!;

  // The reset button is gone afterwards, so keyboard focus moves to the restored map.
  const reset = () => {
    flushSync(() => onScenario(preset));
    activeMap.current?.focus();
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <button
          ref={backRef}
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-md py-1 pr-2 pl-1 font-mono text-[11px] text-muted transition-colors hover:bg-border/60 hover:text-fg"
        >
          <ChevronLeft size={14} aria-hidden="true" />
          Chapters
        </button>
        {differsFrom(scenario, preset) && (
          <button
            type="button"
            aria-label={`Reset map: ${scenario.name}`}
            title="Discard your changes to this map"
            onClick={reset}
            className="flex items-center gap-1 rounded-md py-1 pr-2 pl-1.5 font-mono text-[11px] text-muted transition-colors hover:bg-border/60 hover:text-fg"
          >
            <RotateCcw size={13} aria-hidden="true" />
            Reset map
          </button>
        )}
      </div>
      <p className="px-2 pt-1.5 pb-2.5 text-[12px] leading-snug text-[#B4BEC8]">
        Each map puts <span className="text-secondary">Pfadfinder</span> in a different situation. You stay in your
        current chapter when you switch.
      </p>

      <fieldset aria-label="Map" className="flex flex-col gap-1">
        {SCENARIOS.map(option => {
          const active = scenario.id === option.id;
          return (
            <button
              key={option.id}
              ref={active ? activeMap : undefined}
              type="button"
              aria-pressed={active}
              onClick={active ? undefined : () => onScenario(option)}
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
