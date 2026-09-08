/**
 * LandslideBadge (S14, AC-7).
 *
 * Landslide is a manual-review flag and never a number. The badge is the only
 * place it appears on the case screen, so this file pins that it appears when
 * flagged, stays away when not, and says in words that it carries no haircut.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LandslideBadge } from '@/components/case/LandslideBadge';

describe('LandslideBadge', () => {
  it('renders nothing when the collateral is not flagged', () => {
    const { container } = render(<LandslideBadge flagged={false} slopeDeg={31.2} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('landslide-badge')).toBeNull();
  });

  it('names manual review when flagged', () => {
    render(<LandslideBadge flagged />);
    const badge = screen.getByTestId('landslide-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(/manual review/i);
  });

  it('states that the flag never enters the haircut', () => {
    render(<LandslideBadge flagged />);
    expect(screen.getByTestId('landslide-badge')).toHaveTextContent(
      /never enters the haircut/i,
    );
  });

  it('shows the slope that raised it, when known', () => {
    render(<LandslideBadge flagged slopeDeg={27.46} />);
    expect(screen.getByTestId('landslide-badge')).toHaveTextContent('27.5');
  });

  it('omits the slope when it is not known', () => {
    render(<LandslideBadge flagged slopeDeg={null} />);
    expect(screen.getByTestId('landslide-badge')).not.toHaveTextContent(/slope/i);
  });

  it('never renders a percentage, because it is not priced', () => {
    render(<LandslideBadge flagged slopeDeg={31.2} />);
    expect(screen.getByTestId('landslide-badge').textContent ?? '').not.toMatch(/%/);
  });
});
