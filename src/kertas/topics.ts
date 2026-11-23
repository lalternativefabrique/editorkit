import type { SlashItem } from "../index";

import type { Kertas } from "./engine";
import type { FindTopic } from "./types";

const TOPICS_SHOWN = 5;
const PAGES_SHOWN = 3;

export interface TopicLabels {
  holds: (topic: FindTopic) => string;
  kept: string;
  page: (typed: string) => string;
}

const counted = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`);

export const defaultTopicLabels: TopicLabels = {
  holds: ({ notes, sources }) =>
    [notes ? counted(notes, "note", "notes") : "", sources ? `${sources} en littérature` : ""].filter(Boolean).join(" · "),
  kept: "Littérature",
  page: (typed) => `Déjà dans ta littérature sur « ${typed} »`,
};

/** A topic's name as one `#word`: what is neither a letter nor a digit becomes a dash. */
export function hashtagOf(name: string): string {
  return name
    .trim()
    .replace(/[^\p{L}\p{N}_]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * For `#`: the topics that start like the typed word, each with what the
 * person already holds on it, then the pages of their literature that speak
 * of it. Both are read from the index on the machine.
 */
export function topicItems(engine: Kertas, labels: TopicLabels = defaultTopicLabels): (query: string) => SlashItem[] {
  return (query = "") => {
    const typed = query.trim();
    if (!typed) return [];
    let topics: FindTopic[];
    let pages: ReturnType<Kertas["find"]>;
    try {
      topics = engine.topics(typed, TOPICS_SHOWN);
      pages = engine.find(typed, ["source"], PAGES_SHOWN);
    } catch {
      return [];
    }
    return [
      ...topics.map((topic): SlashItem => {
        const tag = hashtagOf(topic.name);
        return {
          id: `topic-${tag}`,
          title: `#${tag}`,
          shortcut: labels.holds(topic),
          command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).insertContentAt(range.from, `#${tag} `).run();
          },
        };
      }),
      ...pages
        .filter((page) => page.url)
        .map(
          (page): SlashItem => ({
            id: `topic-page-${page.id}`,
            title: page.title,
            description: labels.page(typed),
            shortcut: labels.kept,
            command: ({ editor, range }) => {
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertContentAt(range.from, [
                  { type: "text", text: page.title, marks: [{ type: "link", attrs: { href: page.url } }] },
                  { type: "text", text: " " },
                ])
                .run();
            },
          }),
        ),
    ];
  };
}
