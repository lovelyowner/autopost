"use client";

import React from "react";

export const AZ_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export function matchesSearchAndLetter(
  label: string,
  id: string,
  query: string,
  letter: string,
  extra?: string,
): boolean {
  const cleanLabel = label.trim();
  if (letter && letter !== "all") {
    const first = cleanLabel.charAt(0).toUpperCase();
    if (first !== letter && id.trim().charAt(0).toUpperCase() !== letter) {
      return false;
    }
  }
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    cleanLabel.toLowerCase().includes(q) ||
    id.toLowerCase().includes(q) ||
    (extra ? extra.toLowerCase().includes(q) : false)
  );
}

export function LetterFilterBar({
  searchQuery,
  onSearchChange,
  selectedLetter,
  onLetterChange,
  searchPlaceholder = "Search platforms...",
  availableLetters,
}: {
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  selectedLetter: string;
  onLetterChange: (letter: string) => void;
  searchPlaceholder?: string;
  availableLetters?: Set<string>;
}) {
  return (
    <div className="space-y-2 bg-white">
      {typeof searchQuery === "string" && onSearchChange && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="w-full bg-white border-0 border-b border-[#cccccc] px-1 py-1.5 text-xs text-[#333333] placeholder-[#999999]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="rounded border border-[#cccccc] bg-white px-2.5 py-1 text-[11px] text-[#666666] hover:font-bold hover:text-[#333333] cursor-pointer whitespace-nowrap"
            >
              Clear
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => onLetterChange("all")}
          className={`rounded border border-[#cccccc] bg-white px-2 py-0.5 font-mono text-[11px] cursor-pointer ${
            selectedLetter === "all"
              ? "font-bold text-[#333333]"
              : "text-[#666666] hover:font-bold hover:text-[#333333]"
          }`}
        >
          All
        </button>
        {AZ_LETTERS.map((ch) => {
          const hasItems = !availableLetters || availableLetters.has(ch);
          const active = selectedLetter === ch;
          return (
            <button
              key={ch}
              type="button"
              onClick={() => onLetterChange(active ? "all" : ch)}
              className={`rounded border border-[#cccccc] bg-white px-1.5 py-0.5 font-mono text-[11px] cursor-pointer ${
                active
                  ? "font-bold text-[#333333]"
                  : hasItems
                    ? "text-[#666666] hover:font-bold hover:text-[#333333]"
                    : "text-[#999999] hover:font-bold hover:text-[#666666]"
              }`}
            >
              {ch}
            </button>
          );
        })}
      </div>
    </div>
  );
}
