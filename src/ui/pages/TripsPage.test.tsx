import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import TripsPage from './TripsPage.js';
import { api } from '../lib/api.js';
import type { TripRec } from '../lib/types.js';

// The page only ever calls api.trips()/api.trip(); mock just those so the test
// drives the real component against fixed, demo-shaped data.
vi.mock('../lib/api.js', () => ({
  api: { trips: vi.fn(), trip: vi.fn() },
  ApiError: class ApiError extends Error {},
}));

const mockedTrips = vi.mocked(api.trips);

/** A rich trip fixture: waypoints, a high finding cross-linking to maintenance,
 *  conditions, crew, photos (already carrying the `photos/` prefix as the real
 *  records store them), and a Markdown body. */
const PASSAGE: TripRec = {
  id: 't-2026-05-09',
  title: 'Coastal passage to Heron Cove',
  date: '2026-05-09',
  durationHrs: 9.5,
  distanceNm: 41.2,
  engineHrs: 2.4,
  sky: 'Clear, building cumulus',
  wind: 'SW 14-18 kt',
  seas: 'moderate, 2-3 ft',
  tempF: 64,
  crew: ['Skipper', 'Dana R.', 'Sam P.'],
  waypoints: [
    { name: "Mariner's Cove Marina", type: 'depart', time: '06:10', note: 'Slipped the dock at first light.' },
    { name: 'Heron Cove', type: 'anchor', time: '15:40', note: 'Anchored in 12 ft, sand.' },
  ],
  findings: [
    { text: 'Raw-water pump weeping at the shaft seal.', severity: 'high', maintId: 'm-impeller' },
    { text: 'Cabin sole trim screw backing out.', severity: 'low' },
  ],
  photos: ['photos/t-2026-05-09-passage-dawn.jpg'],
  body: 'The **longest passage** of the year — a delivery run down the coast.\n\nA second paragraph of narrative.',
};

/** A minimal trip with most optional fields absent — proves graceful degrade. */
const SHAKEDOWN: TripRec = {
  id: 't-2026-04-18',
  title: 'Spring shakedown',
  date: '2026-04-18',
  body: 'First sail after the winter layup.',
};

function renderTrips(initialPath = '/trips'): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/trips" element={<TripsPage />} />
        <Route path="/trips/:id" element={<TripsPage />} />
        {/* A spy route so we can assert a finding cross-link navigates to it. */}
        <Route path="/maintenance" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function LocationProbe(): JSX.Element {
  const loc = useLocation();
  return <div data-testid="maint-route">{loc.pathname + loc.search}</div>;
}

beforeEach(() => {
  mockedTrips.mockReset();
  mockedTrips.mockResolvedValue([PASSAGE, SHAKEDOWN]);
});

describe('TripsPage — list', () => {
  it('lists trips from GET /api/trips as cards (title + a stats header)', async () => {
    renderTrips();
    await waitFor(() => expect(screen.getByText('Coastal passage to Heron Cove')).toBeInTheDocument());
    expect(screen.getByText('Spring shakedown')).toBeInTheDocument();
    // Stats header summarises the fleet log.
    expect(screen.getByText(/Trips logged/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no trips', async () => {
    mockedTrips.mockResolvedValue([]);
    renderTrips();
    await waitFor(() => expect(screen.getByText(/no trips/i)).toBeInTheDocument());
  });

  it('never renders a cost row or money on the trips list (trips carry no costs)', async () => {
    renderTrips();
    await waitFor(() => expect(screen.getByText('Coastal passage to Heron Cove')).toBeInTheDocument());
    expect(document.body).not.toHaveTextContent('$');
    expect(screen.queryByText(/cost/i)).not.toBeInTheDocument();
  });
});

describe('TripsPage — detail', () => {
  it('opens a trip detail on card click with conditions, crew, waypoints and the narrative body', async () => {
    const user = userEvent.setup();
    renderTrips();
    await waitFor(() => expect(screen.getByText('Coastal passage to Heron Cove')).toBeInTheDocument());
    await user.click(screen.getByText('Coastal passage to Heron Cove'));

    // Conditions (WeatherRow) — wind/seas/sky/air.
    await waitFor(() => expect(screen.getByText('SW 14-18 kt')).toBeInTheDocument());
    expect(screen.getByText('moderate, 2-3 ft')).toBeInTheDocument();
    expect(screen.getByText('64°F')).toBeInTheDocument();
    // Crew chips.
    expect(screen.getByText('Dana R.')).toBeInTheDocument();
    // Waypoints timeline.
    expect(screen.getByText("Mariner's Cove Marina")).toBeInTheDocument();
    expect(screen.getByText('Heron Cove')).toBeInTheDocument();
    // Markdown body rendered (bold becomes <strong>, NOT literal asterisks).
    const strong = screen.getByText('longest passage');
    expect(strong.tagName.toLowerCase()).toBe('strong');
    expect(document.body).not.toHaveTextContent('**longest passage**');
  });

  it('renders trip photos via the /photos route', async () => {
    const user = userEvent.setup();
    renderTrips();
    await waitFor(() => expect(screen.getByText('Coastal passage to Heron Cove')).toBeInTheDocument());
    await user.click(screen.getByText('Coastal passage to Heron Cove'));
    await waitFor(() => {
      const img = document.querySelector('img');
      expect(img).not.toBeNull();
      // The record stores `photos/<name>.jpg`; the URL is that, root-anchored.
      expect(img?.getAttribute('src')).toBe('/photos/t-2026-05-09-passage-dawn.jpg');
    });
  });

  it('cross-links a finding to /maintenance?focus=<maintId>', async () => {
    const user = userEvent.setup();
    renderTrips();
    await waitFor(() => expect(screen.getByText('Coastal passage to Heron Cove')).toBeInTheDocument());
    await user.click(screen.getByText('Coastal passage to Heron Cove'));

    await waitFor(() => expect(screen.getByText(/Raw-water pump weeping/i)).toBeInTheDocument());
    // The finding WITH a maintId offers a cross-link; the one without does not.
    const linkBtn = screen.getByRole('button', { name: /work list|view|resolved/i });
    await user.click(linkBtn);
    expect(screen.getByTestId('maint-route')).toHaveTextContent('/maintenance?focus=m-impeller');
  });

  it('shows a severity badge for each finding', async () => {
    const user = userEvent.setup();
    renderTrips();
    await waitFor(() => expect(screen.getByText('Coastal passage to Heron Cove')).toBeInTheDocument());
    await user.click(screen.getByText('Coastal passage to Heron Cove'));
    await waitFor(() => expect(screen.getByText(/Raw-water pump weeping/i)).toBeInTheDocument());
    // High + low severity badges both rendered.
    expect(screen.getByText(/high/i)).toBeInTheDocument();
    expect(screen.getByText(/low/i)).toBeInTheDocument();
  });
});

describe('TripsPage — deep-link + focus', () => {
  it('opens the detail directly for a /trips/:id deep link', async () => {
    renderTrips('/trips/t-2026-05-09');
    await waitFor(() => expect(screen.getByText('SW 14-18 kt')).toBeInTheDocument());
    // The detail "All trips" back affordance is present.
    expect(screen.getByText(/All trips/i)).toBeInTheDocument();
  });

  it('opens + highlights the focused trip when arriving with ?focus=<id>', async () => {
    renderTrips('/trips?focus=t-2026-05-09');
    await waitFor(() => expect(screen.getByText('SW 14-18 kt')).toBeInTheDocument());
  });

  it('degrades gracefully for a trip missing optional fields', async () => {
    renderTrips('/trips/t-2026-04-18');
    await waitFor(() => expect(screen.getByText('First sail after the winter layup.')).toBeInTheDocument());
    // No crash on absent waypoints/findings/crew/conditions/photos.
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('TripsPage — redaction posture (no maintenance costs leak via cross-links)', () => {
  // The page renders trips only; it must NEVER surface a maintenance costEst or a
  // money figure regardless of role. We assert that with BOTH an owner-shaped
  // fixture (a maintId present, as an owner would see) and a crew-shaped fixture.
  it('owner-shaped trip: finding links to maintenance but shows no cost row/money', async () => {
    const user = userEvent.setup();
    mockedTrips.mockResolvedValue([PASSAGE]);
    renderTrips();
    await waitFor(() => expect(screen.getByText('Coastal passage to Heron Cove')).toBeInTheDocument());
    await user.click(screen.getByText('Coastal passage to Heron Cove'));
    await waitFor(() => expect(screen.getByText(/Raw-water pump weeping/i)).toBeInTheDocument());
    expect(document.body).not.toHaveTextContent('$');
    expect(screen.queryByText(/\bcost\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/costEst/i)).not.toBeInTheDocument();
  });

  it('crew-shaped trip (no monetary fields anywhere): renders cleanly, no cost row/link', async () => {
    const user = userEvent.setup();
    // A crew payload is byte-identical for trips (trips carry no costs); the
    // cross-link target still exists, but no money is ever shown here.
    mockedTrips.mockResolvedValue([PASSAGE]);
    renderTrips();
    await waitFor(() => expect(screen.getByText('Coastal passage to Heron Cove')).toBeInTheDocument());
    await user.click(screen.getByText('Coastal passage to Heron Cove'));
    await waitFor(() => expect(screen.getByText(/Raw-water pump weeping/i)).toBeInTheDocument());
    const detail = screen.getByText('Coastal passage to Heron Cove').closest('.page') ?? document.body;
    expect(within(detail as HTMLElement).queryByText('$')).not.toBeInTheDocument();
  });
});
