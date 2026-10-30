"use client";

// M031 — the shared phone-style PIN surface: six number slots, a pure
// numeric keypad (0–9), a delete button, nothing else. No email field, no
// magic-link affordance — per the owner directive the lock screen never
// becomes a second login form. Pure props/no imports, so every screen
// (setup · confirm · unlock) renders the exact same control.

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"] as const;

export function PinSlots({
  value,
  length,
  error,
}: {
  value: string;
  length: number;
  error?: boolean;
}) {
  return (
    <div className="flex justify-center gap-3 my-2" aria-label={`PIN ${length} หลัก`}>
      {Array.from({ length }).map((_, i) => (
        <span
          key={i}
          className={`w-4 h-4 rounded-full transition-colors duration-150 ${
            error
              ? "bg-red-400"
              : i < value.length
                ? "bg-stone-900"
                : "bg-stone-300"
          }`}
          data-pin-slot={i}
          data-filled={i < value.length ? "1" : "0"}
        />
      ))}
    </div>
  );
}

export function PinKeypad({
  value,
  length,
  disabled,
  error,
  onDigit,
  onBackspace,
}: {
  value: string;
  length: number;
  disabled?: boolean;
  error?: boolean;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
}) {
  return (
    <div className="select-none">
      <PinSlots value={value} length={length} error={error} />
      <div className="grid grid-cols-3 gap-3 mt-4">
        {KEYS.map((k) =>
          k === "" ? (
            <span key="spacer" />
          ) : k === "back" ? (
            <button
              key="back"
              type="button"
              aria-label="ลบ"
              disabled={disabled || value.length === 0}
              onClick={onBackspace}
              className="h-14 rounded-2xl bg-stone-100 text-stone-700 text-xl font-semibold active:bg-stone-200 disabled:opacity-30"
            >
              ⌫
            </button>
          ) : (
            <button
              key={k}
              type="button"
              data-key={k}
              disabled={disabled || value.length >= length}
              onClick={() => onDigit(k)}
              className="h-14 rounded-2xl bg-stone-50 border border-stone-200 text-2xl font-semibold text-stone-900 active:bg-stone-200 disabled:opacity-30"
            >
              {k}
            </button>
          )
        )}
      </div>
    </div>
  );
}
