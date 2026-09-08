/**
 * NewsList (S23, AC-16).
 *
 * Newest first, every item with its date, type and a link to the feed it came
 * from, and an explicit note that earthquakes are context rather than a priced
 * hazard. The ordering assertion reads the rendered DOM rather than the input
 * array, so a component that quietly reordered would be caught.
 */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NewsList } from '@/components/ai/NewsList';
import type { EnvironmentalEvent } from '@/app/(app)/ai/queries';

function event(over: Partial<EnvironmentalEvent> & { id: string }): EnvironmentalEvent {
  return {
    title: 'Fire detected near Pekanbaru',
    event_type: 'fire',
    occurred_on: '2026-09-01',
    source_feed: 'NASA FIRMS',
    source_url: 'https://firms.modaps.eosdis.nasa.gov/',
    hotspot_id: null,
    hotspot_name: null,
    ...over,
  };
}

const EVENTS: EnvironmentalEvent[] = [
  event({ id: 'e-newest', occurred_on: '2026-09-06', title: 'Storm surge warning, Manila Bay', event_type: 'storm' }),
  event({ id: 'e-middle', occurred_on: '2026-09-03', title: 'Flooding in North Jakarta', event_type: 'flood', hotspot_id: 'HS-ID-JAKARTA', hotspot_name: 'Central Jakarta and BSD' }),
  event({ id: 'e-oldest', occurred_on: '2026-08-28', title: 'Haze over the Strait of Malacca', event_type: 'haze' }),
];

describe('the list renders what a reader can check', () => {
  it('renders one item per event with its count', () => {
    render(<NewsList events={EVENTS} />);
    expect(screen.getByTestId('news-count')).toHaveTextContent('3');
    for (const e of EVENTS) {
      expect(screen.getByTestId(`news-item-${e.id}`)).toBeInTheDocument();
    }
  });

  it('gives every item a date, a type and a working source link', () => {
    render(<NewsList events={EVENTS} />);

    for (const e of EVENTS) {
      const item = screen.getByTestId(`news-item-${e.id}`);
      expect(within(item).getByText(e.occurred_on)).toBeInTheDocument();
      expect(screen.getByTestId(`news-type-${e.id}`)).toHaveTextContent(e.event_type);

      const link = screen.getByTestId(`news-link-${e.id}`);
      expect(link).toHaveAttribute('href', e.source_url);
      expect(link).toHaveTextContent(e.title);
    }
  });

  it('names the feed each item came from', () => {
    render(<NewsList events={EVENTS} />);
    expect(screen.getByTestId('news-item-e-newest')).toHaveTextContent('NASA FIRMS');
  });

  it('shows the hotspot an event belongs to, when it has one', () => {
    render(<NewsList events={EVENTS} />);
    expect(screen.getByTestId('news-item-e-middle')).toHaveTextContent('Central Jakarta and BSD');
    expect(screen.getByTestId('news-item-e-newest')).not.toHaveTextContent('Central Jakarta');
  });
});

describe('ordering', () => {
  it('renders newest first, reading the rendered order rather than the input', () => {
    render(<NewsList events={EVENTS} />);

    const rendered = within(screen.getByTestId('news-items'))
      .getAllByRole('listitem')
      .map((li) => li.getAttribute('data-occurred-on'));

    expect(rendered).toEqual(['2026-09-06', '2026-09-03', '2026-08-28']);
    expect(rendered).toEqual([...rendered].sort().reverse());
  });
});

describe('earthquakes are context, never a priced hazard', () => {
  it('adds the note when an earthquake is in the list', () => {
    render(
      <NewsList
        events={[...EVENTS, event({ id: 'e-quake', event_type: 'earthquake', title: 'M5.1 offshore Sumatra' })]}
      />,
    );
    expect(screen.getByTestId('earthquake-note')).toHaveTextContent(/never scored/i);
  });

  it('leaves the note off when there is no earthquake', () => {
    render(<NewsList events={EVENTS} />);
    expect(screen.queryByTestId('earthquake-note')).toBeNull();
  });
});

describe('the empty and refreshless cases', () => {
  it('says so when there is nothing to show', () => {
    render(<NewsList events={[]} />);
    expect(screen.getByTestId('news-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('news-items')).toBeNull();
  });

  it('omits the refresh button when no action is supplied', () => {
    render(<NewsList events={EVENTS} />);
    expect(screen.queryByTestId('refresh-news')).toBeNull();
  });

  it('offers the refresh button when an action is supplied', () => {
    render(<NewsList events={EVENTS} refreshAction={async () => ({ ok: true, message: 'done' })} />);
    expect(screen.getByTestId('refresh-news')).toBeInTheDocument();
  });
});
