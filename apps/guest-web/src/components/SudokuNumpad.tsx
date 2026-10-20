"use client";

import { useState } from "react";
import type { Difficulty } from "@/hooks/useSudoku";

type Props = {
  counts: number[]; // cuántas veces está cada número en el tablero (índice 1..9)
  disabled: boolean;
  difficulty: Difficulty;
  onNumber: (n: number) => void;
  onErase: () => void;
  onNewGame: (d: Difficulty) => void;
};

const LEVELS: Array<{ id: Difficulty; label: string }> = [
  { id: "facil", label: "Fácil" },
  { id: "medio", label: "Medio" },
  { id: "dificil", label: "Difícil" },
];

/** Teclado táctil: botones de 56 px de alto (más que los 44 px recomendados) para los pulgares */
export function SudokuNumpad({ counts, disabled, difficulty, onNumber, onErase, onNewGame }: Props) {
  const [picking, setPicking] = useState(false);

  return (
    <div className="w-full">
      <div className="grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
          const done = (counts[n] ?? 0) >= 9;
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              onClick={() => onNumber(n)}
              aria-label={`Número ${n}`}
              className={`flex h-14 min-w-11 flex-col items-center justify-center rounded-2xl border font-display text-2xl transition-all duration-150 active:scale-90 disabled:opacity-40 ${
                done ? "border-line/40 bg-surface/40 text-muted/50" : "border-line bg-surface-2 text-cream active:bg-amber/20"
              }`}
            >
              {n}
              <span className="text-[9px] font-sans text-muted">{done ? "✓" : 9 - (counts[n] ?? 0)}</span>
            </button>
          );
        })}
        <button
          type="button"
          disabled={disabled}
          onClick={onErase}
          aria-label="Borrar"
          className="flex h-14 min-w-11 items-center justify-center rounded-2xl border border-line bg-surface-2 text-2xl text-cream transition-all duration-150 active:scale-90 disabled:opacity-40"
        >
          ⌫
        </button>
      </div>

      {picking ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => {
                setPicking(false);
                onNewGame(l.id);
              }}
              className={`h-12 rounded-2xl text-sm font-semibold transition active:scale-95 ${
                l.id === difficulty ? "bg-amber text-amber-ink" : "border border-line bg-surface-2 text-cream"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="mt-3 h-12 w-full rounded-2xl border border-amber/40 bg-amber/10 text-sm font-semibold text-amber transition active:scale-95"
        >
          🔄 Nuevo juego
        </button>
      )}
    </div>
  );
}
