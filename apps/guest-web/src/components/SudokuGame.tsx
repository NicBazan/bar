"use client";

import Link from "next/link";
import { useEffect } from "react";
import { type Difficulty, useSudoku } from "@/hooks/useSudoku";
import { SudokuBoard } from "./SudokuBoard";
import { SudokuNumpad } from "./SudokuNumpad";

const LEVEL_LABEL: Record<Difficulty, string> = { facil: "Fácil", medio: "Medio", dificil: "Difícil" };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function SudokuGame({ backHref }: { backHref: string }) {
  const game = useSudoku();
  const { selectedCell, selectCell, inputNumber, eraseCell } = game;

  // Teclado físico (para quien juegue en tablet o compu): números, flechas y borrar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[1-9]$/.test(e.key)) return inputNumber(Number(e.key));
      if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") return eraseCell();
      const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      const m = moves[e.key];
      if (m) {
        e.preventDefault();
        const r = Math.min(8, Math.max(0, (selectedCell?.r ?? 4) + m[0]));
        const c = Math.min(8, Math.max(0, (selectedCell?.c ?? 4) + m[1]));
        selectCell(r, c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedCell, selectCell, inputNumber, eraseCell]);

  return (
    <main className="relative mx-auto flex h-dvh max-w-md flex-col overflow-hidden bg-paper px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      {/* Brillos radiales, como en la carta */}
      <div className="pointer-events-none absolute -top-24 left-1/2 -z-0 h-72 w-72 -translate-x-1/2 rounded-full bg-amber/10 blur-[100px]" />
      <div className="pointer-events-none absolute -bottom-32 -left-16 h-64 w-64 rounded-full bg-amber/5 blur-[90px]" />

      <header className="relative z-10 flex items-center justify-between gap-3">
        <Link
          href={backHref}
          className="flex h-11 items-center gap-2 rounded-2xl border border-line bg-surface/80 px-4 text-sm font-medium text-cream backdrop-blur active:scale-95"
        >
          ← Volver a la carta
        </Link>
        <div className="text-right">
          <p className="font-display text-lg leading-tight text-cream">Sudoku</p>
          <p className="text-[11px] text-muted">
            {LEVEL_LABEL[game.difficulty]} · ⏱ {clock(game.seconds)} · ❌ {game.errors}
          </p>
        </div>
      </header>

      <section className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 py-3">
        {/* El tablero se achica si la pantalla es baja: nunca hay scroll */}
        <div className="w-full" style={{ maxWidth: "min(100%, calc(100dvh - 330px))" }}>
          {game.ready ? (
            <SudokuBoard
              board={game.board}
              initialBoard={game.initialBoard}
              selectedCell={game.selectedCell}
              conflicts={game.conflicts}
              won={game.won}
              onSelect={game.selectCell}
            />
          ) : (
            <div className="aspect-square w-full animate-pulse rounded-2xl bg-surface" />
          )}
        </div>

        {game.won ? (
          <div className="animate-sudoku-pop w-full rounded-3xl border border-ok/40 bg-ok/10 p-5 text-center">
            <p className="text-4xl">🎉</p>
            <p className="mt-1 font-display text-2xl text-cream">¡Lo resolviste!</p>
            <p className="mt-1 text-sm text-muted">
              {LEVEL_LABEL[game.difficulty]} en {clock(game.seconds)} con {game.errors} {game.errors === 1 ? "error" : "errores"}.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => game.startNewGame(game.difficulty)}
                className="h-12 rounded-2xl bg-amber text-sm font-semibold text-amber-ink active:scale-95"
              >
                Otro igual
              </button>
              <Link href={backHref} className="flex h-12 items-center justify-center rounded-2xl border border-line text-sm font-semibold text-cream active:scale-95">
                Volver a la carta
              </Link>
            </div>
          </div>
        ) : (
          <SudokuNumpad
            counts={game.counts}
            disabled={!game.selectedCell}
            difficulty={game.difficulty}
            onNumber={game.inputNumber}
            onErase={game.eraseCell}
            onNewGame={game.startNewGame}
          />
        )}
        {!game.won && !game.selectedCell && game.ready && (
          <p className="text-center text-xs text-muted">Tocá una casilla vacía y elegí un número.</p>
        )}
      </section>
    </main>
  );
}
