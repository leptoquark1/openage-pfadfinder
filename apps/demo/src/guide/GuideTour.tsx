import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Fragment, useEffect, useId, useRef } from 'react';
import { Rich } from './panels.js';
import { CHAPTERS, type ChapterId, type Timeline } from './timeline.js';
import {
  holesPath,
  INTRO_SLIDES,
  type IntroSlide,
  placeTip,
  type Rect,
  type TipPlacement,
  type TourStop,
  tourFacts,
  unionRect,
} from './tour.js';

const PADDING = 5;

/** The whole journey as a line of dots, with the chapters of this slide lit up. */
function JourneyTrail({ slide, timeline }: { slide: IntroSlide; timeline: Timeline }) {
  const lit = (id: ChapterId) => slide.allChapters === true || slide.chapters.includes(id);
  const firstLit = CHAPTERS.findIndex(chapter => lit(chapter.id));
  const passed = (i: number) => firstLit >= 0 && i < firstLit;

  const stepsIn = (id: ChapterId) => timeline.steps.filter(step => step.chapter === id).length;
  const named = slide.chapters.map(id => CHAPTERS.find(chapter => chapter.id === id)!);
  const steps = named.length > 0 ? named.reduce((sum, c) => sum + stepsIn(c.id), 0) : timeline.steps.length;
  const caption = named.length > 0 ? named.map(c => c.title).join(' · ') : `${timeline.chapters.length} chapters`;

  return (
    <div>
      <div className="flex items-center" aria-hidden="true">
        {CHAPTERS.map((chapter, i) => (
          <Fragment key={chapter.id}>
            {i > 0 && (
              <span
                className={`h-0.5 flex-1 transition-colors duration-500 ${
                  lit(chapter.id) && lit(CHAPTERS[i - 1]!.id)
                    ? 'bg-mob'
                    : passed(i) || i === firstLit
                      ? 'bg-mob/40'
                      : 'bg-border-strong'
                }`}
              />
            )}
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full transition-all duration-500 ${
                lit(chapter.id)
                  ? 'scale-125 bg-mob shadow-[0_0_0_4px_rgba(79,209,197,0.2)]'
                  : passed(i)
                    ? 'bg-mob/40'
                    : 'bg-border-strong'
              }`}
            />
          </Fragment>
        ))}
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3 font-mono text-[12px]">
        <span className="text-fg/90">{caption}</span>
        <span className="shrink-0 text-muted tabular-nums">{steps} steps</span>
      </div>
    </div>
  );
}

/** One large thought beside the live map. The controls never move between slides. */
function IntroView({
  at,
  timeline,
  titleId,
  textId,
  onMove,
  onDone,
}: {
  at: number;
  timeline: Timeline;
  titleId: string;
  textId: string;
  onMove: (at: number) => void;
  onDone: () => void;
}) {
  const primary = useRef<HTMLButtonElement>(null);
  const slide = INTRO_SLIDES[at]!;
  const facts = tourFacts(timeline);

  useEffect(() => {
    primary.current?.focus();
  }, []);

  return (
    <div className="absolute inset-x-0 bottom-0 flex h-[60%] flex-col overflow-y-auto px-6 pb-5 min-[900px]:inset-y-0 min-[900px]:right-auto min-[900px]:left-[calc(clamp(2rem,6vw,6rem)-0.75rem)] min-[900px]:h-full min-[900px]:w-[calc(min(36vw,34rem)+1.5rem)] min-[900px]:px-3 min-[900px]:pb-[clamp(1.5rem,6vh,3.5rem)]">
      <div key={at} aria-live="polite" className="flex flex-1 flex-col justify-center py-3">
        <div className="animate-tour-in font-mono text-[12px] tracking-[0.14em] text-mob uppercase motion-reduce:animate-none">
          {slide.kicker}
        </div>
        <h2
          id={titleId}
          className="mt-3 animate-tour-in text-[clamp(2.25rem,4.4vw,4.25rem)] leading-[1.04] font-semibold tracking-[-0.02em] whitespace-pre-line text-fg [animation-delay:70ms] motion-reduce:animate-none"
        >
          {slide.headline(facts)}
        </h2>
        <p
          id={textId}
          className="mt-4 animate-tour-in text-[clamp(1rem,1.3vw,1.3rem)] leading-relaxed text-[#B4BEC8] [animation-delay:140ms] motion-reduce:animate-none"
        >
          {slide.text(facts)}
        </p>
      </div>

      <JourneyTrail slide={slide} timeline={timeline} />

      <div className="mt-5 flex items-center gap-2">
        <button
          ref={primary}
          type="button"
          onClick={() => onMove(at + 1)}
          className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-mob px-2 font-mono text-[13px] font-bold whitespace-nowrap text-bg transition-colors hover:bg-mob/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mob sm:w-56 sm:flex-none sm:px-4"
        >
          {slide.action}
          <ArrowRight size={17} strokeWidth={2.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Previous"
          onClick={() => onMove(at - 1)}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-fg/85 transition-colors hover:bg-border-strong ${
            at === 0 ? 'invisible' : ''
          }`}
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onDone}
          className="ml-auto rounded-md px-1.5 py-1 font-mono text-[11.5px] whitespace-nowrap text-muted transition-colors hover:text-fg"
        >
          Skip tour
        </button>
      </div>
    </div>
  );
}

/** The on-screen boxes of a stop's elements; these can move while the layout settles. */
function targetRects(name: string): Rect[] {
  return [...document.querySelectorAll(`[data-tour="${name}"]`)].flatMap(element => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0
      ? [{ x: box.x - PADDING, y: box.y - PADDING, w: box.width + PADDING * 2, h: box.height + PADDING * 2 }]
      : [];
  });
}

function placeArrow(arrow: HTMLElement, placed: TipPlacement): void {
  const { style } = arrow;
  style.display = placed.side ? 'block' : 'none';
  const along = `${placed.arrow - 6}px`;
  const edge = '-6px';
  style.left = placed.side === 'top' || placed.side === 'bottom' ? along : placed.side === 'right' ? edge : 'auto';
  style.right = placed.side === 'left' ? edge : 'auto';
  style.top = placed.side === 'left' || placed.side === 'right' ? along : placed.side === 'bottom' ? edge : 'auto';
  style.bottom = placed.side === 'top' ? edge : 'auto';
}

/** A shade with holes around the current elements, and a tooltip beside them. */
function SpotlightView({
  stop,
  position,
  count,
  titleId,
  textId,
  onBack,
  onNext,
  onDone,
}: {
  stop: TourStop;
  position: number;
  count: number;
  titleId: string;
  textId: string;
  onBack: () => void;
  onNext: () => void;
  onDone: () => void;
}) {
  const primary = useRef<HTMLButtonElement>(null);
  const shade = useRef<SVGPathElement>(null);
  const ring = useRef<SVGPathElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLSpanElement>(null);
  const flight = useRef<{ holes: readonly Rect[]; x: number; y: number } | null>(null);
  const last = position === count;

  useEffect(() => {
    primary.current?.focus();
  }, []);

  // Read the layout every frame, so the spotlight stays on elements that are still gliding.
  useEffect(() => {
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let before = performance.now();

    const frame = (now: number) => {
      const k = reducedMotion ? 1 : 1 - Math.exp(-Math.min(now - before, 64) / 85);
      before = now;
      const box = tip.current!;
      const view = { w: window.innerWidth, h: window.innerHeight };
      const size = { w: box.offsetWidth, h: box.offsetHeight };
      const goals = targetRects(stop.target);
      const placed: TipPlacement =
        goals.length > 0
          ? placeTip(unionRect(goals), size, view, stop.side)
          : { x: (view.w - size.w) / 2, y: (view.h - size.h) / 2, side: null, arrow: 0 };

      const from = flight.current;
      const towards = (a: number, b: number) => a + (b - a) * k;
      const holes = goals.map((goal, i) => {
        const start = from?.holes[i] ?? from?.holes[0] ?? goal;
        return {
          x: towards(start.x, goal.x),
          y: towards(start.y, goal.y),
          w: towards(start.w, goal.w),
          h: towards(start.h, goal.h),
        };
      });
      const x = from ? towards(from.x, placed.x) : placed.x;
      const y = from ? towards(from.y, placed.y) : placed.y;
      flight.current = { holes, x, y };

      const cutouts = holesPath(holes);
      shade.current?.setAttribute('d', `M0 0H${view.w}V${view.h}H0Z${cutouts}`);
      ring.current?.setAttribute('d', cutouts);
      box.style.transform = `translate(${x}px, ${y}px)`;
      box.style.visibility = 'visible';
      if (arrow.current) {
        placeArrow(arrow.current, placed);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [stop]);

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        <path ref={shade} fill="rgba(6, 9, 11, 0.74)" fillRule="evenodd" />
        <path ref={ring} className="fill-none stroke-mob" strokeWidth={2} />
      </svg>

      <div ref={tip} aria-live="polite" className="invisible absolute top-0 left-0 w-[min(20rem,calc(100vw-1.5rem))]">
        <span ref={arrow} className="absolute h-3 w-3 rotate-45 border border-mob/70 bg-panel" />
        <div className="relative max-h-[calc(100vh-1.5rem)] overflow-y-auto rounded-xl border border-mob/70 bg-panel p-4 shadow-[0_14px_40px_rgba(0,0,0,0.6)]">
          <div className="mb-1 font-mono text-[10.5px] text-mob tabular-nums">
            Interface · {position} of {count}
          </div>
          <h2 id={titleId} className="mb-1.5 text-[16px] leading-tight font-semibold">
            {stop.title}
          </h2>
          <p id={textId} className="text-[13px] leading-[1.55] text-[#B4BEC8]">
            <Rich text={stop.body} />
          </p>

          <div className="mt-3.5 flex items-center gap-1.5">
            {!last && (
              <button
                type="button"
                onClick={onDone}
                className="mr-auto rounded-md px-1.5 py-1 font-mono text-[11px] text-muted transition-colors hover:text-fg"
              >
                Skip tour
              </button>
            )}
            <button
              type="button"
              aria-label="Previous"
              onClick={onBack}
              className={`flex h-8 w-8 items-center justify-center rounded-full text-fg/85 transition-colors hover:bg-border-strong ${
                last ? 'mr-auto' : ''
              }`}
            >
              <ArrowLeft size={16} aria-hidden="true" />
            </button>
            <button
              ref={primary}
              type="button"
              onClick={onNext}
              className="flex h-8 items-center gap-1.5 rounded-full bg-mob px-3.5 font-mono text-[12px] font-semibold text-bg transition-colors hover:bg-mob/85"
            >
              {last ? 'Start the guide' : 'Next'}
              <ArrowRight size={15} strokeWidth={2.5} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * The start of the guide: a short intro of what it is about, then a walk
 * through the interface. The native modal <dialog> keeps focus inside and the
 * page behind it inert; Esc fires `cancel`.
 */
export function GuideTour({
  timeline,
  stops,
  at,
  onMove,
  onDone,
}: {
  timeline: Timeline;
  stops: readonly TourStop[];
  at: number;
  onMove: (at: number) => void;
  onDone: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const textId = useId();

  const intro = INTRO_SLIDES.length;
  const lastAt = intro + stops.length - 1;
  const stop = stops[at - intro];

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) {
      element.showModal();
      element.querySelector<HTMLElement>('button.bg-mob')?.focus();
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && at < lastAt) {
        onMove(at + 1);
      } else if (e.key === 'ArrowLeft' && at > 0) {
        onMove(at - 1);
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [at, lastAt, onMove]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={textId}
      onCancel={e => {
        e.preventDefault();
        onDone();
      }}
      className="fixed inset-0 m-0 h-screen max-h-none w-screen max-w-none overflow-hidden bg-transparent p-0 text-fg backdrop:bg-transparent"
    >
      {stop ? (
        <SpotlightView
          stop={stop}
          position={at - intro + 1}
          count={stops.length}
          titleId={titleId}
          textId={textId}
          onBack={() => onMove(at - 1)}
          onNext={() => (at === lastAt ? onDone() : onMove(at + 1))}
          onDone={onDone}
        />
      ) : (
        <IntroView at={at} timeline={timeline} titleId={titleId} textId={textId} onMove={onMove} onDone={onDone} />
      )}
    </dialog>
  );
}
