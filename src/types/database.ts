/**
 * Hand-written for Phase 1. Regenerate with `npm run db:types` once the
 * Supabase CLI can reach this project (local stack or a linked remote), and
 * this file becomes fully generated like the rest of the schema will be.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type LocalizedText = Record<string, string>;

/**
 * Business Brain source vocabulary (multi-source addendum). Only `website`
 * and `manual` have a real connector implementation today — the rest exist
 * so a future connector (Instagram, PDF, ...) is additive, never a schema
 * redesign.
 */
export type SourceType =
  | "website"
  | "instagram"
  | "facebook"
  | "online_menu"
  | "pdf"
  | "document"
  | "image"
  | "google_business"
  | "manual"
  | "api";

export type Database = {
  public: {
    Tables: {
      platform_settings: {
        Row: {
          id: boolean;
          platform_name: string;
          logo_path: string | null;
          supported_languages: string[];
          supported_currencies: string[];
          maintenance_mode: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["platform_settings"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["platform_settings"]["Row"]>;
        Relationships: [];
      };
      currencies: {
        Row: { code: string; exponent: number; name: LocalizedText };
        Insert: Database["public"]["Tables"]["currencies"]["Row"];
        Update: Partial<Database["public"]["Tables"]["currencies"]["Row"]>;
        Relationships: [];
      };
      business_types: {
        Row: { key: string; name: LocalizedText; is_active: boolean };
        Insert: Database["public"]["Tables"]["business_types"]["Row"];
        Update: Partial<Database["public"]["Tables"]["business_types"]["Row"]>;
        Relationships: [];
      };
      tenants: {
        Row: {
          id: string;
          slug: string;
          business_name: LocalizedText;
          business_type_key: string;
          status: "onboarding" | "active" | "suspended" | "closed";
          default_language: string;
          enabled_languages: string[];
          currency: string;
          timezone: string;
          country: string | null;
          city: string | null;
          contact_email: string | null;
          contact_phone: string | null;
          website_url: string | null;
          deployment_mode: "website_widget" | "external_agent" | "both";
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["tenants"]["Row"]> & {
          business_name: LocalizedText;
          business_type_key: string;
        };
        Update: Partial<Database["public"]["Tables"]["tenants"]["Row"]>;
        Relationships: [];
      };
      tenant_settings: {
        Row: {
          tenant_id: string;
          agent: { active: boolean; assistant_name: string | null; greeting: string | null; tone: string | null };
          checkout: {
            ordering_enabled: boolean;
            fulfillment_types: ("pickup" | "delivery")[];
            delivery_fee_minor: number;
            minimum_order_minor: number;
            tax_rate_bps: number;
            tax_included: boolean;
          };
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["tenant_settings"]["Row"]> & { tenant_id: string };
        Update: Partial<Database["public"]["Tables"]["tenant_settings"]["Row"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          phone: string | null;
          email: string | null;
          preferred_language: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & { id: string };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      platform_admins: {
        Row: { user_id: string; level: string; created_at: string };
        Insert: Database["public"]["Tables"]["platform_admins"]["Row"];
        Update: Partial<Database["public"]["Tables"]["platform_admins"]["Row"]>;
        Relationships: [];
      };
      roles: {
        Row: { id: string; tenant_id: string | null; key: string; name: LocalizedText };
        Insert: Partial<Database["public"]["Tables"]["roles"]["Row"]> & { key: string; name: LocalizedText };
        Update: Partial<Database["public"]["Tables"]["roles"]["Row"]>;
        Relationships: [];
      };
      permissions: {
        Row: { key: string; module: string; description: string | null };
        Insert: Database["public"]["Tables"]["permissions"]["Row"];
        Update: Partial<Database["public"]["Tables"]["permissions"]["Row"]>;
        Relationships: [];
      };
      role_permissions: {
        Row: { role_id: string; permission_key: string };
        Insert: Database["public"]["Tables"]["role_permissions"]["Row"];
        Update: Partial<Database["public"]["Tables"]["role_permissions"]["Row"]>;
        Relationships: [];
      };
      tenant_members: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          role_id: string;
          status: "active" | "disabled";
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["tenant_members"]["Row"]> & {
          tenant_id: string;
          user_id: string;
          role_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["tenant_members"]["Row"]>;
        Relationships: [];
      };
      staff_invites: {
        Row: {
          id: string;
          tenant_id: string;
          email: string;
          role_key: "business_admin" | "staff";
          token_hash: string;
          status: "pending" | "accepted" | "revoked" | "expired";
          invited_by: string | null;
          expires_at: string;
          accepted_at: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: number;
          tenant_id: string | null;
          actor_id: string | null;
          action: string;
          entity: string;
          entity_id: string | null;
          diff: Json | null;
          ip: string | null;
          at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["audit_logs"]["Row"]> & { action: string; entity: string };
        Update: Partial<Database["public"]["Tables"]["audit_logs"]["Row"]>;
        Relationships: [];
      };
      branches: {
        Row: {
          id: string;
          tenant_id: string;
          name: LocalizedText;
          address: Json;
          phone: string | null;
          opening_hours: Json;
          is_default: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["branches"]["Row"]> & { tenant_id: string; name: LocalizedText };
        Update: Partial<Database["public"]["Tables"]["branches"]["Row"]>;
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          tenant_id: string;
          name: LocalizedText;
          position: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["categories"]["Row"]> & { tenant_id: string; name: LocalizedText };
        Update: Partial<Database["public"]["Tables"]["categories"]["Row"]>;
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          tenant_id: string;
          category_id: string | null;
          name: LocalizedText;
          description: LocalizedText;
          price_minor: number;
          status: "draft" | "active" | "archived";
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["products"]["Row"]> & {
          tenant_id: string;
          name: LocalizedText;
          price_minor: number;
        };
        Update: Partial<Database["public"]["Tables"]["products"]["Row"]>;
        Relationships: [];
      };
      business_sources: {
        Row: {
          id: string;
          tenant_id: string;
          source_type: SourceType;
          url: string | null;
          status: "pending" | "crawling" | "completed" | "failed" | "disabled";
          items_processed: number;
          error_message: string | null;
          is_active: boolean;
          last_scanned_at: string | null;
          scan_frequency: "manual" | "daily" | "weekly";
          content_hash: string | null;
          extraction_status: "raw_only" | "partial" | "structured";
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["business_sources"]["Row"]> & {
          tenant_id: string;
          source_type: string;
        };
        Update: Partial<Database["public"]["Tables"]["business_sources"]["Row"]>;
        Relationships: [];
      };
      business_brain_entries: {
        Row: {
          id: string;
          tenant_id: string;
          entry_type: string;
          entry_key: string;
          content: Json;
          version: number;
          status: "pending_review" | "approved" | "rejected" | "superseded" | "archived";
          is_active: boolean;
          source_type: SourceType;
          source_id: string | null;
          confidence: "high" | "medium" | "low";
          source_url: string | null;
          last_verified_at: string | null;
          rejection_reason: string | null;
          created_by: string | null;
          approved_by: string | null;
          approved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      business_brain_conflicts: {
        Row: {
          id: string;
          tenant_id: string;
          entry_key: string;
          entry_type: string;
          conflicting_values: { source_type: SourceType; source_id: string | null; value: Json; confidence: string; detected_at: string }[];
          status: "open" | "resolved";
          resolved_value: Json | null;
          resolved_by: string | null;
          resolved_at: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      ai_model_configs: {
        Row: {
          id: string;
          provider: "gemini" | "anthropic";
          model: string;
          kind: "fast" | "agent";
          input_price_per_million_usd: number;
          output_price_per_million_usd: number;
          is_active: boolean;
          is_default: boolean;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["ai_model_configs"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["ai_model_configs"]["Row"]>;
        Relationships: [];
      };
      agent_interactions: {
        Row: {
          id: string;
          tenant_id: string;
          request_type: string;
          handled_by: "deterministic" | "ai";
          deterministic_rule: string | null;
          provider: string | null;
          model: string | null;
          input_tokens: number;
          output_tokens: number;
          estimated_cost_usd: number;
          latency_ms: number | null;
          success: boolean;
          fallback_used: boolean;
          error_message: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          tenant_id: string;
          session_token_hash: string;
          channel: "external_agent" | "website_widget";
          locale: string;
          status: "open" | "closed";
          started_at: string;
          last_message_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["conversations"]["Row"]> & {
          tenant_id: string;
          session_token_hash: string;
        };
        Update: Partial<Database["public"]["Tables"]["conversations"]["Row"]>;
        Relationships: [];
      };
      conversation_messages: {
        Row: {
          id: string;
          tenant_id: string;
          conversation_id: string;
          role: "user" | "assistant";
          content: string;
          handled_by: "deterministic" | "ai" | null;
          modality: "text" | "voice";
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["conversation_messages"]["Row"]> & {
          tenant_id: string;
          conversation_id: string;
          role: "user" | "assistant";
          content: string;
        };
        Update: Partial<Database["public"]["Tables"]["conversation_messages"]["Row"]>;
        Relationships: [];
      };
      tenant_counters: {
        Row: { tenant_id: string; next_order_number: number };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      carts: {
        Row: {
          id: string;
          tenant_id: string;
          conversation_id: string;
          status: "active" | "converted" | "abandoned";
          fulfillment_type: "pickup" | "delivery" | null;
          branch_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          customer_email: string | null;
          delivery_address: Json | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["carts"]["Row"]> & { tenant_id: string; conversation_id: string };
        Update: Partial<Database["public"]["Tables"]["carts"]["Row"]>;
        Relationships: [];
      };
      cart_items: {
        Row: {
          id: string;
          tenant_id: string;
          cart_id: string;
          product_id: string;
          quantity: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["cart_items"]["Row"]> & {
          tenant_id: string;
          cart_id: string;
          product_id: string;
          quantity: number;
        };
        Update: Partial<Database["public"]["Tables"]["cart_items"]["Row"]>;
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          tenant_id: string;
          order_number: number;
          conversation_id: string | null;
          cart_id: string | null;
          status: "draft" | "pending_payment" | "paid" | "confirmed" | "preparing" | "ready" | "completed" | "cancelled" | "refunded";
          fulfillment_type: "pickup" | "delivery";
          branch_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          customer_email: string | null;
          delivery_address: Json | null;
          notes: string | null;
          currency: string;
          subtotal_minor: number;
          delivery_fee_minor: number;
          tax_minor: number;
          total_minor: number;
          placed_at: string;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      order_items: {
        Row: {
          id: string;
          tenant_id: string;
          order_id: string;
          product_id: string | null;
          product_name: LocalizedText;
          unit_price_minor: number;
          quantity: number;
          total_minor: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      order_status_history: {
        Row: {
          id: number;
          tenant_id: string;
          order_id: string;
          from_status: string | null;
          to_status: string;
          actor: "customer" | "staff" | "system";
          note: string | null;
          at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          tenant_id: string;
          order_id: string;
          provider: string;
          provider_intent_id: string | null;
          status: "pending" | "succeeded" | "failed";
          amount_minor: number;
          currency: string;
          failure_reason: string | null;
          raw_verification: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payment_webhook_events: {
        Row: {
          id: number;
          provider: string;
          event_id: string;
          payload: Json | null;
          received_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      subscription_plans: {
        Row: {
          key: string;
          name: LocalizedText;
          price_minor: number;
          currency: string;
          billing_interval: "month" | "year";
          trial_days: number;
          limits: Json;
          is_default: boolean;
          is_active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          tenant_id: string;
          plan_key: string;
          status: "trialing" | "active" | "past_due" | "canceled";
          trial_ends_at: string;
          current_period_end: string | null;
          canceled_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      subscription_payments: {
        Row: {
          id: string;
          tenant_id: string;
          plan_key: string;
          provider: string;
          provider_intent_id: string | null;
          status: "pending" | "succeeded" | "failed";
          amount_minor: number;
          currency: string;
          failure_reason: string | null;
          raw_verification: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_business: {
        Args: {
          p_business_name: LocalizedText;
          p_business_type_key: string;
          p_slug: string;
          p_default_language: string;
          p_currency: string;
        };
        Returns: string;
      };
      my_tenant_memberships: {
        Args: Record<string, never>;
        Returns: {
          tenant_id: string;
          slug: string;
          business_name: LocalizedText;
          status: string;
          role_key: string;
        }[];
      };
      create_brain_entry: {
        Args: {
          p_tenant_id: string;
          p_entry_type: string;
          p_entry_key: string;
          p_content: Json;
          p_source: SourceType;
          p_source_id: string | null;
        };
        Returns: string;
      };
      update_brain_entry: {
        Args: { p_entry_id: string; p_content: Json };
        Returns: string;
      };
      approve_brain_entry: {
        Args: { p_entry_id: string };
        Returns: undefined;
      };
      reject_brain_entry: {
        Args: { p_entry_id: string; p_reason: string | null };
        Returns: undefined;
      };
      set_brain_entry_active: {
        Args: { p_entry_id: string; p_active: boolean };
        Returns: undefined;
      };
      resolve_brain_conflict: {
        Args: { p_conflict_id: string; p_resolved_value: Json };
        Returns: undefined;
      };
      record_agent_interaction: {
        Args: {
          p_tenant_id: string;
          p_request_type: string;
          p_handled_by: "deterministic" | "ai";
          p_deterministic_rule: string | null;
          p_provider: string | null;
          p_model: string | null;
          p_input_tokens: number;
          p_output_tokens: number;
          p_estimated_cost_usd: number;
          p_latency_ms: number | null;
          p_success: boolean;
          p_fallback_used: boolean;
          p_error_message: string | null;
        };
        Returns: string;
      };
      agent_interaction_stats: {
        Args: { p_tenant_id: string; p_since?: string };
        Returns: {
          total_interactions: number;
          deterministic_count: number;
          ai_count: number;
          deterministic_pct: number;
          total_cost_usd: number;
        }[];
      };
      create_order_from_cart: {
        Args: { p_cart_id: string };
        Returns: string;
      };
      update_order_status: {
        Args: { p_order_id: string; p_new_status: string; p_note?: string | null };
        Returns: undefined;
      };
      create_payment_attempt: {
        Args: { p_order_id: string; p_provider?: string };
        Returns: {
          payment_id: string;
          provider: string;
          order_number: number;
          amount_minor: number;
          currency: string;
          reused: boolean;
        }[];
      };
      record_payment_provider_intent: {
        Args: { p_payment_id: string; p_provider_intent_id: string };
        Returns: undefined;
      };
      mark_payment_succeeded: {
        Args: { p_payment_id: string; p_provider_event_id: string; p_raw: Json };
        Returns: undefined;
      };
      mark_payment_failed: {
        Args: { p_payment_id: string; p_provider_event_id: string; p_raw: Json; p_reason?: string | null };
        Returns: undefined;
      };
      create_subscription_payment_attempt: {
        Args: { p_tenant_id: string; p_plan_key: string; p_provider?: string };
        Returns: {
          payment_id: string;
          provider: string;
          plan_key: string;
          amount_minor: number;
          currency: string;
          reused: boolean;
        }[];
      };
      record_subscription_payment_provider_intent: {
        Args: { p_payment_id: string; p_provider_intent_id: string };
        Returns: undefined;
      };
      mark_subscription_payment_succeeded: {
        Args: { p_payment_id: string; p_provider_event_id: string; p_raw: Json };
        Returns: undefined;
      };
      mark_subscription_payment_failed: {
        Args: { p_payment_id: string; p_provider_event_id: string; p_raw: Json; p_reason?: string | null };
        Returns: undefined;
      };
      create_staff_invite: {
        Args: { p_tenant_id: string; p_email: string; p_role_key: string };
        Returns: { invite_id: string; token: string }[];
      };
      accept_staff_invite: {
        Args: { p_token: string };
        Returns: string;
      };
      revoke_staff_invite: {
        Args: { p_invite_id: string };
        Returns: undefined;
      };
      update_staff_member_role: {
        Args: { p_member_id: string; p_role_key: string };
        Returns: undefined;
      };
      set_staff_member_status: {
        Args: { p_member_id: string; p_status: string };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
