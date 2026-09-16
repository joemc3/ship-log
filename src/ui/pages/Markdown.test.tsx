/**
 * The Markdown renderer's block/inline subset.
 *
 * These cover the authoring shapes a real record body uses that the original
 * parser dropped on the floor — wrapped list items, nested lists, heading
 * anchors and horizontal rules — plus the default styling hook. The renderer
 * stays dependency-free and never emits raw HTML, so the XSS guarantee is
 * asserted here too.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from './Markdown.js';

describe('Markdown — wrapped list items', () => {
  it('joins a continuation line onto its list item instead of ending the list', () => {
    const { container } = render(
      <Markdown source={'1. Open the fuel tank vent. Portable tank,\n   port cockpit locker.\n2. Check the fuel level.'} />,
    );
    const lists = container.querySelectorAll('ol');
    expect(lists).toHaveLength(1);
    const items = lists[0]!.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toBe('Open the fuel tank vent. Portable tank, port cockpit locker.');
  });

  it('keeps one numbering run when items wrap (no restart at 1)', () => {
    const { container } = render(
      <Markdown source={'1. One wraps\n   onto a second line.\n2. Two\n3. Three'} />,
    );
    expect(container.querySelectorAll('ol')).toHaveLength(1);
    expect(container.querySelectorAll('li')).toHaveLength(3);
  });

  it('renders bold that spans a wrapped line, rather than literal asterisks', () => {
    render(<Markdown source={'1. Check the **prop and water\n   intakes are submerged** before starting.'} />);
    const strong = screen.getByText('prop and water intakes are submerged');
    expect(strong.tagName.toLowerCase()).toBe('strong');
    expect(document.body).not.toHaveTextContent('**prop and water');
  });
});

describe('Markdown — nested lists', () => {
  it('nests an indented bullet inside its parent ordered item', () => {
    const { container } = render(
      <Markdown source={'1. Perko selector to 2.\n   - ALL works too.\n   - 1 does nothing.\n2. Turn the key.'} />,
    );
    const ol = container.querySelector('ol')!;
    const topItems = ol.querySelectorAll(':scope > li');
    expect(topItems).toHaveLength(2);
    const nested = topItems[0]!.querySelector('ul');
    expect(nested).not.toBeNull();
    expect(nested!.querySelectorAll('li')).toHaveLength(2);
  });

  it('nests an indented bullet inside a parent bullet', () => {
    const { container } = render(<Markdown source={'- Top level\n  - Nested one\n- Second top'} />);
    const top = container.querySelectorAll('ul > li');
    expect(top.length).toBeGreaterThanOrEqual(2);
    const first = container.querySelector('ul > li')!;
    expect(first.querySelector('ul')!.querySelectorAll('li')).toHaveLength(1);
  });
});

describe('Markdown — headings and rules', () => {
  it('strips a {#anchor} suffix and renders it as the heading id', () => {
    const { container } = render(<Markdown source={'## Engine start {#engine-start}'} />);
    const h = container.querySelector('#engine-start')!;
    expect(h).not.toBeNull();
    expect(h.textContent).toBe('Engine start');
    expect(document.body).not.toHaveTextContent('{#engine-start}');
  });

  it('renders a heading with no anchor without an id', () => {
    const { container } = render(<Markdown source={'## Engine start'} />);
    const h = container.querySelector('h4')!;
    expect(h.textContent).toBe('Engine start');
    expect(h.id).toBe('');
  });

  it('renders --- as a horizontal rule, not literal text', () => {
    const { container } = render(<Markdown source={'Before\n\n---\n\nAfter'} />);
    expect(container.querySelectorAll('hr')).toHaveLength(1);
    expect(document.body).not.toHaveTextContent('---');
  });
});

describe('Markdown — styling hook and safety', () => {
  it('carries its own styling class by default so every page is styled', () => {
    const { container } = render(<Markdown source={'A paragraph.'} />);
    expect(container.firstElementChild!.className).toMatch(/markdown/);
  });

  it('still applies a caller-supplied className alongside its own', () => {
    const { container } = render(<Markdown source={'A paragraph.'} className="custom-thing" />);
    expect(container.firstElementChild!.className).toContain('custom-thing');
    expect(container.firstElementChild!.className).toMatch(/markdown/);
  });

  it('never emits raw HTML from the source', () => {
    const { container } = render(<Markdown source={'1. <script>alert(1)</script> is text\n   and so is this.'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });
});
