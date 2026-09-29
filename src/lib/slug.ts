export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug.length > 0 ? slug : "item";
}

export function withSlugSuffix(slug: string): string {
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${slug.slice(0, 42)}-${suffix}`;
}
