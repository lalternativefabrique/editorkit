import { Extension } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionOptions, type SuggestionProps } from "@tiptap/suggestion";

import { SlashMenu, type SlashMenuHandle, type SlashMenuProps } from "./SlashMenu";
import { filterSlashItems, type SlashItem } from "./slash";

export interface SlashCommandsOptions {
  /** Read on every keystroke with the text typed after the trigger, so a host
   *  can swap the set, or offer to act on that text, without remounting
   *  TipTap — rebuilding the extensions array wipes the text being typed. */
  items: (query: string) => SlashItem[];
  char: string;
  /** Lets the typed text hold spaces, for triggers that name something, such as a page title. */
  allowSpaces?: boolean;
  /** Shown when nothing matches; an empty string shows nothing. */
  emptyLabel?: string;
  /** Tallest the menu grows before it scrolls, in pixels. */
  maxHeight?: number;
  /** Distinguishes concurrently mounted editors: two surfaces sharing one key
   *  would answer each other's suggestions. */
  pluginKey: PluginKey;
}

const OFFSET = 6;
const MARGIN = 8;
const MAX_HEIGHT = 320;

export interface MenuPlacement {
  top: number;
  left: number;
  maxHeight: number;
}

/** Below the caret when the menu fits there, else on whichever side has more room, never taller than `cap`. */
export function placeMenu(
  caret: { top: number; bottom: number; left: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  cap = MAX_HEIGHT,
): MenuPlacement {
  const below = viewport.height - caret.bottom - OFFSET - MARGIN;
  const above = caret.top - OFFSET - MARGIN;
  const wanted = Math.min(menu.height, cap);
  const left = Math.max(MARGIN, Math.min(caret.left, viewport.width - menu.width - MARGIN));
  if (wanted <= below || below >= above) {
    return {
      top: caret.bottom + OFFSET,
      left,
      maxHeight: Math.max(Math.min(below, cap), 0),
    };
  }
  const height = Math.min(wanted, above);
  return { top: caret.top - OFFSET - height, left, maxHeight: height };
}

export const SlashCommands = Extension.create<SlashCommandsOptions>({
  name: "laSlashCommands",

  addOptions() {
    return {
      items: () => [],
      char: "/",
      pluginKey: new PluginKey("laSlashCommands"),
    };
  },

  addProseMirrorPlugins() {
    const {
      items,
      char,
      allowSpaces = false,
      emptyLabel,
      maxHeight: cap = MAX_HEIGHT,
      pluginKey,
    } = this.options;

    const suggestion: Omit<SuggestionOptions<SlashItem>, "editor"> = {
      char,
      pluginKey,
      allowSpaces,
      startOfLine: false,
      items: ({ query }) => filterSlashItems(items(query), query),
      render: () => {
        let component: ReactRenderer<SlashMenuHandle, SlashMenuProps> | null = null;
        let container: HTMLDivElement | null = null;

        const place = (clientRect: SuggestionProps<SlashItem>["clientRect"]) => {
          if (!container || !clientRect) return;
          const rect = clientRect();
          const menu = container.querySelector<HTMLElement>(".lalt-slash");
          if (!rect || !menu) return;
          menu.style.maxHeight = "";
          const { top, left, maxHeight } = placeMenu(
            rect,
            { width: container.offsetWidth, height: menu.scrollHeight },
            { width: window.innerWidth, height: window.innerHeight },
            cap,
          );
          menu.style.maxHeight = `${maxHeight}px`;
          container.style.top = `${top}px`;
          container.style.left = `${left}px`;
        };
        // React renders the menu after onStart and onUpdate return, so its
        // size is only known on the next frame.
        const placeSoon = (clientRect: SuggestionProps<SlashItem>["clientRect"]) => {
          place(clientRect);
          requestAnimationFrame(() => place(clientRect));
        };

        const close = () => {
          container?.remove();
          container = null;
          component?.destroy();
          component = null;
        };

        return {
          onStart: (props) => {
            component = new ReactRenderer(SlashMenu, {
              props: { ...props, emptyLabel },
              editor: props.editor,
            });
            container = document.createElement("div");
            container.className = "lalt-slash-anchor";
            container.appendChild(component.element);
            document.body.appendChild(container);
            placeSoon(props.clientRect);
          },
          onUpdate: (props) => {
            component?.updateProps({ ...props, emptyLabel });
            placeSoon(props.clientRect);
          },
          onKeyDown: (props) => {
            if (props.event.key === "Escape") {
              close();
              return true;
            }
            return component?.ref?.onKeyDown(props) ?? false;
          },
          onExit: close,
        };
      },
    };

    return [
      Suggestion({
        editor: this.editor,
        ...suggestion,
        command: ({ editor, range, props }) => props.command({ editor, range }),
      }),
    ];
  },
});
