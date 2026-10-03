import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

// Rendered outside a request: the labels come from a stub translator (the links are what is checked here).
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import { Pagination, parsePage } from "@/components/console/pagination";

type Props = { href?: string; children?: unknown };

/** Collects every `href` in a rendered element tree (the Previous/Next links). */
function hrefs(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(hrefs);
  const props = (node as ReactElement<Props>).props ?? {};
  return [...(props.href ? [props.href] : []), ...hrefs(props.children)];
}

describe("parsePage", () => {
  it("defaults to page 1 for missing or invalid input", () => {
    for (const value of [undefined, "", "0", "-3", "1.5", "abc"]) expect(parsePage(value)).toBe(1);
  });

  it("accepts positive integers", () => {
    expect(parsePage("1")).toBe(1);
    expect(parsePage("7")).toBe(7);
  });
});

describe("Pagination", () => {
  const base = { basePath: "/en/acme/customers", pageSize: 50 };

  it("renders nothing when every row fits on the first page", () => {
    expect(Pagination({ ...base, params: {}, page: 1, total: 0 })).toBeNull();
    expect(Pagination({ ...base, params: {}, page: 1, total: 50 })).toBeNull();
  });

  it("links to the next page and keeps other query params", () => {
    const links = hrefs(Pagination({ ...base, params: { q: "bob", page: "1" }, page: 1, total: 120 }));
    expect(links).toEqual(["/en/acme/customers?q=bob&page=2"]);
  });

  it("links both ways in the middle, and page 1 drops the page param", () => {
    const links = hrefs(Pagination({ ...base, params: { q: "bob" }, page: 2, total: 120 }));
    expect(links).toEqual(["/en/acme/customers?q=bob", "/en/acme/customers?q=bob&page=3"]);
  });

  it("only links back from the last page", () => {
    const links = hrefs(Pagination({ ...base, params: {}, page: 3, total: 120 }));
    expect(links).toEqual(["/en/acme/customers?page=2"]);
  });

  it("sends a stale past-the-end page back to the last real page", () => {
    expect(hrefs(Pagination({ ...base, params: {}, page: 9, total: 10 }))).toEqual(["/en/acme/customers"]);
    expect(hrefs(Pagination({ ...base, params: {}, page: 9, total: 120 }))).toEqual(["/en/acme/customers?page=3"]);
  });
});
