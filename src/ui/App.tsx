/**
 * App root. Mounts the session provider + router + shell (see AppRouter). The
 * old F1 skeleton (a bare /api/me probe) is superseded by the full shell.
 */
import AppRouter from './AppRouter.js';

export default function App(): JSX.Element {
  return <AppRouter />;
}
