import { describe, expect, it } from "vitest";

import { resolveConsolePath } from "@/lib/console-routing";
import { agentBaseUrl, agentSubpath } from "@/lib/hosts";
import { RESERVED_SLUGS } from "@/lib/reserved-slugs";
import { isWidgetPath } from "@/proxy";

const prod = {
  rootDomain: "ai-agent.smartmanager.me",
  consoleSubdomain: "app",
  agentSubdomain: "agent",
  scheme: "https" as const,
};

describe("public Agent URL", () => {
  it("is path-based on the platform host by default — never an unconfigured subdomain", () => {
    const base = agentBaseUrl(prod);
    expect(base).toBe("https://ai-agent.smartmanager.me/agent");
    expect(`${base}/smartmanager`).toBe("https://ai-agent.smartmanager.me/agent/smartmanager");
    expect(base).not.toContain("agent.ai-agent.smartmanager.me");
  });

  it("uses a dedicated Agent domain only when AGENT_URL is configured", () => {
    expect(agentBaseUrl({ ...prod, agentUrl: "https://agent.smartmanager.me/" })).toBe("https://agent.smartmanager.me");
  });

  it("keeps a local dev port", () => {
    expect(agentBaseUrl({ ...prod, rootDomain: "localhost", scheme: "http", port: "3100" })).toBe("http://localhost:3100/agent");
  });
});

describe("Agent path routing on the platform host", () => {
  it("recognizes /agent paths only", () => {
    expect(agentSubpath("/agent/smartmanager")).toBe("/smartmanager");
    expect(agentSubpath("/agent/pay/123")).toBe("/pay/123");
    expect(agentSubpath("/agent/widget/khayal")).toBe("/widget/khayal");
    expect(agentSubpath("/agent")).toBe("");
    expect(agentSubpath("/agents")).toBeNull();
    expect(agentSubpath("/smartmanager")).toBeNull();
  });

  it("reserves 'agent' so no business console path can shadow the Agent route", () => {
    expect(RESERVED_SLUGS.has("agent")).toBe(true);
    expect(resolveConsolePath("/agent")).toEqual({ kind: "site" });
  });

  it("allows framing only for the widget page, on either URL shape", () => {
    expect(isWidgetPath("/widget/khayal")).toBe(true);
    expect(isWidgetPath("/agent/widget/khayal")).toBe(true);
    expect(isWidgetPath("/ar/agent/widget/khayal")).toBe(true);
    expect(isWidgetPath("/agent/khayal")).toBe(false);
    expect(isWidgetPath("/en/khayal/agent")).toBe(false);
  });
});
