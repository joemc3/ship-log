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
 *   - unordered lists (`- ` / `* `) and ordered lists (`1. `), nestable by
 *     indenting the marker; a wrapped continuation line belongs to its item
 *   - ATX headings (`#`..`######`), optionally carrying a `{#anchor}` id so a
 *     table of contents can deep-link into the body
 *   - horizontal rules (`---`, `***`, `___`)
 *   - blockquotes (`> `)
 *   - inline: **bold**, *italic* / _italic_, `code`, and [text](http(s)/relative)
 *
 * Anything outside the subset passes through as plain text, so authoring never
 * breaks the page. Links are restricted to http(s)/mailto/relative targets
 * (javascript: and data: URLs are dropped) as a second line of defence.
 *
 * Typography lives in the co-located `Markdown.module.css`, applied by the
 * component itself so every page that renders a body gets it; a caller's
 * `className` is applied alongside, not instead.
 */
import type { ReactNode } from 'react';
import styles from './Markdown.module.css';

/* ----------------------------------------------------------- inline parser */

const INLINE = /(\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;

/** True for a link target we're willing to render (no javascript:/data: etc.). */
function isSafeHref(href: string): boolean {
  const h = href.trim().toLowerCase();
  if (h.startsWith('http://') || h.startsWith('https://') || h.startsWith('mailto:')) return true;
  // Relative, root-anchored (e.g. /photos/...) and in-page (#anchor) links are
  // fine; an explicit scheme we don't recognise is not.
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

/** One list entry: its own text, plus an optional nested list beneath it. */
interface Item { text: string; child: ListBlock | null }
interface ListBlock { kind: 'list'; ordered: boolean; indent: number; items: Item[] }

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string; id?: string }
  | { kind: 'quote'; text: string }
  | { kind: 'hr' }
  | ListBlock;

const HEADING = /^(#{1,6})\s+(.*?)(?:\s*\{#([A-Za-z0-9_-]+)\})?\s*$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const LIST = /^(\s*)(?:[-*]|(\d+)\.)\s+(.*)$/;

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  /** Open lists, outermost first; the last is the one currently accepting items. */
  let stack: ListBlock[] = [];

  const flushPara = (): void => {
    if (para.length) { blocks.push({ kind: 'p', text: para.join(' ').trim() }); para = []; }
  };
  const flushList = (): void => { stack = []; };
  const lastItem = (): Item | null => {
    const list = stack[stack.length - 1];
    return list && list.items.length ? list.items[list.items.length - 1]! : null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); flushList(); continue; }

    const heading = HEADING.exec(line);
    if (heading) {
      flushPara(); flushList();
      blocks.push({ kind: 'h', level: heading[1]!.length, text: heading[2]!.trim(), id: heading[3] });
      continue;
    }

    if (RULE.test(line.trim())) {
      flushPara(); flushList();
      blocks.push({ kind: 'hr' });
      continue;
    }

    const list = LIST.exec(line);
    if (list) {
      flushPara();
      const indent = list[1]!.length;
      const ordered = list[2] !== undefined;
      const text = list[3]!;

      // Close any open lists indented deeper than this marker.
      while (stack.length && indent < stack[stack.length - 1]!.indent) stack.pop();
      const open = stack[stack.length - 1];

      if (!open) {
        const root: ListBlock = { kind: 'list', ordered, indent, items: [] };
        blocks.push(root);
        stack = [root];
      } else if (indent > open.indent) {
        // Deeper than the open list: nest under its most recent item.
        const parent = lastItem();
        const child: ListBlock = { kind: 'list', ordered, indent, items: [] };
        if (parent) { parent.child = child; stack.push(child); }
        else { open.items.push({ text: '', child }); stack.push(child); }
      } else if (open.ordered !== ordered) {
        // Same depth, different marker style: a sibling list, not a continuation.
        stack.pop();
        const sibling: ListBlock = { kind: 'list', ordered, indent, items: [] };
        const parent = lastItem();
        if (parent) { parent.child = sibling; stack.push(sibling); }
        else { blocks.push(sibling); stack = [sibling]; }
      }
      stack[stack.length - 1]!.items.push({ text, child: null });
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushPara(); flushList();
      blocks.push({ kind: 'quote', text: quote[1]! });
      continue;
    }

    // A plain line directly beneath a list item is that item's wrapped
    // continuation — join it on rather than silently ending the list.
    const cont = lastItem();
    if (cont) { cont.text = `${cont.text} ${line.trim()}`.trim(); continue; }

    para.push(line);
  }
  flushPara(); flushList();
  return blocks;
}

/* ------------------------------------------------------------------ render */

function renderList(list: ListBlock, key: string): JSX.Element {
  const Tag = list.ordered ? 'ol' : 'ul';
  return (
    <Tag key={key}>
      {list.items.map((it, j) => (
        <li key={`${key}-${j}`}>
          {renderInline(it.text, `${key}-${j}`)}
          {it.child && renderList(it.child, `${key}-${j}-c`)}
        </li>
      ))}
    </Tag>
  );
}

export function Markdown({ source, className }: { source: string; className?: string }): JSX.Element {
  const blocks = parseBlocks(source ?? '');
  const cls = [styles.markdown, className].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.kind) {
          case 'h': {
            const Tag = (`h${Math.min(6, b.level + 2)}`) as 'h3' | 'h4' | 'h5' | 'h6';
            return <Tag key={key} id={b.id}>{renderInline(b.text, key)}</Tag>;
          }
          case 'quote':
            return <blockquote key={key}>{renderInline(b.text, key)}</blockquote>;
          case 'hr':
            return <hr key={key} />;
          case 'list':
            return renderList(b, key);
          case 'p':
          default:
            return <p key={key}>{renderInline(b.text, key)}</p>;
        }
      })}
    </div>
  );
}
