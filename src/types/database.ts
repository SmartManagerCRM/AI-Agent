/**
 * Hand-written for Phase 1. Regenerate with `npm run db:types` once the
 * Supabase CLI can reach this project (local stack or a linked remote), and
 * this file becomes fully generated like the rest of the schema will be.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type LocalizedText = Record<string, string>;

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
          kind: "website" | "manual";
          url: string | null;
          status: "pending" | "crawling" | "completed" | "failed" | "disabled";
          pages_crawled: number;
          error_message: string | null;
          is_active: boolean;
          last_crawled_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["business_sources"]["Row"]> & { tenant_id: string; kind: string };
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
          source: "admin" | "website";
          source_id: string | null;
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
          p_source: "admin" | "website";
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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
