import { describe, expect, it } from "vitest";

import { isGluedDuplicate } from "@/server/catalog/brain-drafts";

const found = [
  { name: "Cappuccino", priceKey: "15 SAR" },
  { name: "Classic Cheeseburger", priceKey: "32 SAR" },
  { name: "Cake", priceKey: "19 SAR" },
];

describe("Business Brain → catalog: glued menu text", () => {
  it("drops a finding that is a cleaner one glued to its section, description and button", () => {
    expect(isGluedDuplicate("Drinks CappuccinoEspresso with steamed milk and foam Add", "15 SAR", found)).toBe(true);
    expect(
      isGluedDuplicate("Main Courses Classic CheeseburgerBeef patty, cheddar, lettuce, tomato and house sauce Add", "32 SAR", found),
    ).toBe(true);
  });

  it("keeps real, different products", () => {
    // Same price, but "Cake" is a word of the name, not glued text.
    expect(isGluedDuplicate("Chocolate Cake", "19 SAR", found)).toBe(false);
    // Glued, but a different price: not the same item.
    expect(isGluedDuplicate("Drinks CappuccinoLarge", "18 SAR", found)).toBe(false);
    // The clean finding itself.
    expect(isGluedDuplicate("Cappuccino", "15 SAR", found)).toBe(false);
  });
});
