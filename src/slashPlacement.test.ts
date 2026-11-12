import { describe, expect, it } from "vitest";

import { placeMenu } from "./SlashCommands";

const viewport = { width: 1000, height: 800 };
const menu = { width: 320, height: 600 };

describe("placing the slash menu", () => {
  it("opens below the caret when the menu fits there", () => {
    expect(placeMenu({ top: 80, bottom: 100, left: 40 }, menu, viewport)).toEqual({
      top: 106,
      left: 40,
      maxHeight: 686,
    });
  });

  it("opens above a caret low on the page, no taller than the room there", () => {
    const placed = placeMenu({ top: 700, bottom: 720, left: 40 }, menu, viewport);
    expect(placed).toEqual({ top: 94, left: 40, maxHeight: 686 });
    expect(placed.top + menu.height).toBeLessThanOrEqual(700);
  });

  it("stays below and scrolls when below has more room than above", () => {
    expect(placeMenu({ top: 300, bottom: 320, left: 40 }, menu, viewport)).toEqual({
      top: 326,
      left: 40,
      maxHeight: 466,
    });
  });

  it("keeps the menu inside the right edge", () => {
    expect(placeMenu({ top: 80, bottom: 100, left: 900 }, menu, viewport).left).toBe(672);
  });
});
