"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { load, save } from "@/lib/storage";

export type Grid = number[][]; // 0 = celda vacía
export type Difficulty = "facil" | "medio" | "dificil";
export type Cell = { r: number; c: number };

// Pistas que quedan visibles según la dificultad (de 81)
const CLUES: Record<Difficulty, number> = { facil: 40, medio: 32, dificil: 26 };
const STORAGE_KEY = "bar.sudoku.v1";

// ───── Motor del Sudoku (funciones puras) ─────

const box = (r: number, c: number) => Math.floor(r / 3) * 3 + Math.floor(c / 3);

function canPlace(g: Grid, r: number, c: number, n: number): boolean {
  for (let i = 0; i < 9; i++) {
    if (g[r]![i] === n || g[i]![c] === n) return false;
  }
  const br = r - (r % 3);
  const bc = c - (c % 3);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (g[br + i]![bc + j] === n) return false;
  return true;
}

function shuffled(): number[] {
  const a = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Llena la grilla por backtracking con dígitos al azar: genera un tablero completo y válido */
function fill(g: Grid): boolean {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (g[r]![c] !== 0) continue;
      for (const n of shuffled()) {
        if (canPlace(g, r, c, n)) {
          g[r]![c] = n;
          if (fill(g)) return true;
          g[r]![c] = 0;
        }
      }
      return false;
    }
  }
  return true;
}

/** Cuenta soluciones hasta `limit` (alcanza con saber si hay 0, 1 o más de 1) */
function countSolutions(g: Grid, limit = 2): number {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (g[r]![c] !== 0) continue;
      let count = 0;
      for (let n = 1; n <= 9; n++) {
        if (canPlace(g, r, c, n)) {
          g[r]![c] = n;
          count += countSolutions(g, limit - count);
          g[r]![c] = 0;
          if (count >= limit) return count;
        }
      }
      return count;
    }
  }
  return 1;
}

const empty = (): Grid => Array.from({ length: 9 }, () => Array<number>(9).fill(0));
const clone = (g: Grid): Grid => g.map((row) => [...row]);

/**
 * Genera un puzzle con SOLUCIÓN ÚNICA: parte de un tablero completo y va vaciando celdas
 * al azar, deshaciendo cualquier vaciado que abra una segunda solución.
 */
export function generatePuzzle(difficulty: Difficulty): { puzzle: Grid; solution: Grid } {
  const solution = empty();
  fill(solution);
  const puzzle = clone(solution);
  const cells = shuffled()
    .flatMap((a) => shuffled().map((b) => [a - 1, b - 1] as const))
    .sort(() => Math.random() - 0.5);
  let filled = 81;
  for (const [r, c] of cells) {
    if (filled <= CLUES[difficulty]) break;
    const keep = puzzle[r]![c]!;
    puzzle[r]![c] = 0;
    if (countSolutions(clone(puzzle)) !== 1) puzzle[r]![c] = keep;
    else filled--;
  }
  return { puzzle, solution };
}

/** Celdas cuyo valor choca con otro igual en su fila, columna o cuadrante */
export function findConflicts(g: Grid): Set<string> {
  const out = new Set<string>();
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const n = g[r]![c]!;
      if (!n) continue;
      for (let i = 0; i < 9; i++) {
        if ((i !== c && g[r]![i] === n) || (i !== r && g[i]![c] === n)) out.add(`${r}-${c}`);
      }
      const br = r - (r % 3);
      const bc = c - (c % 3);
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          const rr = br + i;
          const cc = bc + j;
          if ((rr !== r || cc !== c) && g[rr]![cc] === n) out.add(`${r}-${c}`);
        }
    }
  }
  return out;
}

// ───── Hook ─────

type SavedGame = { board: Grid; initialBoard: Grid; solution: Grid; errors: number; difficulty: Difficulty; won: boolean; seconds: number };

export function useSudoku() {
  const [board, setBoard] = useState<Grid>(empty);
  const [initialBoard, setInitialBoard] = useState<Grid>(empty);
  const [solution, setSolution] = useState<Grid>(empty);
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
  const [errors, setErrors] = useState(0);
  const [difficulty, setDifficulty] = useState<Difficulty>("facil");
  const [won, setWon] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [ready, setReady] = useState(false);

  const startNewGame = useCallback((d: Difficulty = "facil") => {
    const { puzzle, solution: sol } = generatePuzzle(d);
    setBoard(clone(puzzle));
    setInitialBoard(puzzle);
    setSolution(sol);
    setDifficulty(d);
    setErrors(0);
    setWon(false);
    setSeconds(0);
    setSelectedCell(null);
    setReady(true);
  }, []);

  // Retomar la partida guardada (por si volvió a la carta a pedir algo) o arrancar una nueva
  useEffect(() => {
    const saved = load<SavedGame | null>(STORAGE_KEY, null);
    if (saved?.board?.length === 9 && !saved.won) {
      setBoard(saved.board);
      setInitialBoard(saved.initialBoard);
      setSolution(saved.solution);
      setErrors(saved.errors);
      setDifficulty(saved.difficulty);
      setSeconds(saved.seconds ?? 0);
      setWon(false);
      setReady(true);
    } else {
      startNewGame("facil");
    }
  }, [startNewGame]);

  useEffect(() => {
    if (ready) save(STORAGE_KEY, { board, initialBoard, solution, errors, difficulty, won, seconds } satisfies SavedGame);
  }, [ready, board, initialBoard, solution, errors, difficulty, won, seconds]);

  // Cronómetro: corre mientras la partida esté en juego y la pestaña visible
  useEffect(() => {
    if (!ready || won) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [ready, won]);

  const conflicts = useMemo(() => findConflicts(board), [board]);
  const isFixed = useCallback((r: number, c: number) => initialBoard[r]![c] !== 0, [initialBoard]);

  const checkWin = useCallback(
    (g: Grid = board) => g.every((row) => row.every((n) => n !== 0)) && findConflicts(g).size === 0,
    [board],
  );

  const selectCell = useCallback((r: number, c: number) => setSelectedCell({ r, c }), []);

  const inputNumber = useCallback(
    (num: number) => {
      if (!selectedCell || won || num < 1 || num > 9) return;
      const { r, c } = selectedCell;
      if (initialBoard[r]![c] !== 0) return; // las pistas no se tocan
      const next = clone(board);
      next[r]![c] = num;
      // Cuenta como error si el número choca con su fila/columna/cuadrante
      if (findConflicts(next).has(`${r}-${c}`)) setErrors((e) => e + 1);
      setBoard(next);
      if (checkWin(next)) {
        setWon(true);
        setSelectedCell(null);
        navigator.vibrate?.([30, 60, 30]);
      }
    },
    [selectedCell, won, initialBoard, board, checkWin],
  );

  const eraseCell = useCallback(() => {
    if (!selectedCell || won) return;
    const { r, c } = selectedCell;
    if (initialBoard[r]![c] !== 0) return;
    setBoard((b) => {
      const next = clone(b);
      next[r]![c] = 0;
      return next;
    });
  }, [selectedCell, won, initialBoard]);

  /** Cuántas veces aparece cada número (para atenuar los que ya están completos) */
  const counts = useMemo(() => {
    const out = Array<number>(10).fill(0);
    for (const row of board) for (const n of row) out[n]!++;
    return out;
  }, [board]);

  return {
    ready,
    board,
    initialBoard,
    solution,
    selectedCell,
    errors,
    difficulty,
    won,
    seconds,
    conflicts,
    counts,
    isFixed,
    selectCell,
    inputNumber,
    eraseCell,
    checkWin,
    startNewGame,
    boxOf: box,
  };
}
