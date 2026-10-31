# Languages

`lang` sets the page language and picks the player's labels. `"fr-CA"` falls back to `fr`, an unknown language to `en`.

```tsx
<Article
  lang="de"
  audioLabels={{
    region: "Audioversion dieses Artikels",
    listen: "Diesen Artikel anhören",
    play: "Anhören",
    pause: "Pause",
    progress: "Position in der Wiedergabe",
    reading: "wird gelesen…",
  }}
  translations={[
    { lang: "fr", label: "Français", href: "/fr/article" },
    { lang: "en", label: "English", href: "/en/article" },
  ]}
  html={html}
/>
```
