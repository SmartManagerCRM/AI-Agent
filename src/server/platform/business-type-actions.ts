"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

const keySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(40)
  .regex(/^[a-z][a-z0-9_-]*$/, "lowercase letters, numbers, - or _, starting with a letter");

const createSchema = z.object({ key: keySchema, name: z.string().trim().min(1).max(80), locale: z.string() });

export async function createBusinessTypeAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = createSchema.safeParse({
    key: formData.get("key"),
    name: formData.get("name"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  const { error } = await supabase
    .from("business_types")
    .insert({ key: parsed.data.key, name: { [parsed.data.locale]: parsed.data.name }, is_active: true });
  if (error) {
    return error.code === "23505"
      ? "VALIDATION_ERROR: a business type with that key already exists."
      : "VALIDATION_ERROR: could not create that business type — please try again.";
  }

  revalidatePath(`/${parsed.data.locale}/super-admin/settings`);
}

const setActiveSchema = z.object({ key: z.string(), value: z.enum(["true", "false"]), locale: z.string() });

export async function setBusinessTypeActiveAction(formData: FormData): Promise<void> {
  const parsed = setActiveSchema.safeParse({
    key: formData.get("key"),
    value: formData.get("value"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  await supabase
    .from("business_types")
    .update({ is_active: parsed.data.value === "true" })
    .eq("key", parsed.data.key);
  revalidatePath(`/${parsed.data.locale}/super-admin/settings`);
}
