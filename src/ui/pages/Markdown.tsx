/**
 * A tiny, dependency-free, XSS-safe Markdown renderer for record narratives.
 *
 * Records store a free-text `body` authored in Markdown. Rather than pull in a
 * full Markdown library (and a separate HTML sanitizer), we parse a deliberately
 * small, safe subset into REACT elements — never raw HTML. Because we build the
 * element tree ourselves and only ever emit plain text into element children,
 * there is no `dangerouslySetInnerHTML` and no HTML-injection surface: a `body`
 * containing `<script>` renders as the literal text "<script>", not a tag.
 *
 * Supported subset (enough for a ship's-log narrative):
 *   - paragraphs (blank-line separated)
 *   - unordered lists (`- ` / `* ` lines) and ordered lists (`1. ` lines)
 *   - ATX headings (`#`..`######`)
 *   - blockquotes (`> `)
 *   - inline: **bold**, *italic* / _italic_, `code`, and [text](http(s)/relative)
 *
 * Anything outside the subset passes through as plain text, so authoring never
 * breaks the page. Links are restricted to http(s)/mailto/relative targets
 * (javascript: and data: URLs are dropped) as a second line of defence.
 */
import type { ReactNode } from 'react';

/* ----------------------------------------------------------- inline parser */

const INLINE = /(\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;

/** True for a link target we're willing to render (no javascript:/data: etc.). */
function isSafeHref(href: string): boolean {
  const h = href.trim().toLowerCase();
  if (h.startsWith('http://') || h.startsWith('https://') || h.startsWith('mailto:')) return true;
  // Relative or root-anchored links (e.g. /photos/...) are fine; an explicit
  // scheme we don't recognise is not.
  return !/^[a-z][a-z0-9+.-]*:/.test(h);
}

/** Parse inline spans (bold/italic/code/link) into React nodes. */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  let i = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-i${i++}`;
    if (m[2] !== undefined) out.push(<strong key={key}>{m[2]}</strong>);
    else if (m[3] !== undefined) out.push(<em key={key}>{m[3]}</em>);
    else if (m[4] !== undefined) out.push(<em key={key}>{m[4]}</em>);
    else if (m[5] !== undefined) out.push(<code key={key}>{m[5]}</code>);
    else if (m[6] !== undefined && m[7] !== undefined) {
      const href = m[7];
      out.push(
        isSafeHref(href)
          ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{m[6]}</a>
          : m[6],
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ------------------------------------------------------------ block parser */

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = (): void => {
    if (para.length) { blocks.push({ kind: 'p', text: para.join(' ').trim() }); para = []; }
  };
  const flushList = (): void => {
    if (list) { blocks.push(list.ordered ? { kind: 'ol', items: list.items } : { kind: 'ul', items: list.items }); list = null; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); flushList(); continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara(); flushList();
      blocks.push({ kind: 'h', level: heading[1]!.length, text: heading[2]!.trim() });
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; }
      list.items.push(bullet[1]!);
      continue;
    }

    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      flushPara();
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; }
      list.items.push(numbered[1]!);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushPara(); flushList();
      blocks.push({ kind: 'quote', text: quote[1]! });
      continue;
    }

    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return blocks;
}

/* ------------------------------------------------------------------ render */

export function Markdown({ source, className = 'markdown' }: { source: string; className?: string }): JSX.Element {
  const blocks = parseBlocks(source ?? '');
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.kind) {
          case 'h': {
            const Tag = (`h${Math.min(6, b.level + 2)}`) as 'h3' | 'h4' | 'h5' | 'h6';
            return <Tag key={key}>{renderInline(b.text, key)}</Tag>;
          }
          case 'quote':
            return <blockquote key={key}>{renderInline(b.text, key)}</blockquote>;
          case 'ul':
            return <ul key={key}>{b.items.map((it, j) => <li key={`${key}-${j}`}>{renderInline(it, `${key}-${j}`)}</li>)}</ul>;
          case 'ol':
            return <ol key={key}>{b.items.map((it, j) => <li key={`${key}-${j}`}>{renderInline(it, `${key}-${j}`)}</li>)}</ol>;
          case 'p':
          default:
            return <p key={key}>{renderInline(b.text, key)}</p>;
        }
      })}
    </div>
  );
}
