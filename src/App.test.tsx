import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '@/App';

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the product name', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Vangard Research Studio' })).toBeInTheDocument();
  });

  it('shows the version reported by the main process', async () => {
    vi.stubGlobal('vrs', { app: { getVersion: () => Promise.resolve('9.9.9') } });
    render(<App />);
    expect(await screen.findByText('v9.9.9')).toBeInTheDocument();
  });

  it('still renders when the preload bridge is missing (plain browser dev)', () => {
    vi.stubGlobal('vrs', undefined);
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Vangard Research Studio' })).toBeInTheDocument();
  });
});
