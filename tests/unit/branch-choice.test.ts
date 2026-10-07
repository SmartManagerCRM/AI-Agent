import { describe, expect, it } from "vitest";

import { orderErrorCode } from "@/lib/agent-errors";
import { matchBranch } from "@/lib/branch-match";

const open = [
  { id: "a", name: "Downtown", address: "1 Main St" },
  { id: "b", name: "Marina Walk", address: null },
];

describe("choosing a branch in chat", () => {
  it("finds the branch the customer named, exactly or in part, ignoring case", () => {
    expect(matchBranch(open, "downtown")?.id).toBe("a");
    expect(matchBranch(open, "Marina")?.id).toBe("b");
    expect(matchBranch(open, "Marina Walk branch")?.id).toBe("b");
  });

  it("names nothing it can't match — the Agent asks again", () => {
    expect(matchBranch(open, "Airport")).toBeNull();
    expect(matchBranch(open, "  ")).toBeNull();
  });
});

describe("placing an order without a branch", () => {
  it("asks the customer to choose the branch", () => {
    expect(orderErrorCode("VALIDATION_ERROR: choose the branch for this order")).toBe("chooseBranch");
  });
});
