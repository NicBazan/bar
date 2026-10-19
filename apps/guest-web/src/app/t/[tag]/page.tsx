import { TableExperience } from "@/features/menu/TableExperience";

// Punto de entrada único del QR/NFC: /t/{tag_code}
export default async function TablePage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  return <TableExperience tag={tag} />;
}
