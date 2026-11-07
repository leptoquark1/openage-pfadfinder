import { TriangleAlert } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Modal confirmation built on the native <dialog>: showModal() traps focus
 * and makes the page behind it inert; Esc fires `cancel`.
 */
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    }
    else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> element itself.
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
      className="m-auto w-80 rounded-lg border border-border-strong bg-panel p-0 font-mono text-xs text-muted backdrop:bg-bg/70 backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <div className="flex items-center gap-2 text-fg">
          <TriangleAlert size={16} strokeWidth={1.75} className="text-target" aria-hidden="true" />
          <span>{title}</span>
        </div>
        <div className="leading-relaxed">{children}</div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-muted transition-colors hover:text-fg"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md border border-border-strong bg-bg px-3 py-1.5 text-fg transition-colors hover:border-target"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
