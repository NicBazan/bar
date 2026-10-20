import type { Metadata } from "next";
import Link from "next/link";
import { DishCard } from "@/components/DishCard";
import { FloatingCart } from "@/components/FloatingCart";
import { MenuCategoryNav } from "@/components/MenuCategoryNav";
import { ApiError, api, type Menu } from "@/lib/api";

interface MenuPageProps {
  params: Promise<{ venueId: string }>;
  searchParams: Promise<{ tag?: string }>;
}

export async function generateMetadata({ params }: MenuPageProps): Promise<Metadata> {
  const { venueId } = await params;
  try {
    const menu = await api<Menu>(`/venues/${venueId}/menu`);
    return {
      title: `${menu.venue.name} · Carta 3D`,
      description: `Explorá la carta digital y visualizá los platos en Realidad Aumentada en ${menu.venue.name}`,
    };
  } catch {
    return { title: "Carta Digital" };
  }
}

export default async function VenueMenuPage({ params, searchParams }: MenuPageProps) {
  const { venueId } = await params;
  const { tag } = await searchParams;

  let menu: Menu | null = null;
  let fetchError: string | null = null;

  try {
    menu = await api<Menu>(`/venues/${venueId}/menu`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      fetchError = "El local o la carta solicitada no existen.";
    } else {
      fetchError = "No pudimos conectar con la carta. Por favor revisá tu conexión.";
    }
  }

  if (fetchError || !menu) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center p-6 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-surface text-3xl">
          🍽️
        </div>
        <h1 className="font-display text-2xl text-cream">Carta no disponible</h1>
        <p className="mt-2 text-sm text-muted">{fetchError}</p>
        {tag && (
          <Link
            href={`/t/${tag}`}
            className="mt-6 inline-flex rounded-xl bg-amber px-5 py-2.5 text-xs font-semibold text-amber-ink"
          >
            Volver a escanear mesa
          </Link>
        )}
      </main>
    );
  }

  // Inyección de modelos 3D de prueba en el primer plato si la API aún no trae URLs reales
  const categoriesWith3D = menu.categories.map((cat, catIdx) => ({
    ...cat,
    dishes: cat.dishes.map((dish, dishIdx) => {
      const hasReal3D = Boolean(dish.assets?.GLB_LOD0 || dish.assets?.GLB_LOD1);
      if (!hasReal3D && catIdx === 0 && dishIdx === 0) {
        return {
          ...dish,
          assets: {
            ...dish.assets,
            GLB_LOD0: "https://modelviewer.dev/shared-assets/models/Astronaut.glb",
            USDZ: "https://modelviewer.dev/shared-assets/models/Astronaut.usdz",
            POSTER: "https://modelviewer.dev/shared-assets/models/Astronaut.webp",
          },
        };
      }
      return dish;
    }),
  }));

  const navCategories = categoriesWith3D.map((c) => ({
    id: c.id,
    name: c.name,
  }));

  return (
    <main className="relative mx-auto min-h-dvh max-w-md px-4 pb-28">
      {/* Glow ambiental superior */}
      <div className="pointer-events-none absolute top-0 left-1/2 -z-10 h-64 w-64 -translate-x-1/2 rounded-full bg-amber/10 blur-[90px]"></div>

      {/* Header del Local y Mesa */}
      <header className="pt-8 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-ok animate-pulse"></span>
            <span className="text-xs font-medium tracking-wide text-muted">Mesa Conectada</span>
          </div>

          {tag && (
            <span className="rounded-full border border-line bg-surface-2 px-3 py-1 font-mono text-xs font-medium text-amber">
              Tag #{tag}
            </span>
          )}
        </div>

        <h1 className="mt-3 font-display text-3xl font-medium tracking-tight text-cream">
          {menu.venue.name}
        </h1>
        <p className="mt-1 text-xs text-muted">
          Tocá un plato con el sello 3D para proyectarlo a escala real sobre tu mesa.
        </p>
      </header>

      {/* Navegación horizontal de categorías sticky */}
      <MenuCategoryNav categories={navCategories} />

      {/* Lista de Platos agrupados por Categoría */}
      <div className="mt-4 space-y-8">
        {categoriesWith3D.map((cat) => (
          <section key={cat.id} id={`cat-${cat.id}`} className="scroll-mt-20">
            <div className="mb-3.5 flex items-center justify-between">
              <h2 className="font-display text-2xl font-normal tracking-tight text-cream">
                {cat.name}
              </h2>
              <span className="text-xs text-muted/70">{cat.dishes.length} platos</span>
            </div>

            <div className="grid gap-4">
              {cat.dishes.map((dish) => (
                <DishCard
                  key={dish.id}
                  id={dish.id}
                  name={dish.name}
                  description={dish.description}
                  priceCents={dish.priceCents}
                  currency={menu.venue.currency}
                  available={dish.available}
                  tags={dish.tags}
                  allergens={dish.allergens}
                  glbUrl={dish.assets?.GLB_LOD0 || dish.assets?.GLB_LOD1}
                  usdzUrl={dish.assets?.USDZ}
                  posterUrl={dish.assets?.POSTER || dish.assets?.PHOTO}
                  variants={dish.variants}
                  modifierGroups={dish.modifierGroups}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Panel flotante interactivo del Carrito (Zustand) */}
      <FloatingCart currency={menu.venue.currency} tag={tag} />
    </main>
  );
}
