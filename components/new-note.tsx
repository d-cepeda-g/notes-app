"use client";

import { Icons } from "./icons";

export default function NewNote({ onCreate, disabled = false }: {
  onCreate: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center">
      <button
        type="button" onClick={onCreate} disabled={disabled} aria-label="Create new note"
        className="w-8 h-8 flex items-center justify-center rounded-full bg-[#3a3a3c] hover:bg-[#4a4a4c] transition-colors shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] disabled:opacity-50 disabled:cursor-wait"
      >
        <Icons.new className="text-gray-300" />
      </button>
    </div>
  );
}
