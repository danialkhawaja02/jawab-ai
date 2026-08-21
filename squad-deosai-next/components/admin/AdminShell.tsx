"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { Badge } from "@/components/ui/Badge";
import { adminNavItems } from "@/components/admin/nav";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Pulse } from "@/components/ui/Pulse";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper">
        <Pulse label="loading admin panel" />
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-paper p-5 text-center">
        <h1 className="font-display text-3xl text-ink">Access Denied</h1>
        <p className="mt-2 max-w-sm text-sm text-ink-soft">
          You need admin privileges to access this area.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 rounded-full bg-teal px-5 py-2 text-sm font-semibold text-paper hover:bg-teal-bright"
        >
          Go to Dashboard
        </Link>
      </div>
    );
  }

  const isActive = (href: string) =>
    href === "/admin"
      ? pathname === "/admin"
      : pathname.startsWith(href);

  const navList = (
    <nav className="flex flex-col gap-1">
      {adminNavItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setMobileOpen(false)}
          aria-current={isActive(item.href) ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
            isActive(item.href)
              ? "bg-teal text-paper"
              : "text-ink-soft hover:bg-teal-soft hover:text-teal"
          )}
        >
          {item.icon}
          {item.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-paper">
      {/* desktop sidebar */}
      <aside className="hidden w-64 flex-none flex-col border-r border-line bg-card p-4 lg:flex">
        <div className="px-2 py-2">
          <Link href="/">
            <Logo />
          </Link>
        </div>
        <div className="mt-4 rounded-xl border border-line bg-paper px-3 py-2.5">
          <p className="truncate text-sm font-semibold text-ink">
            Admin Panel
          </p>
          <Badge tone="teal" className="mt-1">
            Jawab AI Team
          </Badge>
        </div>
        <div className="mt-6">{navList}</div>
        <Link
          href="/dashboard"
          className="mt-auto rounded-xl px-3 py-2.5 text-left text-sm text-ink-soft transition-colors hover:bg-teal-soft hover:text-teal"
        >
          ← Seller dashboard
        </Link>
      </aside>

      {/* mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line bg-card px-4 py-3 lg:hidden">
          <button
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
            className="grid h-9 w-9 place-items-center rounded-lg border border-line text-ink"
          >
            <span className="sr-only">Menu</span>
            {mobileOpen ? "✕" : "☰"}
          </button>
          <Link href="/">
            <Logo />
          </Link>
          <Badge tone="teal" className="ml-auto">
            Admin
          </Badge>
        </div>

        {mobileOpen ? (
          <div className="border-b border-line bg-card px-4 py-3 lg:hidden">
            {navList}
          </div>
        ) : null}

        <main className="min-w-0 flex-1 p-5 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
