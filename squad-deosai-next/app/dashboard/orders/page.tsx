"use client";

import { useEffect, useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { cn, formatPKR } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { fetchOrders, updateOrderStatus, seedDatabase } from "@/lib/supabase-service";
import { useSupabaseRealtime } from "@/lib/supabase/realtime";

type OrderStatus = "pending" | "confirmed" | "cancelled";

interface Order {
  id: string;
  customerName: string;
  customerPhone: string;
  items: string;
  total: number;
  status: OrderStatus;
  createdAt: string;
  source: string;
}

export default function OrdersPage() {
  const { user } = useAuth();

  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<OrderStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [loadingLive, setLoadingLive] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const loadOrders = async () => {
    if (!user) return;

    try {
      setLoadingLive(true);
      const dbOrders = await fetchOrders(user.id);
      const mappedOrders: Order[] = dbOrders.map((o) => {
        // Map database status string 'pending_confirmation' -> 'pending'
        const status = o.status === "pending_confirmation" ? "pending" : (o.status as OrderStatus);
        return {
          id: o.id,
          customerName: o.customer_name || "Unknown",
          customerPhone: o.customer_phone || "",
          items: o.external_order_id ? `Order ${o.external_order_id}` : "Jewelry Purchase",
          total: Number(o.total),
          status,
          createdAt: o.created_at,
          source: o.external_order_id ? "Shopify" : "Manual",
        };
      });
      setOrders(mappedOrders);
    } catch (err) {
      console.error("Failed to load live orders:", err);
    } finally {
      setLoadingLive(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, [user]);

  useSupabaseRealtime("orders", user ? `seller_id=eq.${user.id}` : null, (payload) => {
    if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
      loadOrders();
    }
  });

  // Seeding button trigger
  const handleSeedDatabase = async () => {
    if (!user) return;
    try {
      setSeeding(true);
      await seedDatabase(user.id);
      await loadOrders();
    } catch (err) {
      alert("Seeding failed. Make sure your database server is running.");
      console.error(err);
    } finally {
      setSeeding(false);
    }
  };

  const filtered = orders.filter((o) => {
    const matchesFilter = filter === "all" ? true : o.status === filter;
    const matchesSearch =
      o.id.toLowerCase().includes(search.toLowerCase()) ||
      o.customerName.toLowerCase().includes(search.toLowerCase()) ||
      o.customerPhone.includes(search) ||
      o.items.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const handleUpdateStatus = async (id: string, newStatus: OrderStatus) => {
    if (!user) return;

    try {
      // Update inside Supabase
      await updateOrderStatus(user.id, id, newStatus);
      // Refresh list
      await loadOrders();
    } catch (err) {
      console.error("Failed to update live order status:", err);
    }
  };

  const getStatusCount = (status: OrderStatus | "all") => {
    if (status === "all") return orders.length;
    return orders.filter((o) => o.status === status).length;
  };

  const statusMeta = {
    pending: { label: "Pending", tone: "attention" as const },
    confirmed: { label: "Confirmed", tone: "live" as const },
    cancelled: { label: "Cancelled", tone: "neutral" as const },
  };

  return (
    <div className="font-landing space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink font-heading">Orders</h1>
          <p className="text-sm text-ink-soft mt-1">
            COD order confirmations from your store. Keep track of customer replies and manage shipments.
          </p>
        </div>
      </div>

      {/* Explainer */}
      <Card className="bg-card-strong">
        <CardBody className="flex flex-wrap items-center gap-4">
          <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-teal-soft/40 text-lg">
            📦
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">How it works</p>
            <p className="text-sm text-ink-soft">
              When a customer checks out, Jawab AI messages them to verify COD. If they reply{" "}
              <strong>Confirm</strong>, it locks in the order. If they reply <strong>Cancel</strong>,
              you flag the order to avoid transit loss.
            </p>
          </div>
        </CardBody>
      </Card>

      {/* Seeding callout for Live Mode empty orders database */}
      {!loadingLive && orders.length === 0 && (
        <Card className="border-teal-soft bg-teal-soft/5">
          <CardBody className="p-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-bold text-ink flex items-center gap-2">
                <span>🛒</span> Live Orders Database Active (No Orders Found)
              </p>
              <p className="text-xs text-ink-soft">
                Connect your Shopify storefront to push live webhooks, or seed mock COD orders into your database to test sorting and cancel actions right now.
              </p>
            </div>
            <Button
              onClick={handleSeedDatabase}
              disabled={seeding}
              className="bg-teal hover:bg-teal-bright text-paper shrink-0"
            >
              {seeding ? "Seeding Database..." : "Seed Database with Test Data"}
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Status filter tabs */}
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["all", "All"],
              ["pending", "Pending"],
              ["confirmed", "Confirmed"],
              ["cancelled", "Cancelled"],
            ] as const
          ).map(([key, label]) => {
            const count = getStatusCount(key);
            const isActive = filter === key;

            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                  isActive
                    ? "bg-gradient-to-r from-teal-bright to-accent text-white shadow-sm"
                    : "bg-card-strong border border-line text-ink-soft hover:border-teal hover:text-teal"
                )}
              >
                {label}
                {count > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums",
                      isActive ? "bg-white/20 text-white" : "bg-paper text-ink"
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative max-w-xs w-full">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
            🔍
          </span>
          <Input
            placeholder="Search order, customer, product..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
        </div>
      </div>

      {/* Orders Table Container */}
      <Card className="overflow-hidden">
        <CardBody className="p-0">
          {loadingLive ? (
            <div className="py-16 text-center text-xs text-ink-soft font-mono bg-card-strong">
              Loading live orders...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4 bg-card-strong">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-paper border border-line mb-3 text-lg">
                🛒
              </span>
              <p className="text-sm font-semibold text-ink">No orders found</p>
              <p className="text-xs text-ink-soft mt-1 max-w-[280px]">
                {search
                  ? `No orders matching "${search}" found in this view.`
                  : `No ${filter !== "all" ? filter : ""} orders at the moment.`}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-line text-xs font-semibold uppercase tracking-wider text-ink-soft bg-paper/30">
                    <th className="py-3 px-6">Order ID</th>
                    <th className="py-3 px-6">Customer</th>
                    <th className="py-3 px-6 hidden md:table-cell">Items</th>
                    <th className="py-3 px-6 text-right">Amount</th>
                    <th className="py-3 px-6">Status</th>
                    <th className="py-3 px-6 hidden lg:table-cell">Date</th>
                    <th className="py-3 px-6 text-right pr-6">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line text-sm bg-card-strong">
                  {filtered.map((order) => {
                    const meta = statusMeta[order.status] || { label: order.status, tone: "neutral" as const };
                    const createdDate = new Date(order.createdAt);
                    const dateStr = isNaN(createdDate.getTime()) 
                      ? "Recent"
                      : createdDate.toLocaleDateString("en-PK", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        });
                    
                    const isUUID = order.id.includes("-");
                    const shortId = isUUID 
                      ? order.id.slice(0, 8).toUpperCase()
                      : order.id.replace("ord_", "").toUpperCase();

                    return (
                      <tr key={order.id} className="hover:bg-paper/20 transition-colors">
                        {/* Order ID */}
                        <td className="py-4 px-6">
                          <span className="font-mono text-xs font-semibold text-ink">
                            #{shortId}
                          </span>
                        </td>

                        {/* Customer */}
                        <td className="py-4 px-6">
                          <div className="flex flex-col min-w-0">
                            <span className="text-sm font-medium text-ink truncate max-w-[150px]">
                              {order.customerName}
                            </span>
                            <span className="text-xs text-ink-soft font-mono">
                              {order.customerPhone}
                            </span>
                          </div>
                        </td>

                        {/* Items */}
                        <td className="py-4 px-6 hidden md:table-cell">
                          <span className="text-xs text-ink-soft truncate max-w-[200px] block">
                            {order.items}
                          </span>
                        </td>

                        {/* Amount */}
                        <td className="py-4 px-6 text-right">
                          <span className="text-sm font-bold text-ink tabular-nums">
                            {formatPKR(order.total)}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="py-4 px-6">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </td>

                        {/* Date */}
                        <td className="py-4 px-6 hidden lg:table-cell">
                          <span className="text-xs text-ink-soft">
                            {dateStr}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="py-4 px-6 text-right pr-6">
                          {order.status === "pending" ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleUpdateStatus(order.id, "confirmed")}
                                className="inline-flex items-center justify-center rounded-lg bg-teal text-white hover:bg-teal-bright text-xs px-2.5 py-1 font-semibold transition-colors shadow-sm"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => handleUpdateStatus(order.id, "cancelled")}
                                className="inline-flex items-center justify-center rounded-lg border border-danger/30 text-danger hover:bg-danger/10 text-xs px-2.5 py-1 font-semibold transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs font-medium text-ink-soft">
                              {order.status === "confirmed" ? "✅ Done" : "❌ Cancelled"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
