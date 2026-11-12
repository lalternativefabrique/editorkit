import { describe, expect, it } from "vitest";

import { placeMenu } from "./SlashCommands";

const viewport = { width: 1000, height: 800 };
const menu = { width: 320, height: 600 };

describe("placing the slash menu", () => {
  it("opens below the caret, no taller than the cap, and scrolls inside", () => {
    expect(placeMenu({ top: 80, bottom: 100, left: 40 }, menu, viewport)).toEqual({
      top: 106,
      left: 40,
      maxHeight: 320,
    });
  });

  it("grows to a custom cap", () => {
    expect(placeMenu({ top: 80, bottom: 100, left: 40 }, menu, viewport, 500).maxHeight).toBe(500);
  });

  it("opens above a caret low on the page, right on top of it", () => {
    const placed = placeMenu({ top: 700, bottom: 720, left: 40 }, menu, viewport);
    expect(placed).toEqual({ top: 374, left: 40, maxHeight: 320 });
    expect(placed.top + placed.maxHeight).toBe(694);
  });

  it("opens above with a short list hugging the caret", () => {
    const placed = placeMenu(
      { top: 700, bottom: 720, left: 40 },
      { width: 320, height: 120 },
      viewport,
    );
    expect(placed.top).toBe(574);
  });

  it("stays below, shorter, when below has more room than above", () => {
    expect(
      placeMenu({ top: 260, bottom: 280, left: 40 }, menu, {
        width: 1000,
        height: 560,
      }),
    ).toEqual({
      top: 286,
      left: 40,
      maxHeight: 266,
    });
  });

  it("keeps the menu inside the right edge", () => {
    expect(placeMenu({ top: 80, bottom: 100, left: 900 }, menu, viewport).left).toBe(672);
  });
});
