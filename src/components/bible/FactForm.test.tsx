import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FactValue, TreeItem } from '@/project/types';
import { FactForm } from '@/components/bible/FactForm';

const mara: TreeItem = { id: 'e1', parentId: null, type: 'entity', entityKind: 'character', title: 'Mara', order: 0, keywords: [] };

function setup(initial?: { attribute: string; value: FactValue }) {
  const onSubmit = vi.fn();
  render(
    <FactForm entities={[mara]} fixedEntityId="e1" initial={initial} attributeSuggestions={() => []} onSubmit={onSubmit} onCancel={() => {}} />,
  );
  return onSubmit;
}

function fillAge(age: string, year: string) {
  fireEvent.change(screen.getByLabelText('Attribute'), { target: { value: 'Age' } });
  fireEvent.change(screen.getByLabelText('Age'), { target: { value: age } });
  fireEvent.change(screen.getByLabelText('Years since start'), { target: { value: year } });
  fireEvent.click(screen.getByRole('button', { name: 'Save fact' }));
}

describe('FactForm ages', () => {
  it('saves an age with a year as a dated age', () => {
    const onSubmit = setup();
    fillAge('18', '12');
    expect(onSubmit).toHaveBeenCalledWith({ entityId: 'e1', attribute: 'Age', value: { age: 18, year: 12 } });
  });

  it('saves an age without a year as plain text', () => {
    const onSubmit = setup();
    fillAge(' about 40 ', '');
    expect(onSubmit).toHaveBeenCalledWith({ entityId: 'e1', attribute: 'Age', value: 'about 40' });
  });

  it('refuses a year next to a non-numeric age', () => {
    const onSubmit = setup();
    fillAge('about 40', '3');
    expect(screen.getByRole('alert')).toHaveTextContent('With a year, the age must be a whole number of 0 or more.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(['-1', '2.5', '-', '1e'])('refuses year %s', (year) => {
    const onSubmit = setup();
    fillAge('18', year);
    expect(screen.getByRole('alert')).toHaveTextContent('Years since start must be a whole number of 0 or more.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('prefills both fields when editing a dated age', () => {
    setup({ attribute: 'age', value: { age: 6, year: 0 } });
    expect(screen.getByLabelText('Age')).toHaveValue('6');
    expect(screen.getByLabelText('Years since start')).toHaveValue('0');
  });

  it('keeps the plain value field for other attributes', () => {
    setup({ attribute: 'eyes', value: 'green' });
    expect(screen.getByLabelText('Value')).toHaveValue('green');
    expect(screen.queryByLabelText('Years since start')).toBeNull();
  });
});
