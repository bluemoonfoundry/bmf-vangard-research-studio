import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Bible, Fact } from '@/project/types';
import { RenameAttributeForm } from '@/components/bible/RenameAttribute';

let n = 0;
const fact = (entityId: string, attribute: string, value: Fact['value'] = 'x'): Fact => ({
  id: `f${++n}`, entityId, attribute, value, status: 'kept', origin: 'manual', createdAt: 'T0', updatedAt: 'T0',
});
const bible: Bible = {
  facts: [fact('mara', 'eyes', 'green'), fact('mara', 'eye colour', 'brown'), fact('ivo', 'Eyes', 'grey'), fact('mara', 'age', { age: 6, year: 0 })],
  dependencies: [], decisions: [],
};

function setup(attribute = 'eyes') {
  const onRename = vi.fn();
  render(<RenameAttributeForm attribute={attribute} entityId="mara" bible={bible} suggestions={['eye colour']} onRename={onRename} onCancel={() => {}} />);
  return onRename;
}

describe('RenameAttributeForm', () => {
  it('renames on this entity by default', () => {
    const onRename = setup();
    expect(screen.getByText('Renames 1 fact on this entity.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'eye colour' } });
    expect(screen.getByText('Merges into the existing "eye colour".')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(onRename).toHaveBeenCalledWith('eye colour', false);
  });

  it('can rename on every entity', () => {
    const onRename = setup();
    fireEvent.click(screen.getByLabelText('Rename on every entity'));
    expect(screen.getByText('Renames 2 facts on 2 entities.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'Eye colour' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(onRename).toHaveBeenCalledWith('Eye colour', true);
  });

  it('refuses a rename the bible cannot hold', () => {
    const onRename = setup('age');
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'years' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Ages with a year must stay under "age".');
    expect(onRename).not.toHaveBeenCalled();
  });
});
