import type { Metadata, Viewport } from "next";
import { AccountApp } from "@/features/account/AccountApp";
import { api, type Menu } from "@/lib/api";

interface AccountPageProps {
  params: Promise<{ venueId: string }>;
  searchParams: Promise<{ tag?: string; tab?: string }>;
}

export const metadata: Metadata = { title: "Mi cuenta" };
export const viewport: Viewport = { themeColor: "#faf8f5" };

export default async function AccountPage({ params, searchParams }: AccountPageProps) {
  const { venueId } = await params;
  const { tag, tab } = await searchParams;
  let venue: Menu["venue"] | null = null;
  try {
    venue = (await api<Menu>(`/venues/${venueId}/menu`)).venue;
  } catch {
    /* sin carta: la cuenta igual funciona, sin nombre del local */
  }
  return (
    <AccountApp
      venueId={venueId}
      venueName={venue?.name ?? "el bar"}
      logoUrl={venue?.logoUrl ?? null}
      currency={venue?.currency ?? "ARS"}
      tag={tag && /^[0-9A-Za-z]{6,32}$/.test(tag) ? tag : undefined}
      initialTab={tab}
    />
  );
}
