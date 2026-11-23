import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import type { SlashItem } from "../index";

import type { Kertas } from "./engine";
import { eventHref, kertasTarget, meetingLabel, whenLabel, type PlanMeeting, type PlannedMeeting } from "./kertasLinks";
import type { Lang } from "./types";

export interface MeetingLabels {
  plan: (text: string) => string;
}

export const defaultMeetingLabels: MeetingLabels = {
  plan: (text) => `Planifier « ${text} »`,
};

export function insertMeeting(editor: Editor, at: number, meeting: PlannedMeeting, lang: Lang) {
  editor
    .chain()
    .focus()
    .insertContentAt(at, [
      { type: "text", text: meetingLabel(meeting, lang), marks: [{ type: "link", attrs: { href: eventHref(meeting) } }] },
      { type: "text", text: " " },
    ])
    .run();
}

/**
 * For `@`: when the typed words read as a meeting ("réunion Marc jeudi 14h",
 * "rdv dentiste demain"), an item that keeps it in the calendar and cites it
 * here. The words are read on the machine; only the chosen item calls plan.
 */
export function meetingItems(engine: Kertas, plan: PlanMeeting, labels: MeetingLabels = defaultMeetingLabels): (query: string) => SlashItem[] {
  return (query = "") => {
    const text = query.trim();
    if (!text) return [];
    const moment = engine.understand(text);
    const meeting = (moment.kind === "appointment" && moment.kind_found) || moment.has_time;
    if (!meeting || !moment.day_found) return [];
    const hour = moment.has_time ? `T${String(moment.hour).padStart(2, "0")}:${String(moment.minute).padStart(2, "0")}` : "";
    return [
      {
        id: `meeting-${text}`,
        title: labels.plan(text),
        description: whenLabel(`${moment.day}${hour}`, engine.language, moment.has_time),
        command: ({ editor, range }) => {
          editor.chain().focus().insertContentAt(range, text).run();
          let from = range.from;
          let to = range.from + text.length;
          const follow = ({ transaction }: { transaction: Transaction }) => {
            from = transaction.mapping.map(from, 1);
            to = transaction.mapping.map(to, -1);
          };
          editor.on("transaction", follow);
          void plan(text)
            .catch(() => null)
            .then((planned) => {
              editor.off("transaction", follow);
              if (!planned || editor.isDestroyed) return;
              const untouched = to - from === text.length && editor.state.doc.textBetween(from, to) === text;
              if (untouched) editor.chain().deleteRange({ from, to }).run();
              insertMeeting(editor, untouched ? from : to, planned, engine.language);
            });
        },
      },
    ];
  };
}

export interface MeetingLinksOptions {
  openEvent: (id: string, at: string) => void;
  openPage?: (id: string) => void;
}

/** A click on a `kertas:` link opens the meeting or the page in the app instead of leaving it. */
export const MeetingLinks = Extension.create<MeetingLinksOptions>({
  name: "kertasMeetingLinks",

  addOptions() {
    return { openEvent: () => {} };
  },

  addProseMirrorPlugins() {
    const { openEvent, openPage } = this.options;
    return [
      new Plugin({
        key: new PluginKey("kertasMeetingLinks"),
        props: {
          handleClick(_view, _pos, event) {
            const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
            const target = kertasTarget(anchor?.getAttribute("href"));
            if (!target) return false;
            event.preventDefault();
            if (target.kind === "event") openEvent(target.id, target.at);
            else if (openPage) openPage(target.id);
            else return false;
            return true;
          },
        },
      }),
    ];
  },
});
