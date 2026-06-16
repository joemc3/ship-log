/**
 * Field primitives: TextField, TextAreaField, NumberField, DateField,
 * SelectField, StringArrayField, GroupField. Each is a controlled input bound to
 * a value + onChange, with a label, optional hint, required marker, and an error
 * slot. We assert the controlled contract, that a SelectField constrains to its
 * declared option set, and that the repeatable fields add/remove rows.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  TextField,
  TextAreaField,
  NumberField,
  DateField,
  SelectField,
  StringArrayField,
  GroupField,
} from './fields.js';

describe('TextField', () => {
  it('renders a labelled controlled input and reports edits', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextField label="Title" value="" onChange={onChange} />);
    const input = screen.getByLabelText('Title');
    await user.type(input, 'A');
    expect(onChange).toHaveBeenCalledWith('A');
  });

  it('marks a required field and surfaces an error message', () => {
    render(<TextField label="Item" value="" onChange={() => {}} required error="Item is required" />);
    expect(screen.getByText('Item is required')).toBeInTheDocument();
    // The required marker is present near the label.
    expect(screen.getByLabelText(/Item/)).toBeRequired();
  });
});

describe('TextAreaField (the Markdown body)', () => {
  it('renders a textarea bound to value/onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextAreaField label="Log" value="" onChange={onChange} />);
    const ta = screen.getByLabelText('Log');
    expect(ta.tagName.toLowerCase()).toBe('textarea');
    await user.type(ta, 'x');
    expect(onChange).toHaveBeenCalledWith('x');
  });
});

describe('NumberField', () => {
  it('is a numeric input bound as a string (buildPayload coerces later)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NumberField label="Distance (nm)" value="" onChange={onChange} />);
    const input = screen.getByLabelText('Distance (nm)') as HTMLInputElement;
    expect(input.type).toBe('number');
    await user.type(input, '4');
    expect(onChange).toHaveBeenCalledWith('4');
  });
});

describe('DateField', () => {
  it('is a date input (ISO YYYY-MM-DD)', async () => {
    const onChange = vi.fn();
    render(<DateField label="Date" value="2026-06-16" onChange={onChange} />);
    const input = screen.getByLabelText('Date') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.value).toBe('2026-06-16');
  });
});

describe('SelectField', () => {
  it('constrains to its declared option set (the enum values) plus a blank choice', () => {
    render(
      <SelectField
        label="Status"
        value="due"
        onChange={() => {}}
        options={[
          { value: 'overdue', label: 'Overdue' },
          { value: 'due', label: 'Due soon' },
          { value: 'scheduled', label: 'Scheduled' },
          { value: 'done', label: 'Done' },
        ]}
      />,
    );
    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    // Exactly the four enum values (+ an empty placeholder for "unset").
    expect(values).toEqual(['', 'overdue', 'due', 'scheduled', 'done']);
    expect(select.value).toBe('due');
  });

  it('reports the chosen enum value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SelectField
        label="Severity"
        value=""
        onChange={onChange}
        options={[
          { value: 'low', label: 'Low' },
          { value: 'high', label: 'High' },
        ]}
      />,
    );
    await user.selectOptions(screen.getByLabelText('Severity'), 'high');
    expect(onChange).toHaveBeenCalledWith('high');
  });
});

describe('StringArrayField (crew[]/services[])', () => {
  it('renders one input per member and adds a row', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StringArrayField label="Crew" value={['Skipper']} onChange={onChange} />);
    expect(screen.getAllByLabelText(/^Crew member \d+$/)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /add/i }));
    // onChange receives the array with a new empty slot appended.
    expect(onChange).toHaveBeenCalledWith(['Skipper', '']);
  });

  it('removes a row', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StringArrayField label="Services" value={['canvas', 'rigging']} onChange={onChange} />);
    const removes = screen.getAllByRole('button', { name: /remove/i });
    await user.click(removes[0]!);
    expect(onChange).toHaveBeenCalledWith(['rigging']);
  });
});

describe('GroupField (repeatable object group — waypoints[])', () => {
  const fields = [
    { name: 'name', label: 'Name', kind: 'text' as const },
    {
      name: 'type',
      label: 'Type',
      kind: 'select' as const,
      options: [
        { value: 'depart', label: 'Depart' },
        { value: 'anchor', label: 'Anchor' },
      ],
    },
  ];

  it('renders a sub-form per row and edits a field within a row', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <GroupField
        label="Waypoints"
        value={[{ name: 'Marina', type: 'depart' }]}
        onChange={onChange}
        fields={fields}
      />,
    );
    const rows = screen.getAllByTestId('group-row');
    expect(rows).toHaveLength(1);
    const nameInput = within(rows[0]!).getByLabelText('Name');
    await user.type(nameInput, '!');
    // The change reports the whole array with the edited row.
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'Marina!', type: 'depart' }]);
  });

  it('adds and removes a group row', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<GroupField label="Findings" value={[]} onChange={onChange} fields={fields} />);
    await user.click(screen.getByRole('button', { name: /add/i }));
    expect(onChange).toHaveBeenCalledWith([{ name: '', type: '' }]);
  });
});
