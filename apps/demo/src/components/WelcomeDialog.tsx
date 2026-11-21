import { ArrowRight } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';

interface WelcomeDialogProps {
  /** The visitor chose: the guide link navigates by itself, the playground is already behind the dialog. */
  onDone: () => void;
}

/**
 * First-visit greeting that invites to the guide, on the native <dialog>.
 * Esc counts as skipping. A backdrop click does not, so a stray click cannot
 * use up the only time this appears.
 */
export function WelcomeDialog({ onDone }: WelcomeDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const textId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={textId}
      onCancel={e => {
        e.preventDefault();
        onDone();
      }}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-2xl border border-border-strong bg-panel p-0 text-muted shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop:bg-bg/70 backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col gap-5 p-6">
        <div>
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={32} height={32} className="mb-4" />
          <h2 id={titleId} className="mb-2 text-2xl font-semibold text-fg">
            Welcome!
          </h2>
          <p id={textId} className="text-[14.5px] leading-relaxed text-[#B4BEC8]">
            How does a whole crowd find its way across a map without every unit searching for itself? Let’s open up the
            Pfadfinder and watch it work, one step at a time.
          </p>
        </div>

        <a
          href={`${import.meta.env.BASE_URL}guide.html`}
          onClick={onDone}
          className="group flex flex-col gap-1 rounded-xl bg-mob px-4 py-3.5 text-bg transition-colors hover:bg-mob/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mob"
        >
          <span className="flex items-center justify-between gap-2 font-mono text-[14px] font-bold">
            Start the guided tour
            <ArrowRight
              size={18}
              strokeWidth={2.5}
              className="shrink-0 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </span>
          <span className="text-[12.5px] leading-snug text-bg/80">
            See a grid take shape, follow a path from start to target and read the real API calls. You set the pace.
          </span>
        </a>

        <div className="-mt-1 flex justify-end">
          <button
            type="button"
            onClick={onDone}
            className="rounded-md px-1.5 py-1 font-mono text-[11px] text-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-mob"
          >
            Skip Guide, Jump right in...
          </button>
        </div>
      </div>
    </dialog>
  );
}
