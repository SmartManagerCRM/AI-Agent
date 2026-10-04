import { describe, expect, it } from "vitest";

import { isSelfRequest } from "@/server/runtime/self-fetch";

describe("requests to the app's own internal address", () => {
  const self = "http://0.0.0.0:3000";
  it("are recognised, whatever form the URL takes", () => {
    expect(isSelfRequest("http://0.0.0.0:3000/en/acme/billing?_rsc=1", self)).toBe(true);
    expect(isSelfRequest(new URL("http://0.0.0.0:3000/en/acme/billing"), self)).toBe(true);
    expect(isSelfRequest(new Request("http://0.0.0.0:3000/"), self)).toBe(true);
  });
  it("leave every other request alone", () => {
    expect(isSelfRequest("https://api.resend.com/emails", self)).toBe(false);
    expect(isSelfRequest("http://0.0.0.0:3001/", self)).toBe(false);
    expect(isSelfRequest("https://ai-agent.smartmanager.me/en/acme/billing", self)).toBe(false);
    expect(isSelfRequest("/relative", self)).toBe(false);
  });
  it("do nothing when Next.js has no internal address", () => {
    expect(isSelfRequest("http://0.0.0.0:3000/", undefined)).toBe(false);
  });
});
