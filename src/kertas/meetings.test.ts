import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { kertasFrom } from "./engine";
import { eventHref, kertasTarget, markdownLink, meetingLabel, pageHref, whenLabel } from "./kertasLinks";
import { meetingItems } from "./meetings";

const meeting = { id: "e 1", title: "Réunion Marc", start: "2026-11-12T14:00:00+01:00" };
const today = new Date(2026, 10, 11);

describe("meeting links", () => {
  it("writes a meeting as a kertas link with its wall-clock start, and reads it back", () => {
    const href = eventHref(meeting);
    expect(href).toBe("kertas:event/e%201?at=2026-11-12T14:00");
    expect(kertasTarget(href)).toEqual({ kind: "event", id: "e 1", at: "2026-11-12T14:00" });
    expect(kertasTarget(pageHref("p-2"))).toEqual({ kind: "page", id: "p-2" });
    expect(kertasTarget("https://example.com/kertas:event/x")).toBeNull();
    expect(kertasTarget("kertas:event/?at=2026-11-12")).toBeNull();
    expect(markdownLink("Plan [v2]", "kertas:page/p")).toBe("[Plan \\[v2\\]](kertas:page/p)");
  });

  it("names when a meeting is, the year only when it is not this one", () => {
    expect(whenLabel(meeting.start, "fr", true, today)).toBe("jeudi 12 novembre, 14:00");
    expect(whenLabel("2027-01-04", "fr", false, today)).toBe("lundi 4 janvier 2027");
    expect(meetingLabel(meeting, "fr")).toMatch(/^Réunion Marc · jeudi 12 novembre/);
  });
});

const wasm = fileURLToPath(new URL("../../kertas/dist/kertas.wasm", import.meta.url));

describe.skipIf(!existsSync(wasm))("meetings from @", async () => {
  const module = await WebAssembly.instantiate(readFileSync(wasm), {});
  const kertas = kertasFrom(module.instance, () => today);
  const items = meetingItems(kertas, async () => null);

  it("offers to plan a line that reads as a meeting, with the day it understood", () => {
    const [item] = items("Dentiste jeudi 16h");
    expect(item.title).toBe("Planifier « Dentiste jeudi 16h »");
    expect(item.description).toBe("jeudi 12 novembre, 16:00");
  });

  it("offers nothing for words that are not a meeting, nor for nothing", () => {
    expect(items("Hypothèses")).toEqual([]);
    expect(items("")).toEqual([]);
  });

  it("counts a cited meeting among the note's links, and keeps it through Markdown", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: meetingLabel(meeting, "fr"), marks: [{ type: "link", attrs: { href: eventHref(meeting) } }] }] }],
    };
    expect(kertas.links(doc)).toEqual([{ kind: "event", target: "e 1" }]);
    const markdown = kertas.toMarkdown(doc);
    expect(kertas.links(kertas.fromMarkdown(markdown))).toEqual([{ kind: "event", target: "e 1" }]);
  });
});
