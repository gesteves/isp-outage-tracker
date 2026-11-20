'use client';

import { FormEvent, KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { AnnotationInput, MAX_NOTE_LENGTH, fromDateTimeLocal, toDateTimeLocal } from '@/lib/annotations';

interface NoteDialogProps {
  /** "Add Note" or "Edit Note". */
  title: string;
  /** Prefilled time (epoch ms). */
  initialTime: number;
  initialText?: string;
  /** Returns false if the note couldn't be saved, which keeps the dialog open. */
  onSave: (input: AnnotationInput) => boolean;
  onCancel: () => void;
}

const fieldClass =
  'mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';

/**
 * Adds or edits a note in the history, e.g. "Switched to the new router". Opens as
 * soon as it's mounted; the parent unmounts it to close it.
 */
export default function NoteDialog({ title, initialTime, initialText = '', onSave, onCancel }: NoteDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const timeId = useId();
  const textId = useId();
  const [time, setTime] = useState(() => toDateTimeLocal(initialTime));
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const ms = fromDateTimeLocal(time);
    if (ms === null) {
      setError('Enter a date and time.');
      return;
    }
    if (text.trim() === '') {
      setError('Write something to note.');
      return;
    }
    if (!onSave({ time: ms, text })) setError('The note couldn’t be saved.');
  };

  // Enter adds a line, like any text box; Cmd/Ctrl+Enter saves.
  const onTextKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={event => {
        event.preventDefault();
        onCancel();
      }}
      onClick={event => {
        if (event.target === event.currentTarget) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg bg-white p-6 backdrop:bg-black/50 dark:bg-gray-900 dark:text-gray-100 dark:backdrop:bg-black/70"
    >
      <form onSubmit={submit} noValidate>
        <h2 id={titleId} className="text-xl font-bold mb-1">{title}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          For context in the history, like a new router or a change of plan. Notes don’t affect the stats.
        </p>

        <label htmlFor={timeId} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          When
        </label>
        <input
          id={timeId}
          type="datetime-local"
          required
          value={time}
          onChange={event => {
            setTime(event.target.value);
            setError(null);
          }}
          className={fieldClass}
        />

        <label htmlFor={textId} className="mt-4 block text-sm font-medium text-gray-700 dark:text-gray-300">
          Note
        </label>
        <textarea
          id={textId}
          required
          autoFocus
          rows={3}
          maxLength={MAX_NOTE_LENGTH}
          value={text}
          placeholder="Switched to the new router"
          onChange={event => {
            setText(event.target.value);
            setError(null);
          }}
          onKeyDown={onTextKeyDown}
          aria-describedby={error ? `${textId}-error` : undefined}
          className={`${fieldClass} resize-y`}
        />
        <div className="mt-1 flex justify-between gap-4 text-xs">
          <span id={`${textId}-error`} role="alert" className="text-red-600 dark:text-red-400">
            {error}
          </span>
          <span className="text-gray-400 dark:text-gray-500 tabular-nums">
            {text.length}/{MAX_NOTE_LENGTH}
          </span>
        </div>

        <div className="mt-6 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Save Note
          </button>
        </div>
      </form>
    </dialog>
  );
}
