/** Quick-reply menu buttons shown beneath a menu message. Presentational. */

import { OPTIONS } from "@/components/chat/constants";
import type { ChatOption } from "@/components/chat/types";

interface OptionButtonsProps {
  disabled: boolean;
  onSelect: (option: ChatOption) => void;
}

export default function OptionButtons({ disabled, onSelect }: OptionButtonsProps) {
  return (
    <div
      className="mt-3 flex flex-col items-start gap-2"
      role="group"
      aria-label="Quick options"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onSelect(option)}
          disabled={disabled || !option.enabled}
          aria-disabled={!option.enabled || disabled}
          className={
            option.enabled
              ? "rounded-full border border-indigo-600 bg-white px-3.5 py-1.5 text-sm font-medium text-indigo-600 transition hover:bg-indigo-600 hover:text-white disabled:opacity-50"
              : "rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-sm text-slate-500 disabled:opacity-50"
          }
        >
          {option.label}
          {!option.enabled && (
            <span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-400">
              soon
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
