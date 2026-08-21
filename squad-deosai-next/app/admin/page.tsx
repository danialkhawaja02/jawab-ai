"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Pulse } from "@/components/ui/Pulse";
import { Input, Label } from "@/components/ui/Field";

export interface AdminSeller {
  id: string;
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  plan: string;
  role: string;
  industry: string;
  whatsappNumber: string;
  whatsappConnected: boolean;
  whatsappStatus: 'disconnected' | 'initializing' | 'qr_ready' | 'connected';
  memberSince: string;
  onboarded: boolean;
}

export default function AdminSellersPage() {
  const [sellers, setSellers] = useState<AdminSeller[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchSellers = async () => {
    try {
      const res = await fetch('/api/admin/sellers');
      if (res.ok) {
        const data = await res.json();
        setSellers(data.sellers || []);
      }
    } catch (err) {
      console.error("Failed to fetch sellers for admin", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSellers();
    const interval = setInterval(fetchSellers, 5000);
    return () => clearInterval(interval);
  }, []);

  const filtered = sellers.filter(
    (s) =>
      s.businessName.toLowerCase().includes(search.toLowerCase()) ||
      s.email.toLowerCase().includes(search.toLowerCase()) ||
      s.phone.toLowerCase().includes(search.toLowerCase())
  );

  const connectedCount = sellers.filter((s) => s.whatsappConnected).length;
  const notConnectedCount = sellers.length - connectedCount;

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center bg-paper font-landing">
        <Pulse label="Fetching live sellers data..." />
      </div>
    );
  }

  return (
    <div className="font-landing">
      <PageHeader
        title="All sellers"
        description={`${sellers.length} registered · ${connectedCount} connected · ${notConnectedCount} not connected`}
      />

      {/* search */}
      <div className="mb-6 max-w-sm">
        <Label htmlFor="admin-search" className="sr-only">
          Search sellers
        </Label>
        <Input
          id="admin-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email…"
        />
      </div>

      {/* seller list */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <Card>
            <CardBody className="py-14 text-center">
              <p className="text-sm text-ink-soft">
                {sellers.length === 0
                  ? "No sellers found in the database."
                  : "No sellers match your search."}
              </p>
            </CardBody>
          </Card>
        ) : (
          filtered.map((seller) => (
            <Card key={seller.id} className="bg-card-strong">
              <CardBody className="flex flex-wrap items-center gap-4">
                {/* avatar */}
                <div className="grid h-11 w-11 flex-none place-items-center rounded-full bg-paper-deep font-display text-sm text-ink font-bold border border-line">
                  {(seller.businessName || "S").charAt(0).toUpperCase()}
                </div>

                {/* info */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-ink">
                      {seller.businessName}
                    </p>
                    {seller.whatsappConnected ? (
                      <Pulse label="CONNECTED" />
                    ) : seller.whatsappStatus === 'qr_ready' ? (
                      <Badge tone="marigold">QR Ready</Badge>
                    ) : seller.whatsappStatus === 'initializing' ? (
                      <Badge tone="marigold">Initializing...</Badge>
                    ) : (
                      <Badge tone="neutral">Not connected</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {seller.ownerName !== '—' ? `${seller.ownerName} · ` : ""}{seller.email} {seller.phone !== 'No phone' ? `· ${seller.phone}` : ""}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-ink-faint">
                    Member since {seller.memberSince}
                    {seller.whatsappNumber
                      ? ` · WA: ${seller.whatsappNumber}`
                      : ""}
                  </p>
                </div>

                {/* actions */}
                <div className="flex items-center gap-2 flex-none">
                  <Link
                    href={`/admin/sellers/${seller.id}`}
                    className="rounded-lg border border-line bg-card px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-paper shadow-sm"
                  >
                    View →
                  </Link>
                </div>
              </CardBody>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
