"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Consola" },
  { href: "/reporte", label: "Reporte" },
  { href: "/configuracion", label: "Configuración" },
];

export function AppNav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-50 border-b border-ink bg-[rgba(236,230,220,0.94)] backdrop-blur-md print:hidden">
      <div className="mx-auto flex h-12 max-w-[1500px] items-center gap-4 px-4">
        <Link href="/" className="tracked-sm shrink-0 text-[11px] text-ink">
          E·I <span className="text-muted">/</span> <span className="hidden sm:inline">Consola</span>
        </Link>
        <nav className="ml-auto flex text-[11px] uppercase tracking-[0.14em]">
          {LINKS.map((l) => {
            const on = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} aria-current={on ? "page" : undefined} className={`px-2.5 py-1.5 sm:px-3 ${on ? "bg-ink text-surface" : "text-ink-2 hover:text-ink"}`}>
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
