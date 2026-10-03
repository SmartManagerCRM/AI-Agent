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
  | "api"
  | "online_ordering";

export type SourceProcessingStatus =
  | "new"
  | "processing"
  | "processed"
  | "unchanged"
  | "changed"
  | "failed"
  | "blocked"
  | "requires_review";

/** Public Agent deployment lifecycle — only `published` is publicly reachable. */
export type AgentDeploymentStatus = "draft" | "review" | "ready" | "published" | "paused" | "unpublished";

export type ExtractionMethod = "owner" | "structured_api" | "structured_data" | "deterministic" | "ocr" | "vision" | "ai" | "inferred";

export type IngestionJobStatus =
  | "created"
  | "discovering"
  | "fetching"
  | "extracting"
  | "ai_processing"
  | "normalizing"
  | "validating"
  | "conflict_check"
  | "ready_for_review"
  | "completed"
  | "failed"
  | "paused"
  | "cancelled";

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
          default_ai_monthly_budget_usd: number | null;
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
          /** Storage path (catalog-images bucket) of the business's logo, uploaded in Settings. */
          logo_path: string | null;
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
          agent: {
            active: boolean;
            assistant_name: string | null;
            greeting: string | null;
            tone: string | null;
            /** Storage path (catalog-images bucket) of the photo behind the whole customer Agent. */
            background_path?: string | null;
            /** The Agent's spoken voice (customer devices' own speech): male or female. */
            voice?: "male" | "female" | null;
          };
          checkout: {
            ordering_enabled: boolean;
            fulfillment_types: ("pickup" | "delivery" | "dine_in")[];
            delivery_fee_minor: number;
            minimum_order_minor: number;
            tax_rate_bps: number;
            tax_included: boolean;
          };
          ai_monthly_budget_usd: number | null;
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
      platform_announcements: {
        Row: {
          id: string;
          message: string;
          severity: "info" | "warning";
          is_active: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["platform_announcements"]["Row"]> & { message: string };
        Update: Partial<Database["public"]["Tables"]["platform_announcements"]["Row"]>;
        Relationships: [];
      };
      notification_events: {
        Row: {
          id: string;
          kind: "new_order_received" | "brain_analysis_finished" | "new_subscriber" | "subscription_upgraded";
          audience: "tenant" | "platform";
          tenant_id: string;
          entity_id: string;
          dedupe_key: string;
          payload: Json;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      super_admin_impersonations: {
        Row: {
          id: string;
          admin_user_id: string;
          tenant_id: string;
          started_at: string;
          expires_at: string;
          ended_at: string | null;
        };
        Insert: never;
        Update: never;
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
      branch_tables: {
        Row: {
          id: string;
          tenant_id: string;
          branch_id: string;
          label: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["branch_tables"]["Row"]> & {
          tenant_id: string;
          branch_id: string;
          label: string;
        };
        Update: Partial<Database["public"]["Tables"]["branch_tables"]["Row"]>;
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
          /** draft: not yet on sale · suspended: taken off sale by the owner · archived: deleted. */
          status: "draft" | "active" | "suspended" | "archived";
          /** Where the product came from: added by hand, Business Brain draft, or a file import. */
          source: "manual" | "brain" | "file_import";
          brain_fact_key: string | null;
          /** The price as found in another currency — the owner must set their own before it can go live. */
          source_price: { amount: string | null; currency: string | null } | null;
          /** Photo in the `catalog-images` bucket ("<tenant>/<product>-<hash>.webp"), null when none. */
          image_path: string | null;
          /** Where the photo was found (menu page / file); null for uploads. */
          image_source_url: string | null;
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
          external_id: string | null;
          processing_status: SourceProcessingStatus;
          priority: number;
          last_fetched_at: string | null;
          last_changed_at: string | null;
          last_processed_at: string | null;
          extraction_version: string | null;
          attribution: Json | null;
          /** Per-source analysis figures (menu sources: images, products, prices, ...). */
          metrics: Json | null;
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
          fact_key: string | null;
          confidence_score: number | null;
          extraction_method: ExtractionMethod | null;
          extraction_model: string | null;
          processing_version: string | null;
          first_seen_at: string | null;
          last_seen_at: string | null;
          expires_at: string | null;
          ingestion_job_id: string | null;
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
          conflicting_values: {
            source_type: SourceType;
            source_id: string | null;
            value: Json;
            confidence: string;
            detected_at: string;
            /** Discovery conflicts (`ingest_brain_fact`) reference each candidate entry. */
            entry_id?: string;
            confidence_score?: number | null;
            status?: string;
          }[];
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
      voice_profiles: {
        Row: {
          id: string;
          gender: "male" | "female";
          provider: "elevenlabs";
          voice_id: string;
          voice_name: string | null;
          model: string;
          price_per_million_chars_usd: number;
          settings: Record<string, number | boolean>;
          is_active: boolean;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["voice_profiles"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["voice_profiles"]["Row"]>;
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
          ingestion_job_id: string | null;
          source_document_id: string | null;
          purpose: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      agent_deployments: {
        Row: {
          tenant_id: string;
          status: AgentDeploymentStatus;
          published_at: string | null;
          first_published_at: string | null;
          paused_at: string | null;
          published_by: string | null;
          launch_check: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      brain_ingestion_jobs: {
        Row: {
          id: string;
          tenant_id: string;
          trigger: "onboarding" | "manual" | "refresh";
          input: Json;
          status: IngestionJobStatus;
          status_reason: string | null;
          place_id: string | null;
          detected_business_type: string | null;
          started_at: string | null;
          completed_at: string | null;
          sources_processed: number;
          pages_processed: number;
          documents_processed: number;
          facts_proposed: number;
          conflicts_detected: number;
          ai_calls: number;
          ai_input_tokens: number;
          ai_output_tokens: number;
          ai_cost_usd: number;
          google_calls: number;
          google_cost_usd: number;
          budget_usd: number;
          warnings: Json;
          errors: Json;
          readiness: Json | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["brain_ingestion_jobs"]["Row"]> & { tenant_id: string };
        Update: Partial<Database["public"]["Tables"]["brain_ingestion_jobs"]["Row"]>;
        Relationships: [];
      };
      brain_ingestion_events: {
        Row: {
          id: number;
          tenant_id: string;
          job_id: string;
          at: string;
          step: string;
          level: "info" | "success" | "warning" | "error";
          message: string;
          data: Json | null;
        };
        Insert: { tenant_id: string; job_id: string; step: string; message: string; level?: "info" | "success" | "warning" | "error"; data?: Json | null };
        Update: never;
        Relationships: [];
      };
      brain_source_documents: {
        Row: {
          id: string;
          tenant_id: string;
          source_id: string;
          url: string;
          canonical_url: string;
          kind: "page" | "document" | "image";
          topic: string | null;
          priority_score: number;
          title: string | null;
          content_hash: string | null;
          status: SourceProcessingStatus;
          extraction_version: string | null;
          extraction: Json | null;
          error_message: string | null;
          last_fetched_at: string | null;
          last_changed_at: string | null;
          last_processed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["brain_source_documents"]["Row"]> & {
          tenant_id: string;
          source_id: string;
          url: string;
          canonical_url: string;
        };
        Update: Partial<Database["public"]["Tables"]["brain_source_documents"]["Row"]>;
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
      bookable_services: {
        Row: {
          id: string;
          tenant_id: string;
          name: LocalizedText;
          duration_minutes: number;
          price_minor: number | null;
          is_active: boolean;
          source: "manual" | "brain" | "file_import";
          brain_fact_key: string | null;
          /** Set when the owner deleted the service (kept for its bookings). */
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["bookable_services"]["Row"]> & {
          tenant_id: string;
          name: LocalizedText;
          duration_minutes: number;
        };
        Update: Partial<Database["public"]["Tables"]["bookable_services"]["Row"]>;
        Relationships: [];
      };
      bookings: {
        Row: {
          id: string;
          tenant_id: string;
          service_id: string;
          conversation_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          customer_email: string | null;
          starts_at: string;
          ends_at: string;
          status: "confirmed" | "completed" | "canceled";
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["bookings"]["Row"]> & {
          tenant_id: string;
          service_id: string;
          starts_at: string;
          ends_at: string;
        };
        Update: Partial<Database["public"]["Tables"]["bookings"]["Row"]>;
        Relationships: [];
      };
      leads: {
        Row: {
          id: string;
          tenant_id: string;
          conversation_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          customer_email: string | null;
          message: string;
          status: "new" | "contacted" | "qualified" | "closed";
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["leads"]["Row"]> & { tenant_id: string; message: string };
        Update: Partial<Database["public"]["Tables"]["leads"]["Row"]>;
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
          fulfillment_type: "pickup" | "delivery" | "dine_in" | null;
          payment_method: "moyasar" | "tap" | "cash_on_delivery" | "pay_on_table" | null;
          branch_id: string | null;
          table_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          customer_email: string | null;
          delivery_address: Json | null;
          notes: string | null;
          coupon_code: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["carts"]["Row"]> & { tenant_id: string; conversation_id: string };
        Update: Partial<Database["public"]["Tables"]["carts"]["Row"]>;
        Relationships: [];
      };
      tenant_payment_config: {
        Row: {
          tenant_id: string;
          enabled_methods: ("moyasar" | "tap" | "cash_on_delivery" | "pay_on_table")[];
          moyasar_secret_key: string | null;
          tap_secret_key: string | null;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["tenant_payment_config"]["Row"]> & { tenant_id: string };
        Update: Partial<Database["public"]["Tables"]["tenant_payment_config"]["Row"]>;
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
          status:
            | "draft"
            | "pending_payment"
            | "paid"
            | "confirmed"
            | "preparing"
            | "ready"
            | "completed"
            | "cancelled"
            | "refunded";
          fulfillment_type: "pickup" | "delivery" | "dine_in";
          branch_id: string | null;
          table_id: string | null;
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
          coupon_id: string | null;
          discount_minor: number;
          /** agent = customer checkout; manual / bulk_import = entered by staff in the console. */
          created_via: "agent" | "manual" | "bulk_import";
          placed_at: string;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      coupons: {
        Row: {
          id: string;
          tenant_id: string;
          code: string;
          description: string | null;
          discount_type: "percentage" | "fixed";
          discount_value: number;
          min_order_minor: number;
          usage_limit: number | null;
          times_used: number;
          starts_at: string | null;
          ends_at: string | null;
          status: "active" | "disabled";
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["coupons"]["Row"]> & {
          tenant_id: string;
          code: string;
          discount_type: "percentage" | "fixed";
          discount_value: number;
        };
        Update: Partial<Database["public"]["Tables"]["coupons"]["Row"]>;
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
          conversation_limit: number | null;
          grace_period_hours: number;
          is_default: boolean;
          is_active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["subscription_plans"]["Row"]> &
          Pick<Database["public"]["Tables"]["subscription_plans"]["Row"], "key" | "price_minor" | "currency">;
        Update: Partial<Database["public"]["Tables"]["subscription_plans"]["Row"]>;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          tenant_id: string;
          plan_key: string;
          status: "trialing" | "active" | "past_due" | "canceled";
          trial_ends_at: string;
          current_period_start: string | null;
          current_period_end: string | null;
          canceled_at: string | null;
          conversation_limit_override: number | null;
          conversation_limit_reached_at: string | null;
          conversation_limit_grace_until: string | null;
          trial_limit_reached_at: string | null;
          trial_limit_reason: "conversation_limit" | "ai_cost_limit" | null;
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
      ai_cost_limits: {
        Row: {
          id: string;
          plan_key: string | null;
          tenant_id: string | null;
          limit_usd: number;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      ai_usage_periods: {
        Row: {
          tenant_id: string;
          period_start: string;
          ai_cost_usd: number;
          ai_calls: number;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      usage_settings: {
        Row: {
          id: boolean;
          conversation_warning_percents: number[];
          ai_cost_warning_percent: number;
          trial_conversation_limit: number | null;
          trial_ai_cost_limit_usd: number | null;
          updated_at: string;
        };
        Insert: never;
        Update: Partial<
          Pick<
            Database["public"]["Tables"]["usage_settings"]["Row"],
            | "conversation_warning_percents"
            | "ai_cost_warning_percent"
            | "trial_conversation_limit"
            | "trial_ai_cost_limit_usd"
          >
        >;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      admin_update_business: {
        Args: {
          p_tenant_id: string;
          p_name_locale: string;
          p_business_name: string;
          p_business_type_key: string;
          p_status: string;
          p_contact_email: string | null;
          p_contact_phone: string | null;
          p_website_url: string | null;
          p_country: string | null;
          p_city: string | null;
          p_timezone: string;
          p_default_language: string;
          p_deployment_mode: string;
          p_owner_full_name: string | null;
          p_owner_phone: string | null;
        };
        Returns: undefined;
      };
      admin_update_subscription: {
        Args: {
          p_tenant_id: string;
          p_plan_key: string;
          p_status: string;
          p_trial_ends_at: string;
          p_current_period_start: string | null;
          p_current_period_end: string | null;
        };
        Returns: undefined;
      };
      tenant_usage_summary: {
        Args: { p_tenant_id: string };
        Returns: Json;
      };
      ai_usage_check: {
        Args: { p_tenant_id: string };
        Returns: Json;
      };
      reserve_ai_cost: {
        Args: { p_tenant_id: string; p_estimate_usd: number };
        Returns: Json;
      };
      settle_ai_cost: {
        Args: { p_tenant_id: string; p_reservation_id: string | null; p_actual_usd: number };
        Returns: undefined;
      };
      platform_usage_overview: {
        Args: { p_tenant_id?: string | null };
        Returns: Json;
      };
      set_subscription_usage_overrides: {
        Args: { p_tenant_id: string; p_conversation_limit: number | null; p_ai_cost_limit: number | null };
        Returns: undefined;
      };
      set_plan_usage_limits: {
        Args: {
          p_plan_key: string;
          p_conversation_limit: number | null;
          p_ai_cost_limit: number | null;
          p_grace_period_hours: number;
        };
        Returns: undefined;
      };
      ingest_brain_fact: {
        Args: {
          p_tenant_id: string;
          p_fact_key: string;
          p_entry_type: string;
          p_content: Json;
          p_source: string;
          p_source_id: string | null;
          p_confidence_score: number;
          p_method: ExtractionMethod;
          p_model: string | null;
          p_job_id: string | null;
          p_expires_at: string | null;
          p_critical: boolean;
        };
        Returns: "created" | "unchanged" | "conflict";
      };
      record_ingestion_ai_call: {
        Args: {
          p_tenant_id: string;
          p_job_id: string;
          p_source_document_id: string | null;
          p_purpose: string;
          p_provider: string;
          p_model: string;
          p_input_tokens: number;
          p_output_tokens: number;
          p_estimated_cost_usd: number;
          p_latency_ms: number;
          p_success: boolean;
          p_error_message: string | null;
        };
        Returns: undefined;
      };
      purge_expired_brain_facts: {
        Args: { p_tenant_id: string };
        Returns: number;
      };
      publish_agent: {
        Args: { p_tenant_id: string };
        Returns: { status: "published"; trial_started: boolean; trial_ends_at: string | null };
      };
      pause_agent: {
        Args: { p_tenant_id: string };
        Returns: undefined;
      };
      tenant_dashboard_stats: {
        Args: { p_tenant_id: string; p_locale: string; p_window_days: number };
        Returns: {
          total_sales_minor: number;
          orders_count: number;
          customers_count: number;
          current_sales_minor: number;
          current_orders: number;
          current_customers: number;
          prior_sales_minor: number;
          prior_orders: number;
          prior_customers: number;
          sales_by_day: Record<string, number>;
          status_counts: Record<string, number>;
          top_products: { name: string; quantity: number; revenue_minor: number }[];
        };
      };
      tenant_analytics_stats: {
        Args: { p_tenant_id: string; p_locale: string; p_range_days: number };
        Returns: {
          current_sales_minor: number;
          current_orders: number;
          prior_sales_minor: number;
          prior_orders: number;
          current_ai_cost_usd: number;
          prior_ai_cost_usd: number;
          sales_by_day: Record<string, number>;
          status_counts: Record<string, number>;
          settled_orders: number;
          top_products: { name: string; quantity: number; revenue_minor: number }[];
          payment_methods: Record<string, number>;
          conversations_started: number;
          carts_started: number;
        };
      };
      tenant_customer_summary: {
        Args: { p_tenant_id: string; p_search: string | null; p_limit: number; p_offset: number };
        Returns: {
          customers: number;
          repeat_customers: number;
          total_spent_minor: number;
          filtered_count: number;
          rows: {
            key: string;
            name: string;
            email: string | null;
            phone: string | null;
            order_count: number;
            total_spent_minor: number;
            last_order_at: string;
          }[];
        };
      };
      tenant_coupon_discount_total: {
        Args: { p_tenant_id: string };
        Returns: number;
      };
      conversation_last_messages: {
        Args: { p_conversation_ids: string[] };
        Returns: { conversation_id: string; role: string; content: string; handled_by: string | null }[];
      };
      agent_interaction_totals_by_tenant: {
        Args: { p_since: string };
        Returns: { tenant_id: string; interactions: number; deterministic: number; cost_usd: number }[];
      };
      conversation_counts_by_tenant: {
        Args: { p_since: string; p_until: string | null };
        Returns: { tenant_id: string; conversations: number }[];
      };
      conversations_started_per_day: {
        Args: { p_since: string };
        Returns: { day: string; conversations: number }[];
      };
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
      validate_coupon: {
        Args: { p_tenant_id: string; p_code: string; p_subtotal_minor: number };
        Returns: {
          valid: boolean;
          message: string | null;
          coupon_id: string | null;
          discount_minor: number;
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
      change_business_currency: {
        Args: { p_tenant_id: string; p_currency: string; p_usd_rates: Json; p_rate_source: string; p_rates_as_of: string | null };
        Returns: Json;
      };
      order_fx_factor: {
        Args: { p_tenant_id: string; p_currency: string };
        Returns: number | null;
      };
      create_manual_orders: {
        Args: { p_tenant_id: string; p_orders: Json; p_created_via?: "manual" | "bulk_import" };
        Returns: { order_id: string; order_number: number }[];
      };
      create_payment_attempt: {
        Args: { p_order_id: string };
        Returns: {
          payment_id: string;
          provider: string;
          order_number: number;
          amount_minor: number;
          currency: string;
          reused: boolean;
        }[];
      };
      mark_cash_payment_collected: {
        Args: { p_payment_id: string };
        Returns: undefined;
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
      add_platform_admin: {
        Args: { p_email: string; p_level?: string };
        Returns: undefined;
      };
      remove_platform_admin: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
      start_tenant_impersonation: {
        Args: { p_tenant_id: string };
        Returns: undefined;
      };
      end_tenant_impersonation: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      tenant_payment_integration_status: {
        Args: Record<string, never>;
        Returns: { tenant_id: string; moyasar_connected: boolean; tap_connected: boolean; enabled_methods: string[] }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
