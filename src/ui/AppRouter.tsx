/**
 * Routing + role guards. The route table mirrors the prototype's NAV plus the
 * auth/account/admin pages the SPA adds. Access is gated from the session:
 *
 *   guest  → only Welcome (`/`) + Login; any gated route redirects to /login
 *   crew   → all reads EXCEPT Costs + Admin (owner-only), which redirect home
 *   owner  → everything
 *   demo   → owner-equivalent (sees everything); Login is disabled, so /login
 *            redirects to Welcome
 *
 * Cross-link deep-linking is preserved: gated record routes accept an `:id`
 * param (e.g. /trips/:id) and pages also honour a `?focus=` query, mirroring the
 * prototype's navTo(page,ref)+focusId. The redirect target is the page route, so
 * a deep link survives a login round-trip.
 */
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { SessionProvider, useSession } from './state/session.js';
import { Shell } from './components/Shell.js';
import WelcomePage from './pages/WelcomePage.js';
import LoginPage from './pages/LoginPage.js';
import TripsPage from './pages/TripsPage.js';
import MaintenancePage from './pages/MaintenancePage.js';
import InventoryPage from './pages/InventoryPage.js';
import CostsPage from './pages/CostsPage.js';
import ManualsPage from './pages/ManualsPage.js';
import VendorsPage from './pages/VendorsPage.js';
import SearchPage from './pages/SearchPage.js';
import AdminPage from './pages/AdminPage.js';
import AccountPage from './pages/AccountPage.js';
import AssistantPage from './pages/AssistantPage.js';
import ConditionsPage from './pages/ConditionsPage.js';

function Loading(): JSX.Element {
  return (
    <div className="page-wrap" data-testid="session-loading">
      <p className="muted">Loading…</p>
    </div>
  );
}

/** Gate a subtree behind authentication (any non-guest role). Guests are sent to
 *  /login, preserving the attempted path so a later login can return there. */
function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const { loading, isAuthed } = useSession();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!isAuthed) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Gate a subtree behind the owner role (demo's viewer is owner-equivalent, so
 *  `isOwner` is already true there). Non-owners are sent home. */
function RequireOwner({ children }: { children: ReactNode }): JSX.Element {
  const { loading, isOwner } = useSession();
  if (loading) return <Loading />;
  if (!isOwner) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** The /login route: only an anonymous guest in a non-demo deployment may see
 *  it. An already-authed viewer (or any demo viewer) is redirected home. */
function LoginRoute(): JSX.Element {
  const { loading, isAuthed, demo } = useSession();
  if (loading) return <Loading />;
  if (isAuthed || demo) return <Navigate to="/" replace />;
  return <LoginPage />;
}

/** The Shell layout wrapping all in-app routes (sidebar/topbar/search/etc.). */
function ShellLayout(): JSX.Element {
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

/** The route table, split out so tests can mount it inside a MemoryRouter. */
export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<ShellLayout />}>
        {/* Welcome is guest-allowed (the only page a guest sees besides Login). */}
        <Route path="/" element={<WelcomePage />} />
        <Route path="/conditions" element={<ConditionsPage />} />

        {/* Authenticated reads (crew + owner). */}
        <Route path="/trips" element={<RequireAuth><TripsPage /></RequireAuth>} />
        <Route path="/trips/:id" element={<RequireAuth><TripsPage /></RequireAuth>} />
        <Route path="/maintenance" element={<RequireAuth><MaintenancePage /></RequireAuth>} />
        <Route path="/maintenance/:id" element={<RequireAuth><MaintenancePage /></RequireAuth>} />
        <Route path="/inventory" element={<RequireAuth><InventoryPage /></RequireAuth>} />
        <Route path="/inventory/:id" element={<RequireAuth><InventoryPage /></RequireAuth>} />
        <Route path="/manuals" element={<RequireAuth><ManualsPage /></RequireAuth>} />
        <Route path="/manuals/:id" element={<RequireAuth><ManualsPage /></RequireAuth>} />
        <Route path="/vendors" element={<RequireAuth><VendorsPage /></RequireAuth>} />
        <Route path="/vendors/:id" element={<RequireAuth><VendorsPage /></RequireAuth>} />
        <Route path="/search" element={<RequireAuth><SearchPage /></RequireAuth>} />
        <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
        <Route path="/assistant" element={<RequireAuth><AssistantPage /></RequireAuth>} />

        {/* Owner-only. */}
        <Route path="/costs" element={<RequireOwner><CostsPage /></RequireOwner>} />
        <Route path="/costs/:id" element={<RequireOwner><CostsPage /></RequireOwner>} />
        <Route path="/admin" element={<RequireOwner><AdminPage /></RequireOwner>} />

        {/* Login lives inside the Shell too so the chrome stays consistent. */}
        <Route path="/login" element={<LoginRoute />} />

        {/* Unknown route -> home. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/** The app root: session + browser router around the route table. */
export default function AppRouter(): JSX.Element {
  return (
    <SessionProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </SessionProvider>
  );
}
