import { createClient } from "@/lib/supabase/client";

export interface DBConversation {
  id: string;
  seller_id: string;
  channel: string;
  external_id: string;
  customer_name: string;
  customer_phone: string;
  status: string; // 'needs-you' | 'auto-replied' | 'ordered'
  last_message_at: string;
  unread_count: number;
  created_at: string;
}

export interface DBMessage {
  id: string;
  seller_id: string;
  conversation_id: string;
  sender_type: 'customer' | 'bot' | 'seller' | 'system';
  content: string;
  read: boolean;
  created_at: string;
}

export interface DBOrder {
  id: string;
  seller_id: string;
  conversation_id: string | null;
  external_order_id: string | null;
  customer_name: string;
  customer_phone: string;
  total: number;
  status: string; // 'pending' | 'confirmed' | 'cancelled'
  created_at: string;
}

function getSupabase() {
  return createClient();
}

/** Fetch all conversations for a seller */
export async function fetchConversations(sellerId: string): Promise<DBConversation[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("seller_id", sellerId)
    .order("last_message_at", { ascending: false });

  if (error) {
    console.error("Error fetching conversations:", error);
    throw error;
  }
  return data || [];
}

/** Fetch messages for a specific conversation */
export async function fetchMessages(sellerId: string, conversationId: string): Promise<DBMessage[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("seller_id", sellerId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching messages:", error);
    throw error;
  }
  return data || [];
}

/** Insert a new message into a conversation */
export async function insertMessage(
  sellerId: string,
  conversationId: string,
  content: string,
  senderType: "customer" | "bot" | "seller" | "system",
  read: boolean = false
): Promise<DBMessage> {
  const supabase = getSupabase();
  // 1. Insert message row
  const { data, error } = await supabase
    .from("messages")
    .insert({
      seller_id: sellerId,
      conversation_id: conversationId,
      content,
      sender_type: senderType,
      read
    })
    .select()
    .single();

  if (error) {
    console.error("Error inserting message:", error);
    throw error;
  }

  // 2. Update last_message_at timestamp in conversation
  const { error: convError } = await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("seller_id", sellerId);

  if (convError) {
    console.error("Error updating conversation timestamp:", convError);
  }

  return data;
}

/** Update the status of a conversation */
export async function updateConversationStatus(
  sellerId: string,
  conversationId: string,
  status: "needs-you" | "auto-replied" | "ordered"
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("conversations")
    .update({ status })
    .eq("id", conversationId)
    .eq("seller_id", sellerId);

  if (error) {
    console.error("Error updating conversation status:", error);
    throw error;
  }
}

/** Mark conversation as read (reset unread_count) */
export async function markConversationAsRead(
  sellerId: string,
  conversationId: string
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("id", conversationId)
    .eq("seller_id", sellerId);

  if (error) {
    console.error("Error marking conversation as read:", error);
  }
}

/** Fetch all orders for a seller */
export async function fetchOrders(sellerId: string): Promise<DBOrder[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching orders:", error);
    throw error;
  }
  return data || [];
}

/** Update an order's confirmation/cancellation status */
export async function updateOrderStatus(
  sellerId: string,
  orderId: string,
  status: "pending" | "confirmed" | "cancelled"
): Promise<void> {
  // Map internal status string if needed (database uses 'pending_confirmation', 'confirmed', 'cancelled')
  const dbStatus = status === "pending" ? "pending_confirmation" : status;
  
  const supabase = getSupabase();
  const { error } = await supabase
    .from("orders")
    .update({ status: dbStatus, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("seller_id", sellerId);

  if (error) {
    console.error("Error updating order status:", error);
    throw error;
  }
}

/** Helper to clear all conversations, messages, and orders for a seller in Supabase */
export async function clearDatabase(sellerId: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from("messages").delete().eq("seller_id", sellerId);
  await supabase.from("orders").delete().eq("seller_id", sellerId);
  await supabase.from("conversations").delete().eq("seller_id", sellerId);
}

/** Helper to seed realistic demo data directly inside Supabase for live testing */
export async function seedDatabase(sellerId: string): Promise<void> {
  const supabase = getSupabase();
  // 1. Delete existing records for this seller to allow clean re-runs
  await clearDatabase(sellerId);

  // 2. Define seed conversations
  const convsToInsert = [
    {
      seller_id: sellerId,
      channel: "whatsapp",
      external_id: "wa_sana",
      customer_name: "Sana M.",
      customer_phone: "+92 300 7712004",
      status: "needs-you",
      last_message_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 mins ago
      unread_count: 1,
    },
    {
      seller_id: sellerId,
      channel: "whatsapp",
      external_id: "wa_ayesha",
      customer_name: "Ayesha K.",
      customer_phone: "+92 321 8890021",
      status: "auto-replied",
      last_message_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hr ago
      unread_count: 0,
    },
    {
      seller_id: sellerId,
      channel: "whatsapp",
      external_id: "wa_bilal",
      customer_name: "Bilal R.",
      customer_phone: "+92 333 4471190",
      status: "ordered",
      last_message_at: new Date(Date.now() - 120 * 60 * 1000).toISOString(), // 2 hrs ago
      unread_count: 0,
    },
    {
      seller_id: sellerId,
      channel: "whatsapp",
      external_id: "wa_zoya",
      customer_name: "Zoya T.",
      customer_phone: "+92 311 2098443",
      status: "auto-replied",
      last_message_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Yesterday
      unread_count: 0,
    }
  ];

  const { data: insertedConvs, error: convError } = await supabase
    .from("conversations")
    .insert(convsToInsert)
    .select();

  if (convError || !insertedConvs) {
    console.error("Seeding conversations failed:", convError);
    throw convError || new Error("Insert failed");
  }

  // 3. Find inserted IDs
  const sana = insertedConvs.find(c => c.external_id === "wa_sana")!;
  const ayesha = insertedConvs.find(c => c.external_id === "wa_ayesha")!;
  const bilal = insertedConvs.find(c => c.external_id === "wa_bilal")!;
  const zoya = insertedConvs.find(c => c.external_id === "wa_zoya")!;

  // 4. Define seed messages
  const messagesToInsert = [
    // Sana M
    {
      seller_id: sellerId,
      conversation_id: sana.id,
      sender_type: "customer" as const,
      content: "Hi! Can you make a custom nameplate necklace in rose gold plating with my daughter's name?",
      read: false,
      created_at: new Date(Date.now() - 11 * 60 * 1000).toISOString()
    },
    // Ayesha K
    {
      seller_id: sellerId,
      conversation_id: ayesha.id,
      sender_type: "customer" as const,
      content: "Assalam o alaikum! Do you deliver Payal Anklets to Multan? If yes, what are the delivery charges?",
      read: true,
      created_at: new Date(Date.now() - 65 * 60 * 1000).toISOString()
    },
    {
      seller_id: sellerId,
      conversation_id: ayesha.id,
      sender_type: "bot" as const,
      content: "Assalam o alaikum Ayesha! Yes, we deliver nationwide to Multan via Leopards courier. Delivery takes 2-3 working days. Delivery charges are a flat Rs. 150.",
      read: true,
      created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString()
    },
    // Bilal R
    {
      seller_id: sellerId,
      conversation_id: bilal.id,
      sender_type: "customer" as const,
      content: "I want to confirm order for Beaded Charm Bracelet. Phone is +923334471190. Shipping to Lahore.",
      read: true,
      created_at: new Date(Date.now() - 130 * 60 * 1000).toISOString()
    },
    {
      seller_id: sellerId,
      conversation_id: bilal.id,
      sender_type: "bot" as const,
      content: "Assalam o alaikum Bilal! Thank you for choosing Meher Handmade. Your order for the Beaded Charm Bracelet (PKR 650) is being processed. Delivery takes 2-3 working days.",
      read: true,
      created_at: new Date(Date.now() - 120 * 60 * 1000).toISOString()
    },
    // Zoya T
    {
      seller_id: sellerId,
      conversation_id: zoya.id,
      sender_type: "customer" as const,
      content: "Is the Gold-tone Hoop Earrings available?",
      read: true,
      created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    },
    {
      seller_id: sellerId,
      conversation_id: zoya.id,
      sender_type: "bot" as const,
      content: "Hello Zoya! Yes, Gold-tone Hoop Earrings are in stock and available for order. The price is Rs. 1,900 (discounted from Rs. 2,500).",
      read: true,
      created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    }
  ];

  const { error: msgError } = await supabase.from("messages").insert(messagesToInsert);
  if (msgError) {
    console.error("Seeding messages failed:", msgError);
    throw msgError;
  }

  // 5. Define seed orders
  const ordersToInsert = [
    {
      id: "3a886a11-82cc-499c-851f-ef0021b01235",
      seller_id: sellerId,
      conversation_id: bilal.id,
      external_order_id: "#1001",
      customer_name: "Bilal R.",
      customer_phone: "+92 333 4471190",
      total: 3500,
      status: "confirmed",
      created_at: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
    },
    {
      id: "4b997b22-93dd-5aae-962f-f01132c02346",
      seller_id: sellerId,
      conversation_id: sana.id,
      external_order_id: "#1002",
      customer_name: "Sana M.",
      customer_phone: "+92 300 7712004",
      total: 2200,
      status: "pending_confirmation",
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    },
    {
      id: "5c008c33-04ee-6bbf-073f-012243d03457",
      seller_id: sellerId,
      conversation_id: ayesha.id,
      external_order_id: "#1003",
      customer_name: "Ayesha K.",
      customer_phone: "+92 321 8890021",
      total: 1850,
      status: "pending_confirmation",
      created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    },
    {
      id: "6d119d44-15ff-7ccg-184g-123354e04568",
      seller_id: sellerId,
      conversation_id: zoya.id,
      external_order_id: "#1004",
      customer_name: "Zoya T.",
      customer_phone: "+92 311 2098443",
      total: 900,
      status: "cancelled",
      created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    }
  ];

  const { error: orderError } = await supabase.from("orders").insert(ordersToInsert);
  if (orderError) {
    console.error("Seeding orders failed:", orderError);
    throw orderError;
  }
}
