"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/components/ui/Logo";
import { Pulse } from "@/components/ui/Pulse";
import { navItems } from "@/components/dashboard/nav";
import { cn } from "@/lib/utils";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [waStatus, setWaStatus] = useState<'disconnected' | 'initializing' | 'qr_ready' | 'connected'>('disconnected');

  useEffect(() => {
    let isMounted = true;
    const checkWaStatus = async () => {
      try {
        const res = await fetch("/api/whatsapp/status");
        if (res.ok && isMounted) {
          const data = await res.json();
          setWaStatus(data.status || "disconnected");
        }
      } catch {}
    };

    checkWaStatus();
    const interval = setInterval(checkWaStatus, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper">
        <Pulse label="loading your shop" />
      </div>
    );
  }

  // Layout-level auth guard
  if (!user) {
    if (typeof window !== "undefined") window.location.href = "/auth/login";
    return null;
  }

  // Force onboarding if not completed
  if (!user.onboarded && pathname !== "/onboarding") {
    if (typeof window !== "undefined") window.location.href = "/onboarding";
    return null;
  }

  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(href);

  const navList = (
    <nav className="flex flex-col gap-1.5">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setMobileOpen(false)}
          aria-current={isActive(item.href) ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-150",
            isActive(item.href)
              ? "bg-gradient-to-r from-teal-bright to-accent text-white shadow-md shadow-teal-bright/10"
              : "text-ink-soft hover:bg-paper-deep hover:text-ink"
          )}
        >
          {item.icon}
          {item.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-paper font-landing text-ink">
      {/* desktop sidebar */}
      <aside className="hidden w-64 flex-none flex-col bg-card-strong border-r border-line p-4 lg:flex">
        <div className="px-2 py-2">
          <Link href="/">
            <Logo />
          </Link>
        </div>
        <div className="mt-4 rounded-3xl border border-line bg-paper px-4 py-3 shadow-sm">
          <p className="truncate text-sm font-bold text-ink">{user.businessName}</p>
          {waStatus === "connected" ? (
            <Pulse label="CONNECTED" tone="live" className="mt-2 text-ink-soft" />
          ) : waStatus === "qr_ready" ? (
            <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-warning">
              <span className="h-2 w-2 rounded-full bg-warning animate-pulse" />
              Scan QR
            </div>
          ) : waStatus === "initializing" ? (
            <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-warning">
              <span className="h-2 w-2 rounded-full bg-warning animate-pulse" />
              Initializing
            </div>
          ) : (
            <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-ink-faint">
              <span className="h-2 w-2 rounded-full bg-ink-faint" />
              Disconnected
            </div>
          )}
        </div>
        <div className="mt-6">{navList}</div>
        <button
          onClick={signOut}
          className="mt-auto rounded-3xl px-3 py-2.5 text-left text-sm text-ink-faint transition-colors hover:bg-paper-deep hover:text-danger"
        >
          Sign out
        </button>
      </aside>

      {/* mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col relative bg-paper overflow-hidden">
        {/* Decorative background grid & blurs */}
        <div className="bg-grid absolute inset-0 opacity-40 pointer-events-none" aria-hidden />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full bg-accent-soft blur-3xl opacity-30"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 bottom-0 h-64 w-64 rounded-full bg-teal-soft blur-3xl opacity-20"
        />

        <div className="flex items-center gap-3 border-b border-line bg-card-strong/95 px-4 py-3 shadow-sm lg:hidden relative z-20">
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
          <span className="ml-auto">
            <Pulse tone="live" />
          </span>
        </div>

        {mobileOpen ? (
          <div className="border-b border-line bg-card-strong/95 px-4 py-3 lg:hidden relative z-20 font-landing">
            <nav className="flex flex-col gap-1.5">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                    isActive(item.href)
                      ? "bg-teal text-white font-semibold"
                      : "text-ink-soft hover:bg-teal-soft hover:text-teal"
                  )}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}
            </nav>
            <button
              onClick={signOut}
              className="mt-2 w-full rounded-3xl px-3 py-2.5 text-left text-sm text-ink-soft hover:text-danger"
            >
              Sign out
            </button>
          </div>
        ) : null}

        <main className="min-w-0 flex-1 p-5 sm:p-8 relative z-10 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
