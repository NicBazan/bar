"use client";

import type { Cell, Grid } from "@/hooks/useSudoku";

type Props = {
  board: Grid;
  initialBoard: Grid;
  selectedCell: Cell | null;
  conflicts: Set<string>;
  won: boolean;
  onSelect: (r: number, c: number) => void;
};

/** Grilla 9×9: bordes gruesos cada 3 celdas, pistas en crema, números del jugador en ámbar */
export function SudokuBoard({ board, initialBoard, selectedCell, conflicts, won, onSelect }: Props) {
  const sel = selectedCell;
  const selValue = sel ? board[sel.r]![sel.c]! : 0;
  const sameBox = (r: number, c: number) =>
    sel !== null && Math.floor(r / 3) === Math.floor(sel.r / 3) && Math.floor(c / 3) === Math.floor(sel.c / 3);

  return (
    <div
      role="grid"
      aria-label="Tablero de Sudoku"
      className={`grid aspect-square w-full grid-cols-9 overflow-hidden rounded-2xl border-2 border-cream/70 bg-surface shadow-2xl shadow-black/50 ${
        won ? "animate-sudoku-win" : ""
      }`}
    >
      {board.map((row, r) =>
        row.map((value, c) => {
          const fixed = initialBoard[r]![c] !== 0;
          const isSel = sel?.r === r && sel?.c === c;
          const related = sel !== null && !isSel && (sel.r === r || sel.c === c || sameBox(r, c));
          const sameNumber = selValue !== 0 && value === selValue && !isSel;
          const conflict = !fixed && conflicts.has(`${r}-${c}`);

          // Bordes: gruesos al final de cada bloque de 3, finos en el resto
          const borders = [
            c < 8 ? (c % 3 === 2 ? "border-r-2 border-r-cream/60" : "border-r border-r-line") : "",
            r < 8 ? (r % 3 === 2 ? "border-b-2 border-b-cream/60" : "border-b border-b-line") : "",
          ].join(" ");

          const bg = isSel ? "bg-amber/20" : sameNumber ? "bg-amber/10" : related ? "bg-cream/[0.04]" : "";
          const color = conflict ? "text-warn" : fixed ? "text-cream" : "text-amber";

          return (
            <button
              key={`${r}-${c}`}
              type="button"
              role="gridcell"
              aria-label={`Fila ${r + 1}, columna ${c + 1}${value ? `: ${value}` : ", vacía"}${fixed ? " (pista)" : ""}`}
              aria-selected={isSel}
              onClick={() => onSelect(r, c)}
              className={`flex aspect-square items-center justify-center font-display text-[clamp(1.05rem,5.2vw,1.6rem)] leading-none transition-colors duration-150 select-none ${borders} ${bg} ${color} ${
                fixed ? "font-semibold" : "font-medium"
              } ${conflict ? "animate-sudoku-shake" : ""}`}
              style={won ? { animationDelay: `${(r + c) * 35}ms` } : undefined}
            >
              {value || ""}
            </button>
          );
        }),
      )}
    </div>
  );
}
