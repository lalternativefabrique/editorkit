import { evaluate } from "@mdx-js/mdx";
import type { AnchorHTMLAttributes, ComponentType, ImgHTMLAttributes } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as runtime from "react/jsx-runtime";
import remarkGfm from "remark-gfm";

const SAFE_URL = /^(?:https?:|mailto:|tel:|\/(?!\/)|#|\.{1,2}\/)/i;

export function safeUrl(url: string | undefined): string | undefined {
  const compact = url?.replace(/[\u0000- ]/g, "");
  return compact && SAFE_URL.test(compact) ? url : undefined;
}

const safeComponents = {
  a: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", { ...props, href: safeUrl(href) }),
  img: ({ src, alt = "", ...props }: ImgHTMLAttributes<HTMLImageElement>) =>
    createElement("img", { ...props, src: safeUrl(typeof src === "string" ? src : undefined), alt, loading: "lazy", decoding: "async" }),
};

export interface ArticleRenderOptions {
  /** "mdx" runs code from the text: only for sources the operator wrote, never for text from a person. */
  format?: "md" | "mdx";
  components?: Record<string, ComponentType<never>>;
}

export async function renderArticleHtml(source: string, { format = "md", components }: ArticleRenderOptions = {}): Promise<string> {
  const { default: Content } = await evaluate(source, { ...runtime, format, remarkPlugins: [remarkGfm] });
  return renderToStaticMarkup(createElement(Content, { components: { ...safeComponents, ...components } as never }));
}
