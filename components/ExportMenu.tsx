'use client';

import { KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

export interface ExportOption {
  id: string;
  label: string;
  description: string;
  onSelect: () => void;
}

interface ExportMenuProps {
  options: ExportOption[];
  disabled?: boolean;
  className?: string;
}

/**
 * The Export button: a menu of file formats, following the WAI-ARIA menu button
 * pattern (arrow keys move between formats, Esc closes and returns focus).
 */
export default function ExportMenu({ options, disabled = false, className = '' }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  /** Which item to focus once the menu renders, or null to leave focus alone. */
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    if (open && focusIndex !== null) itemRefs.current[focusIndex]?.focus();
  }, [open, focusIndex]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Disabling the button (e.g. clearing the history) closes the menu too. Done while
  // rendering, as React recommends for state that follows a prop.
  const [wasDisabled, setWasDisabled] = useState(disabled);
  if (disabled !== wasDisabled) {
    setWasDisabled(disabled);
    if (disabled) setOpen(false);
  }

  const openAt = (index: number) => {
    setOpen(true);
    setFocusIndex(index);
  };

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setFocusIndex(null);
    if (returnFocus) triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAt(0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openAt(options.length - 1);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      close(true);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = itemRefs.current.findIndex(item => item === document.activeElement);
    const last = options.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: current >= last ? 0 : current + 1,
      ArrowUp: current <= 0 ? last : current - 1,
      Home: 0,
      End: last,
    };
    if (event.key in moves) {
      event.preventDefault();
      setFocusIndex(moves[event.key]);
      itemRefs.current[moves[event.key]]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      // Let focus move on to the next control, with the menu out of the way.
      close(false);
    }
  };

  const select = (option: ExportOption) => {
    close(true);
    option.onSelect();
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openAt(0))}
        onKeyDown={onTriggerKeyDown}
        className="w-full inline-flex items-center justify-center gap-1 whitespace-nowrap px-2 md:px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 dark:disabled:text-gray-400 disabled:cursor-not-allowed transition-colors text-sm md:text-base"
      >
        Export
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Export format"
          onKeyDown={onMenuKeyDown}
          className="absolute left-1/2 -translate-x-1/2 md:left-auto md:right-0 md:translate-x-0 z-20 mt-2 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg bg-white py-1 shadow-lg ring-1 ring-black/10 dark:bg-gray-800 dark:ring-white/10"
        >
          {options.map((option, index) => (
            <button
              key={option.id}
              ref={el => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => select(option)}
              className="block w-full px-4 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none dark:hover:bg-gray-700 dark:focus:bg-gray-700"
            >
              <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{option.label}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">{option.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
