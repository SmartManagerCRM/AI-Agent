import { describe, expect, it } from "vitest";

import { resolveConsolePath } from "@/lib/console-routing";

describe("resolveConsolePath", () => {
  it("treats the bare root as the marketing site", () => {
    expect(resolveConsolePath("")).toEqual({ kind: "site" });
  });

  it("rewrites /subscriber and its subpaths to the bare console entry", () => {
    expect(resolveConsolePath("/subscriber")).toEqual({ kind: "rewrite", internalPath: "" });
    expect(resolveConsolePath("/subscriber/billing")).toEqual({ kind: "rewrite", internalPath: "/billing" });
  });

  it("redirects the legacy /platform shape to canonical /super-admin", () => {
    expect(resolveConsolePath("/platform")).toEqual({ kind: "redirect", to: "/super-admin" });
    expect(resolveConsolePath("/platform/models")).toEqual({ kind: "redirect", to: "/super-admin/models" });
  });

  it("rewrites canonical /super-admin to the internal /platform route tree", () => {
    expect(resolveConsolePath("/super-admin")).toEqual({ kind: "rewrite", internalPath: "/platform" });
    expect(resolveConsolePath("/super-admin/models")).toEqual({ kind: "rewrite", internalPath: "/platform/models" });
  });

  it("redirects the legacy /t/{slug} shape to canonical /{slug}", () => {
    expect(resolveConsolePath("/t/roasters-cafe")).toEqual({ kind: "redirect", to: "/roasters-cafe" });
    expect(resolveConsolePath("/t/roasters-cafe/orders")).toEqual({ kind: "redirect", to: "/roasters-cafe/orders" });
  });

  it("rewrites a bare, non-reserved slug to the internal /t/{slug} route tree", () => {
    expect(resolveConsolePath("/roasters-cafe")).toEqual({ kind: "rewrite", internalPath: "/t/roasters-cafe" });
    expect(resolveConsolePath("/roasters-cafe/orders/123")).toEqual({
      kind: "rewrite",
      internalPath: "/t/roasters-cafe/orders/123",
    });
  });

  it("only treats an exact reserved word as reserved, not a slug that merely starts with one", () => {
    expect(resolveConsolePath("/login-cafe")).toEqual({ kind: "rewrite", internalPath: "/t/login-cafe" });
  });

  it("passes fixed console paths straight through unchanged", () => {
    expect(resolveConsolePath("/login")).toEqual({ kind: "rewrite", internalPath: "/login" });
    expect(resolveConsolePath("/onboarding")).toEqual({ kind: "rewrite", internalPath: "/onboarding" });
    expect(resolveConsolePath("/invite/abc123")).toEqual({ kind: "rewrite", internalPath: "/invite/abc123" });
  });

  it("never treats a locale code as a tenant slug (rest is always post-locale-strip, but a slug can't collide with one anyway)", () => {
    expect(resolveConsolePath("/ar")).toEqual({ kind: "site" });
    expect(resolveConsolePath("/fr/orders")).toEqual({ kind: "site" });
  });
});
