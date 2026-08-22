"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  fetchConversations,
  fetchMessages,
  insertMessage,
  updateConversationStatus,
  markConversationAsRead,
  seedDatabase
} from "@/lib/supabase-service";
import { useSupabaseRealtime } from "@/lib/supabase/realtime";

interface Message {
  id: string;
  sender: "customer" | "bot" | "seller";
  content: string;
  createdAt: string;
}

interface Conversation {
  id: string;
  customerName: string;
  customerPhone: string;
  status: "needs-you" | "auto-replied" | "ordered";
  lastMessageAt: string;
  unreadCount: number;
  messages: Message[];
}

export default function InboxPage() {
  const { user } = useAuth();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "needs-you" | "replied">("all");
  const [loadingLive, setLoadingLive] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [toast, setToast] = useState<{message: string; visible: boolean}>({ message: "", visible: false });
  const chatEndRef = useRef<HTMLDivElement>(null);

  const activeChat = conversations.find((c) => c.id === activeId);

  // Sync data on mount or via realtime
  const loadConversations = async (silent = false) => {
    if (!user) return;

    try {
      if (!silent && conversations.length === 0) {
        setLoadingLive(true);
      }
      const dbConvs = await fetchConversations(user.id);
      const mappedConvs: Conversation[] = [];

      for (const c of dbConvs) {
        let dbMsgs: any[] = [];
        try {
          dbMsgs = await fetchMessages(user.id, c.id);
        } catch (msgErr) {
          console.error("Failed to fetch messages for conversation:", c.id, msgErr);
        }
        
        const mappedMsgs: Message[] = dbMsgs.map((m) => ({
          id: m.id,
          sender: m.sender_type === "system" ? "bot" : (m.sender_type as "customer" | "bot" | "seller"),
          content: m.content || (m as any).body || "",
          createdAt: new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        }));

        let cName = c.customer_name?.trim();
        if (!cName || cName === '.' || cName.toLowerCase() === 'unknown') {
          cName = c.customer_phone || "Unknown Customer";
        }

        mappedConvs.push({
          id: c.id,
          customerName: cName,
          customerPhone: c.customer_phone || "",
          status: c.status as "needs-you" | "auto-replied" | "ordered",
          lastMessageAt: new Date(c.last_message_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          unreadCount: c.unread_count || 0,
          messages: mappedMsgs,
        });
      }

      setConversations(mappedConvs);
      if (mappedConvs.length > 0) {
        const exists = mappedConvs.some((c) => c.id === activeId);
        if (!exists) {
          setActiveId(mappedConvs[0].id);
        }
      } else {
        setActiveId("");
      }
    } catch (err) {
      console.error("Failed to load live conversations:", err);
    } finally {
      setLoadingLive(false);
    }
  };

  useEffect(() => {
    loadConversations();
  }, [user]);

  useSupabaseRealtime("messages", user ? `seller_id=eq.${user.id}` : null, (payload) => {
    if (payload.eventType === "INSERT") {
      const newMsg = payload.new;
      if (newMsg.direction === "inbound" || newMsg.author === "customer" || newMsg.sender_type === "customer") {
        setToast({ message: "New message received!", visible: true });
        setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 3000);
      }
      loadConversations(true);
    }
  });

  useSupabaseRealtime("conversations", user ? `seller_id=eq.${user.id}` : null, () => {
    loadConversations(true);
  });

  // Seeding button trigger
  const handleSeedDatabase = async () => {
    if (!user) return;
    try {
      setSeeding(true);
      await seedDatabase(user.id);
      await loadConversations();
    } catch (err) {
      alert("Seeding failed. Make sure your database server is running.");
      console.error(err);
    } finally {
      setSeeding(false);
    }
  };

  // Auto scroll chat list to bottom on active chat switch
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeId, activeChat?.messages.length]);

  // Filter conversations
  const filtered = conversations.filter((c) => {
    const matchesSearch =
      c.customerName.toLowerCase().includes(search.toLowerCase()) ||
      c.customerPhone.includes(search);
    if (!matchesSearch) return false;

    if (filter === "needs-you") return c.status === "needs-you";
    if (filter === "replied") return c.status !== "needs-you";
    return true;
  });

  const handleSelectChat = async (chat: Conversation) => {
    setActiveId(chat.id);
    if (chat.unreadCount > 0 && user) {
      // Optimistically update local state
      setConversations((prev) =>
        prev.map((c) =>
          c.id === chat.id ? { ...c, unreadCount: 0 } : c
        )
      );
      // Update DB in background
      markConversationAsRead(user.id, chat.id).catch(err => {
        console.error("Failed to mark chat as read:", err);
      });
    }
  };

  const statusMeta = {
    "needs-you": { label: "Needs you", tone: "attention" as const },
    "auto-replied": { label: "Auto-replied", tone: "live" as const },
    ordered: { label: "Ordered", tone: "neutral" as const },
  };

  return (
    <div className="font-landing h-[calc(100vh-6.5rem)] flex flex-col">
      <div className="flex-none mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Inbox</h1>
          <p className="text-sm text-ink-soft mt-1">
            Monitor auto-responses and reply to your WhatsApp customers directly.
          </p>
        </div>
      </div>

      {/* Main Inbox Panel */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[340px_1fr] bg-card-strong border border-line rounded-[var(--radius-card)] overflow-hidden shadow-sm">
        {/* Left Column: List */}
        <div className="border-r border-line flex flex-col min-h-0 bg-card-strong">
          <div className="p-4 border-b border-line space-y-3">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
                🔍
              </span>
              <Input
                placeholder="Search chats..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>
            {/* Filter buttons */}
            <div className="flex gap-1">
              {(
                [
                  ["all", "All"],
                  ["needs-you", "Needs you"],
                  ["replied", "Replied"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
                    filter === key
                      ? "bg-teal-soft text-teal"
                      : "text-ink-soft hover:bg-paper hover:text-ink"
                  )}
                >
                  {label}
                  {key === "needs-you" &&
                    conversations.filter((c) => c.status === "needs-you").length > 0 && (
                      <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-marigold px-1 text-[9px] font-bold text-ink">
                        {conversations.filter((c) => c.status === "needs-you").length}
                      </span>
                    )}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-line">
            {loadingLive ? (
              <div className="p-8 text-center text-xs text-ink-soft font-mono">
                Loading live conversations...
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-xs text-ink-soft">
                No conversations found
              </div>
            ) : (
              filtered.map((chat) => {
                const meta = statusMeta[chat.status] || { label: chat.status, tone: "neutral" as const };
                const active = chat.id === activeId;
                const lastMsg = chat.messages[chat.messages.length - 1];

                return (
                  <button
                    key={chat.id}
                    onClick={() => handleSelectChat(chat)}
                    className={cn(
                      "w-full text-left p-4 flex gap-3 items-start transition-colors",
                      active ? "bg-paper-deep" : "hover:bg-paper/30"
                    )}
                  >
                    <span className="h-9 w-9 rounded-full bg-teal-soft/40 text-teal font-bold flex items-center justify-center text-sm">
                      {chat.customerName.charAt(0)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-ink truncate">
                          {chat.customerName}
                        </span>
                        <span className="text-[10px] text-ink-faint tabular-nums shrink-0">
                          {chat.lastMessageAt}
                        </span>
                      </div>
                      <p className="text-xs text-ink-soft truncate mt-0.5">
                        {lastMsg ? lastMsg.content : "No messages"}
                      </p>
                      <div className="mt-2 flex items-center justify-between">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        <span className="text-[10px] font-mono text-ink-faint">
                          {chat.customerPhone}
                        </span>
                      </div>
                    </div>
                    {chat.unreadCount > 0 && (
                      <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-teal text-[10px] font-bold text-white shadow-sm">
                        {chat.unreadCount}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Chat View */}
        <div className="flex flex-col min-h-0 bg-paper/20">
          {conversations.length === 0 && !loadingLive ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 select-none space-y-4">
              <span className="text-4xl">💬</span>
              <p className="text-sm font-semibold text-ink">Your Live Inbox is empty</p>
              <p className="text-xs text-ink-soft max-w-sm">
                Meta cloud webhooks are configured but no customer messages have landed yet. Click below to seed test chats into your database.
              </p>
              <Button
                onClick={handleSeedDatabase}
                disabled={seeding}
                className="bg-teal hover:bg-teal-bright text-paper"
              >
                {seeding ? "Seeding Database..." : "Seed Database with Test Data"}
              </Button>
            </div>
          ) : activeChat ? (
            <>
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-card-strong">
                <div className="flex items-center gap-3">
                  <span className="h-10 w-10 rounded-full bg-teal text-white font-bold flex items-center justify-center text-base shadow-sm">
                    {activeChat.customerName.charAt(0)}
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-ink">
                      {activeChat.customerName}
                    </h3>
                    <p className="text-xs text-ink-soft font-mono mt-0.5">
                      {activeChat.customerPhone}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={statusMeta[activeChat.status]?.tone || "neutral"}>
                    {statusMeta[activeChat.status]?.label || activeChat.status}
                  </Badge>
                  <span className="text-xs text-ink-faint">· WhatsApp Channel</span>
                  
                  {/* Open WhatsApp Button */}
                  {activeChat.customerPhone && (
                    <a
                      href={`https://wa.me/${activeChat.customerPhone.replace(/[^0-9]/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 inline-flex items-center justify-center rounded-lg border border-teal text-teal hover:bg-teal-soft/20 px-3 py-1.5 text-xs font-semibold transition-colors shadow-sm"
                      title="Open chat in WhatsApp Web or App"
                    >
                      Open WhatsApp
                    </a>
                  )}
                </div>
              </div>

              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {activeChat.messages.map((msg) => {
                  const isSeller = msg.sender === "seller";
                  const isBot = msg.sender === "bot";

                  return (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex flex-col max-w-[75%]",
                        isSeller
                          ? "ml-auto items-end"
                          : isBot
                          ? "mr-auto items-start max-w-[85%]"
                          : "mr-auto items-start"
                      )}
                    >
                      <div
                        className={cn(
                          "rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-sm",
                          isSeller
                            ? "bg-teal text-white rounded-br-none"
                            : isBot
                            ? "bg-teal-soft/15 border border-teal-soft text-ink rounded-bl-none"
                            : "bg-card-strong border border-line text-ink rounded-bl-none"
                        )}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        <div className="mt-1.5 flex items-center gap-1.5 text-[9px] uppercase tracking-wide opacity-70">
                          <span>
                            {isSeller ? "You" : isBot ? "🤖 AI Agent" : "Customer"}
                          </span>
                          <span>·</span>
                          <span className="tabular-nums">{msg.createdAt}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 select-none">
              <span className="text-4xl mb-3">💬</span>
              <p className="text-sm font-semibold text-ink">Select a Conversation</p>
              <p className="text-xs text-ink-soft max-w-sm mt-1">
                Choose a customer on the left to review chat history, configure custom prompts, and auto-reply.
              </p>
            </div>
          )}
        </div>
      </div>
      
      {toast.visible && (
        <div className="fixed bottom-6 right-6 bg-teal text-white px-5 py-3 rounded-lg shadow-xl z-50 text-sm font-semibold transition-opacity duration-300">
          {toast.message}
        </div>
      )}
    </div>
  );
}
