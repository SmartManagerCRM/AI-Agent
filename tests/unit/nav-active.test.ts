import { describe, expect, it } from "vitest";

import { activeNavHref } from "@/lib/nav-active";

const tenant = ["/en/cafe", "/en/cafe/orders", "/en/cafe/products", "/en/cafe/settings"];
const platform = ["/en/super-admin", "/en/super-admin/usage", "/en/super-admin/businesses"];

describe("sidebar: only the current page is selected", () => {
  it("Dashboard only on the dashboard itself", () => {
    expect(activeNavHref("/en/cafe", tenant)).toBe("/en/cafe");
    expect(activeNavHref("/en/cafe/", tenant)).toBe("/en/cafe");
  });
  it("a page selects its own link, not Dashboard as well", () => {
    expect(activeNavHref("/en/cafe/orders", tenant)).toBe("/en/cafe/orders");
    expect(activeNavHref("/en/super-admin/usage", platform)).toBe("/en/super-admin/usage");
  });
  it("a sub-page keeps its section selected", () => {
    expect(activeNavHref("/en/cafe/products/123/edit", tenant)).toBe("/en/cafe/products");
    expect(activeNavHref("/en/super-admin/businesses/cafe", platform)).toBe("/en/super-admin/businesses");
  });
  it("no partial-word matches and nothing when no link fits", () => {
    expect(activeNavHref("/en/cafe/orders-archive", tenant)).toBe("/en/cafe");
    expect(activeNavHref("/fr/cafe/orders", tenant)).toBeNull();
    expect(activeNavHref(null, tenant)).toBeNull();
  });
});
