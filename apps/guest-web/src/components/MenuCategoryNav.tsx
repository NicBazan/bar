"use client";

import { useEffect, useState } from "react";

export interface CategoryItem {
  id: string;
  name: string;
}

interface MenuCategoryNavProps {
  categories: CategoryItem[];
}

export function MenuCategoryNav({ categories }: MenuCategoryNavProps) {
  const [activeId, setActiveId] = useState<string>(categories[0]?.id ?? "");

  const handleScrollTo = (id: string) => {
    setActiveId(id);
    const element = document.getElementById(`cat-${id}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  useEffect(() => {
    const handleScroll = () => {
      for (const cat of categories) {
        const el = document.getElementById(`cat-${cat.id}`);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 140 && rect.bottom >= 140) {
            setActiveId(cat.id);
            break;
          }
        }
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [categories]);

  return (
    <nav className="sticky top-0 z-30 -mx-4 border-b border-line/60 bg-ink/80 px-4 py-3 backdrop-blur-xl">
      <div className="flex gap-2 overflow-x-auto no-scrollbar py-0.5">
        {categories.map((cat) => {
          const isActive = activeId === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => handleScrollTo(cat.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold tracking-wide transition-all duration-200 active:scale-95 ${
                isActive
                  ? "bg-amber text-amber-ink shadow-md shadow-amber/20"
                  : "border border-line/60 bg-surface/60 text-cream/70 hover:border-line hover:text-cream"
              }`}
            >
              {cat.name}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
