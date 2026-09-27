import { describe, expect, it } from "vitest";

import { assertSafeCrawlTarget, parseCrawlUrl, UnsafeCrawlTargetError } from "@/server/brain/url-safety";

describe("parseCrawlUrl", () => {
  it("accepts a plain http(s) URL", () => {
    expect(parseCrawlUrl("https://example.com/menu").hostname).toBe("example.com");
  });

  it("rejects a non-http(s) scheme", () => {
    expect(() => parseCrawlUrl("file:///etc/passwd")).toThrow(UnsafeCrawlTargetError);
  });

  it("rejects an unparsable URL", () => {
    expect(() => parseCrawlUrl("not a url")).toThrow(UnsafeCrawlTargetError);
  });

  it("rejects embedded credentials", () => {
    expect(() => parseCrawlUrl("https://user:pass@example.com")).toThrow(UnsafeCrawlTargetError);
  });
});

describe("assertSafeCrawlTarget", () => {
  it("rejects loopback and private IP literals without needing DNS", async () => {
    await expect(assertSafeCrawlTarget(parseCrawlUrl("http://127.0.0.1/"))).rejects.toThrow(UnsafeCrawlTargetError);
    await expect(assertSafeCrawlTarget(parseCrawlUrl("http://10.0.0.5/"))).rejects.toThrow(UnsafeCrawlTargetError);
    await expect(assertSafeCrawlTarget(parseCrawlUrl("http://169.254.169.254/"))).rejects.toThrow(
      UnsafeCrawlTargetError,
    );
    await expect(assertSafeCrawlTarget(parseCrawlUrl("http://192.168.1.1/"))).rejects.toThrow(UnsafeCrawlTargetError);
  });

  it("rejects localhost and .local/.internal hostnames outright", async () => {
    await expect(assertSafeCrawlTarget(parseCrawlUrl("http://localhost/"))).rejects.toThrow(UnsafeCrawlTargetError);
    await expect(assertSafeCrawlTarget(parseCrawlUrl("http://printer.local/"))).rejects.toThrow(
      UnsafeCrawlTargetError,
    );
  });
});
