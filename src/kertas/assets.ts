let base: string | null = null;

export function serveKertasAssetsFrom(url: string) {
  base = url;
}

export const kertasAsset = (name: string) => new URL(name, base ?? new URL("kertas/", document.baseURI)).href;
