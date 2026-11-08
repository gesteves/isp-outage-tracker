'use client';

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Shown under the label, e.g. an error or a hint. */
  description?: string | null;
}

export default function Toggle({ label, checked, onChange, description }: ToggleProps) {
  return (
    <div className="flex flex-col items-start">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="inline-flex items-center gap-2 text-sm text-gray-700"
      >
        <span
          aria-hidden="true"
          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
            checked ? 'bg-blue-500' : 'bg-gray-300'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${
              checked ? 'translate-x-5' : ''
            }`}
          />
        </span>
        {label}
      </button>
      {description && <p className="mt-1 text-xs text-gray-500">{description}</p>}
    </div>
  );
}
