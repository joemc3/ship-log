import matter from 'gray-matter';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

// Use the `yaml` package (YAML 1.2 core schema) as gray-matter's YAML engine so
// frontmatter values parse predictably. Notably, bare ISO dates like
// `date: 2024-06-22` stay STRINGS — js-yaml's default schema would coerce them to
// Date objects, which would then fail our `z.string()` date fields downstream.
const engines = {
  yaml: {
    parse: (s: string) => parseYaml(s) as object,
    stringify: (o: object) => stringifyYaml(o),
  },
};

/**
 * Parse a Markdown+YAML-frontmatter file into structured data + body.
 * The body is trimmed intentionally: bodies are narrative Markdown, where
 * leading/trailing blank lines are not significant.
 */
export function parseRecord(fileContents: string): { data: Record<string, unknown>; body: string } {
  const parsed = matter(fileContents, { engines });
  return { data: parsed.data as Record<string, unknown>, body: parsed.content.trim() };
}

/** Serialize structured data + body back into a Markdown+YAML-frontmatter file. */
export function serializeRecord(data: Record<string, unknown>, body: string): string {
  return matter.stringify(body, data, { engines });
}
