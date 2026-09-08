/**
 * Smoke assertion for the `component` Vitest project (S4).
 *
 * Proves jsdom, the React plugin, Testing Library and the jest-dom matchers are
 * all wired, so the S14 and S23 component tests can be written against a real
 * rendered tree rather than a stub.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

function HaircutChip({ label, value }: { label: string; value: number }) {
  return (
    <span data-testid="haircut-chip">
      {label}: {(value * 100).toFixed(1)}%
    </span>
  );
}

describe('component project harness', () => {
  it('runs on the jsdom environment', () => {
    expect(typeof document).toBe('object');
    expect(typeof window).toBe('object');
  });

  it('renders JSX and matches with jest-dom', () => {
    render(<HaircutChip label="Flood" value={0.066} />);

    const chip = screen.getByTestId('haircut-chip');
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent('Flood: 6.6%');
  });
});
