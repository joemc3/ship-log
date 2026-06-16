import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge, Badge, WeatherRow, EmptyState, Button } from './atoms.js';
import { Icon, CompassRose } from './Icon.js';
import type { MaintStatus } from '../lib/types.js';

describe('StatusBadge', () => {
  const cases: Array<[MaintStatus, string, string]> = [
    ['overdue', 'Overdue', 'overdue'],
    ['due', 'Due soon', 'due'],
    ['scheduled', 'Scheduled', 'scheduled'],
    ['done', 'Done', 'done'],
  ];
  it.each(cases)('renders %s with the right label + class', (status, label, cls) => {
    const { container } = render(<StatusBadge status={status} />);
    const el = container.querySelector('.badge');
    expect(el).toHaveTextContent(label);
    expect(el).toHaveClass(cls);
    expect(container.querySelector('.dot')).toBeInTheDocument();
  });
});

describe('Badge', () => {
  it('applies the tone class and defaults to plain', () => {
    const { container, rerender } = render(<Badge tone="due">Low</Badge>);
    expect(container.querySelector('.badge')).toHaveClass('due');
    rerender(<Badge>Neutral</Badge>);
    expect(container.querySelector('.badge')).toHaveClass('plain');
  });
});

describe('Icon', () => {
  it('renders an svg labelled by its name', () => {
    render(<Icon name="anchor" />);
    const el = screen.getByLabelText('anchor');
    expect(el.tagName.toLowerCase()).toBe('svg');
    expect(el).toHaveAttribute('data-icon', 'anchor');
    expect(el.querySelectorAll('circle, path').length).toBeGreaterThan(0);
  });

  it('respects a custom size', () => {
    render(<Icon name="wrench" s={40} />);
    expect(screen.getByLabelText('wrench')).toHaveAttribute('width', '40');
  });

  it('CompassRose renders the brand svg', () => {
    render(<CompassRose s={48} />);
    const el = screen.getByLabelText('compass rose');
    expect(el).toHaveAttribute('width', '48');
  });
});

describe('WeatherRow', () => {
  it('renders only the chips for present fields', () => {
    const { container } = render(<WeatherRow trip={{ wind: 'NW 12kt', tempF: 68 }} />);
    expect(container).toHaveTextContent('NW 12kt');
    expect(container).toHaveTextContent('68°F');
    // seas + sky absent -> their chips are not rendered
    expect(container.querySelectorAll('.chip').length).toBe(2);
  });
});

describe('EmptyState + Button', () => {
  it('EmptyState shows the title and optional hint', () => {
    render(<EmptyState title="Nothing here" hint="Add the first record" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('Add the first record')).toBeInTheDocument();
  });

  it('Button applies its variant class and optional icon', () => {
    const { container } = render(<Button variant="brass" icon="plus">New</Button>);
    const btn = container.querySelector('button');
    expect(btn).toHaveClass('btn', 'btn-brass');
    expect(btn).toHaveTextContent('New');
    expect(container.querySelector('[data-icon="plus"]')).toBeInTheDocument();
  });
});
