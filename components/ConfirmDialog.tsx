'use client';

import { ReactNode, useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A modal confirmation built on <dialog>, which handles Esc, focus and the backdrop. */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-dialog-title"
      onCancel={event => {
        // Esc: let React state drive closing, so `open` stays the source of truth.
        event.preventDefault();
        onCancel();
      }}
      onClick={event => {
        // A click on the backdrop lands on the <dialog> element itself.
        if (event.target === event.currentTarget) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg bg-white p-6 backdrop:bg-black/50"
    >
      <h2 id="confirm-dialog-title" className="text-xl font-bold mb-4">{title}</h2>
      <div className="text-gray-600 mb-6">{children}</div>
      <div className="flex gap-3 justify-end">
        <button
          type="button"
          onClick={onCancel}
          autoFocus
          className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
