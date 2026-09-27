import { describe, expect, it } from "vitest";

import { isPathAllowed, parseRobotsTxt } from "@/server/brain/robots";

describe("parseRobotsTxt", () => {
  it("collects Disallow/Allow rules for the wildcard user-agent", () => {
    const rules = parseRobotsTxt(
      ["User-agent: *", "Disallow: /admin", "Disallow: /cart", "Allow: /cart/public", "Crawl-delay: 2"].join("\n"),
    );
    expect(rules.disallow).toEqual(["/admin", "/cart"]);
    expect(rules.allow).toEqual(["/cart/public"]);
    expect(rules.crawlDelaySeconds).toBe(2);
  });

  it("ignores rules scoped to a named bot that is not us", () => {
    const rules = parseRobotsTxt(["User-agent: Googlebot", "Disallow: /"].join("\n"));
    expect(rules.disallow).toEqual([]);
  });

  it("treats a rule with no preceding User-agent as applying to everyone", () => {
    const rules = parseRobotsTxt("Disallow: /secret");
    expect(rules.disallow).toEqual(["/secret"]);
  });

  it("ignores comments and blank lines", () => {
    const rules = parseRobotsTxt(["# a comment", "", "User-agent: *", "Disallow: /x # trailing comment"].join("\n"));
    expect(rules.disallow).toEqual(["/x"]);
  });
});

describe("isPathAllowed", () => {
  it("allows everything when there are no rules", () => {
    expect(isPathAllowed({ disallow: [], allow: [], crawlDelaySeconds: null }, "/anything")).toBe(true);
  });

  it("disallows a path matching a Disallow prefix", () => {
    expect(isPathAllowed({ disallow: ["/admin"], allow: [], crawlDelaySeconds: null }, "/admin/users")).toBe(false);
  });

  it("lets a longer, more specific Allow override a shorter Disallow", () => {
    const rules = { disallow: ["/cart"], allow: ["/cart/public"], crawlDelaySeconds: null };
    expect(isPathAllowed(rules, "/cart/public/item")).toBe(true);
    expect(isPathAllowed(rules, "/cart/checkout")).toBe(false);
  });
});
