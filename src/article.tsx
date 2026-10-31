export function ArticleProse({ html, className }: { html: string; className?: string }) {
  return <div className={className ? `lalt-article ${className}` : "lalt-article"} dangerouslySetInnerHTML={{ __html: html }} />;
}
