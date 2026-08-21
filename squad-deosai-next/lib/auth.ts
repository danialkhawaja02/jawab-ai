"use client";

/**
 * Auth hook — wired to Supabase.
 * Reads the logged-in user from the Supabase session and fetches the matching
 * row from the `sellers` table so every dashboard page has real profile data.
 */
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export type AuthUser = {
  id: string;
  email: string;
  businessName: string;
  ownerName: string;
  phone: string;
  plan: string;
  memberSince: string;
  role: "seller" | "admin";
  industry: string;
  website: string;
  roleDescription: string;
  companySize: string;
  onboarded: boolean;
};

export type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  signOut: () => void;
};

/** Build an AuthUser from a Supabase auth user + sellers row. */
function toAuthUser(
  authUser: User,
  seller: Record<string, unknown> | null,
): AuthUser {
  const createdAt = authUser.created_at
    ? new Date(authUser.created_at)
    : new Date();
  const memberSince = createdAt.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return {
    id: authUser.id,
    email:
      (seller?.email as string) ??
      authUser.email ??
      (typeof window !== "undefined" ? window.localStorage.getItem(`email_${authUser.id}`) : null) ??
      "",
    businessName:
      (seller?.business_name as string) ??
      (authUser.user_metadata?.business_name as string) ??
      (typeof window !== "undefined" ? window.localStorage.getItem(`biz_name_${authUser.id}`) : null) ??
      "",
    ownerName:
      (seller?.owner_name as string) ??
      (typeof window !== "undefined" ? window.localStorage.getItem(`owner_name_${authUser.id}`) : null) ??
      "",
    phone:
      (seller?.phone as string) ??
      (authUser.user_metadata?.phone as string) ??
      (typeof window !== "undefined" ? window.localStorage.getItem(`phone_${authUser.id}`) : null) ??
      "",
    plan: (seller?.plan as string) ?? "Early Access",
    memberSince,
    role:
      (typeof window !== "undefined" && window.localStorage.getItem(`role_${authUser.id}`) === "admin"
        ? "admin"
        : (seller?.role as "seller" | "admin")) ?? "seller",
    industry:
      (seller?.industry as string) ??
      (typeof window !== "undefined" ? window.localStorage.getItem(`industry_${authUser.id}`) : null) ??
      "",
    website:
      (seller?.website as string) ??
      (typeof window !== "undefined" ? window.localStorage.getItem(`website_${authUser.id}`) : null) ??
      "",
    roleDescription:
      (seller?.role_description as string) ??
      (typeof window !== "undefined" ? window.localStorage.getItem(`role_desc_${authUser.id}`) : null) ??
      "",
    companySize:
      (seller?.company_size as string) ??
      (typeof window !== "undefined" ? window.localStorage.getItem(`company_size_${authUser.id}`) : null) ??
      "",
    onboarded:
      (seller?.onboarded as boolean) ||
      (typeof window !== "undefined" ? window.localStorage.getItem(`onboarded_${authUser.id}`) === "true" : false),
  };
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    // 1. Fetch current session user + sellers row
    async function load() {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();

      if (!authUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      // Fetch the sellers row for extra profile fields
      const { data: seller } = await supabase
        .from("sellers")
        .select("*")
        .eq("id", authUser.id)
        .maybeSingle();

      setUser(toAuthUser(authUser, seller));
      setLoading(false);
    }

    load();

    // 2. Listen for auth state changes (login / logout / token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const { data: seller } = await supabase
          .from("sellers")
          .select("*")
          .eq("id", session.user.id)
          .maybeSingle();

        setUser(toAuthUser(session.user, seller));
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    // 1. Clean up WhatsApp session first
    try {
      await fetch('/api/whatsapp/logout', { method: 'POST' });
    } catch (e) {
      console.error('Failed to logout WhatsApp session', e);
    }

    // 2. Sign out of Supabase
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    if (typeof window !== "undefined") window.location.href = "/";
  };

  return { user, loading, signOut };
}
