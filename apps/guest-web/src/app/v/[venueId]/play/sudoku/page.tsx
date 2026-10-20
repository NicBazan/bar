import type { Metadata } from "next";
import { SudokuGame } from "@/components/SudokuGame";

export const metadata: Metadata = { title: "Sudoku · Mientras esperás" };

type Props = {
  params: Promise<{ venueId: string }>;
  searchParams: Promise<{ tag?: string }>;
};

// El juego corre 100% en el navegador: no necesita sesión ni llamadas a la API
export default async function SudokuPage({ params, searchParams }: Props) {
  const { venueId } = await params;
  const { tag } = await searchParams;
  const safeTag = tag && /^[0-9A-Za-z]{6,32}$/.test(tag) ? tag : undefined;
  const backHref = `/v/${encodeURIComponent(venueId)}/menu${safeTag ? `?tag=${safeTag}` : ""}`;
  return <SudokuGame backHref={backHref} />;
}
