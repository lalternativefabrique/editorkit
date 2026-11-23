import { useEffect, useState } from "react";

import { serveKertasAssetsFrom } from "./assets";
import { loadKertas, type Kertas } from "./engine";
import type { Lang } from "./types";

const LANGS: Lang[] = ["fr", "en"];

async function text(url: URL): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.pathname}: ${response.status}`);
  return response.text();
}

async function withDictionaries(engine: Kertas, base: string): Promise<Kertas> {
  await Promise.all(
    LANGS.map(async (lang) => {
      try {
        const [aff, dic] = await Promise.all([
          text(new URL(`dictionary-${lang}.aff`, base)),
          text(new URL(`dictionary-${lang}.dic`, base)),
        ]);
        engine.loadDictionary(lang, aff, dic);
      } catch {
        return;
      }
    }),
  );
  return engine;
}

const loading = new Map<string, Promise<Kertas | null>>();

function load(base: string): Promise<Kertas | null> {
  serveKertasAssetsFrom(base);
  let engine = loading.get(base);
  if (!engine) {
    engine = loadKertas(new URL("kertas.wasm", base))
      .then((loaded) => withDictionaries(loaded, base))
      .catch((error: unknown) => {
        console.warn("kertas is not available, structured notes open read only", error);
        return null;
      });
    loading.set(base, engine);
  }
  return engine;
}

/**
 * The kertas engine served with kertas.wasm and the dictionaries under base,
 * resolved against the page: undefined while it loads, null if it cannot.
 */
export function useKertas(base?: string): Kertas | null | undefined {
  const [engine, setEngine] = useState<Kertas | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void load(new URL(base ?? ".", document.baseURI).href).then((loaded) => {
      if (live) setEngine(loaded);
    });
    return () => {
      live = false;
    };
  }, [base]);

  return engine;
}
