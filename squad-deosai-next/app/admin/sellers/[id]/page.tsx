"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Pulse } from "@/components/ui/Pulse";
import { Label } from "@/components/ui/Field";

interface KnowledgeItem {
  id: string;
  type: "website" | "document" | "qa";
  name: string;
  content: string;
}

interface SellerDetail {
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
  whatsappStatus: string;
  memberSince: string;
  onboarded: boolean;
}

export default function SellerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [seller, setSeller] = useState<SellerDetail | null>(null);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [policies, setPolicies] = useState<{ delivery: string; returns: string; hours: string }>({
    delivery: "Not set",
    returns: "Not set",
    hours: "Standard business hours",
  });
  const [loading, setLoading] = useState(true);

  const fetchSellerDetail = async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/admin/sellers/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSeller(data.seller);
        setKnowledgeItems(data.knowledgeItems || []);
        if (data.policies) setPolicies(data.policies);
      }
    } catch (err) {
      console.error("Failed to fetch seller detail", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSellerDetail();
  }, [id]);

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center bg-paper font-landing">
        <Pulse label="Loading seller profile..." />
      </div>
    );
  }

  if (!seller) {
    return (
      <div className="font-landing space-y-4">
        <PageHeader title="Seller not found" />
        <p className="text-sm text-ink-soft">
          <Link href="/admin" className="text-teal hover:underline font-semibold">
            ← Back to all sellers
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="font-landing space-y-6">
      <PageHeader
        title={seller.businessName}
        description={`${seller.ownerName !== '—' ? `${seller.ownerName} · ` : ""}${seller.email}`}
        action={
          <Link
            href="/admin"
            className="text-sm font-medium text-teal hover:underline"
          >
            ← All sellers
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profile */}
        <Card className="bg-card-strong">
          <CardHeader title="Profile" />
          <CardBody className="space-y-3 pt-4">
            <div>
              <Label>Business name</Label>
              <p className="text-sm font-bold text-ink">{seller.businessName}</p>
            </div>
            <div>
              <Label>Owner</Label>
              <p className="text-sm text-ink">{seller.ownerName || "—"}</p>
            </div>
            <div>
              <Label>Email</Label>
              <p className="text-sm text-ink">{seller.email}</p>
            </div>
            <div>
              <Label>Phone</Label>
              <p className="text-sm text-ink">{seller.phone}</p>
            </div>
            <div>
              <Label>Plan</Label>
              <Badge tone="marigold">{seller.plan}</Badge>
            </div>
            <div>
              <Label>Member since</Label>
              <p className="text-sm text-ink-soft">{seller.memberSince}</p>
            </div>
          </CardBody>
        </Card>

        {/* WhatsApp status */}
        <Card className="lg:col-span-2 bg-card-strong">
          <CardHeader title="WhatsApp connection" />
          <CardBody className="pt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-paper p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-live-soft text-lg">
                  💬
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {seller.whatsappConnected
                      ? "Connected"
                      : seller.whatsappStatus === "qr_ready"
                      ? "Scan QR Code"
                      : seller.whatsappStatus === "initializing"
                      ? "Initializing..."
                      : "Not connected"}
                  </p>
                  <p className="font-mono text-xs text-ink-soft">
                    {seller.whatsappNumber || "No number provided"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {seller.whatsappConnected ? (
                  <Pulse label="CONNECTED" />
                ) : (
                  <Badge tone="neutral">Not connected</Badge>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-line bg-paper-deep p-4">
              <p className="text-xs text-ink-soft">
                Registered WhatsApp Business phone number:{" "}
                <strong className="text-ink font-mono">{seller.whatsappNumber || "Not provided"}</strong>.
                {seller.whatsappConnected
                  ? " WhatsApp auto-reply agent is active and running concurrently."
                  : " Seller can connect via QR scanner in their store setup dashboard."}
              </p>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Knowledge & Data Section */}
      <div className="mt-6">
        <Card className="bg-card-strong">
          <CardHeader
            title="Knowledge & Data"
            description={`${knowledgeItems.length} trained knowledge sources`}
          />
          <CardBody className="pt-4">
            {knowledgeItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line bg-paper px-4 py-12 text-center space-y-2">
                <span className="text-3xl">📂</span>
                <p className="text-sm font-semibold text-ink">No knowledge added yet</p>
                <p className="text-xs text-ink-soft">
                  This seller hasn&apos;t added any website URLs, catalogue spreadsheets, or Q&A items yet.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {knowledgeItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3.5 rounded-xl border border-line bg-paper p-4"
                  >
                    <span className="text-2xl shrink-0">
                      {item.type === "website" ? "🌐" : item.type === "document" ? "📄" : "❓"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-ink">{item.name}</p>
                        <Badge tone="teal" className="capitalize text-[10px]">
                          {item.type}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-ink-soft line-clamp-2 font-mono">
                        {(() => {
                          if (item.content.trim().startsWith('{"headers":') && item.content.trim().endsWith('}')) {
                            try {
                              const parsed = JSON.parse(item.content);
                              if (parsed && Array.isArray(parsed.headers)) {
                                return `Spreadsheet dataset with columns: ${parsed.headers.join(", ")}`;
                              }
                            } catch (e) {}
                          }
                          return item.content;
                        })()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Policies */}
      <div className="mt-6">
        <Card className="bg-card-strong">
          <CardHeader title="Policies & Store Profile" />
          <CardBody className="space-y-3 pt-4">
            {(
              [
                ["Delivery Policy", policies.delivery],
                ["Return Policy", policies.returns],
                ["Operating Hours", policies.hours],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <Label>{label}</Label>
                <p className="text-sm text-ink-soft">{value || "Not set"}</p>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
