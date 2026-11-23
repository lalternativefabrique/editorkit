import type { Lang } from "./types";

export const PAGE_LINK = "kertas:page/";
export const EVENT_LINK = "kertas:event/";

export interface PlannedMeeting {
  id: string;
  title: string;
  start: string;
}

/** Keeps the meeting a typed line describes in the calendar, or null when it could not. */
export type PlanMeeting = (text: string) => Promise<PlannedMeeting | null>;

export type KertasTarget = { kind: "page"; id: string } | { kind: "event"; id: string; at: string };

/** The wall-clock start ("2026-11-14T14:00") is enough to open the right day, whatever the zone. */
export function eventHref(meeting: PlannedMeeting): string {
  return `${EVENT_LINK}${encodeURIComponent(meeting.id)}?at=${meeting.start.slice(0, 16)}`;
}

export function pageHref(id: string): string {
  return `${PAGE_LINK}${encodeURIComponent(id)}`;
}

export function kertasTarget(href: string | null | undefined): KertasTarget | null {
  if (!href) return null;
  if (href.startsWith(PAGE_LINK)) {
    const id = decodeURIComponent(href.slice(PAGE_LINK.length).split(/[?#]/)[0]);
    return id ? { kind: "page", id } : null;
  }
  if (href.startsWith(EVENT_LINK)) {
    const [path, query = ""] = href.slice(EVENT_LINK.length).split("?");
    const id = decodeURIComponent(path.split("#")[0]);
    const at = new URLSearchParams(query).get("at") ?? "";
    return id ? { kind: "event", id, at } : null;
  }
  return null;
}

function locale(lang: Lang) {
  return lang === "en" ? "en-GB" : "fr-FR";
}

/** "jeudi 14 novembre, 14:00", the year only when it is not this one. */
export function whenLabel(start: string, lang: Lang, timed = true, today = new Date()): string {
  const [day, time = ""] = start.slice(0, 16).split("T");
  const [year, month, date] = day.split("-").map(Number);
  const options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" };
  if (year !== today.getFullYear()) options.year = "numeric";
  const days = new Intl.DateTimeFormat(locale(lang), options).format(new Date(year, month - 1, date));
  return timed && time ? `${days}, ${time}` : days;
}

export function meetingLabel(meeting: PlannedMeeting, lang: Lang): string {
  return `${meeting.title} · ${whenLabel(meeting.start, lang)}`;
}

/** A Markdown link whose label cannot close it early. */
export function markdownLink(label: string, href: string): string {
  return `[${label.replace(/([\\[\]])/g, "\\$1")}](${href})`;
}
