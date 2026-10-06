import manifest from './generated/manifest.json';
import { lazy, type ComponentType } from 'react';
const modules = import.meta.glob('../content/**/*.mdx') as Record<
  string,
  () => Promise<{ default: ComponentType<any> }>
>;
const components: Record<string, ComponentType<any> | undefined> = Object.fromEntries(
  Object.entries(modules).map(([name, load]) => [name, lazy(load)]),
);
export const documents = manifest;
export function documentBySlug(slug: string) {
  const meta = documents.find((d) => d.slug === slug);
  if (!meta) return null;
  const Component = components['../' + meta.file];
  return Component ? { meta, Component } : null;
}
