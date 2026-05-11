// File purpose: Root component — owns auth state and provides AppContext to all children.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { clearToken, configureApi, setToken } from './api';
import LoginForm from './components/LoginForm';
import TopBar from './components/TopBar';
import StatusBanner from './components/StatusBanner';
import StudentPanel from './components/StudentPanel';
import InstructorPanel from './components/InstructorPanel';
import AdminPanel from './components/AdminPanel';
import type { AppStatus, Role, StatusVariant } from './types';

interface AppContextValue {
  showStatus: (message: string, variant?: StatusVariant) => void;
  logout: () => void;
  currentUserId: number | null;
}

const AppContext = createContext<AppContextValue>({
  showStatus: () => {},
  logout: () => {},
  currentUserId: null,
});

export function useApp(): AppContextValue {
  return useContext(AppContext);
}

function parseJwtSubject(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const id = Number(payload.sub);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [accessToken, setAccessToken] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [status, setStatus] = useState<AppStatus | null>(null);

  const loggedIn = Boolean(accessToken);

  // Keep body class in sync with auth state for CSS selectors.
  useEffect(() => {
    document.body.className = loggedIn ? 'is-authed' : 'is-guest';
  }, [loggedIn]);

  const showStatus = useCallback((message: string, variant: StatusVariant = 'neutral') => {
    setStatus(message ? { message, variant } : null);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setAccessToken('');
    setRole('');
    setStatus(null);
  }, []);

  // Use refs so the configureApi callback always sees the latest functions.
  const logoutRef = useRef(logout);
  const showStatusRef = useRef(showStatus);
  useEffect(() => { logoutRef.current = logout; }, [logout]);
  useEffect(() => { showStatusRef.current = showStatus; }, [showStatus]);

  // Wire up the 401 auto-logout once on mount.
  useEffect(() => {
    configureApi(() => {
      logoutRef.current();
      showStatusRef.current('Your session has expired. Please sign in again.', 'error');
    });
  }, []);

  const handleLogin = useCallback((token: string, userRole: Role) => {
    setToken(token);
    setAccessToken(token);
    setRole(userRole);
    setStatus(null);
  }, []);

  return (
    <AppContext.Provider value={{ showStatus, logout, currentUserId: parseJwtSubject(accessToken) }}>
      <a className="skip-link" href="#main">Skip to content</a>
      {loggedIn && <TopBar role={role as Role} />}
      <main id="main" className="shell">
        <div className="shell__inner">
          {!loggedIn && <LoginForm onLogin={handleLogin} />}
          {status && <StatusBanner status={status} />}
          {loggedIn && (
            <div className="panels">
              {role === 'student' && <StudentPanel />}
              {(role === 'instructor' || role === 'admin') && <InstructorPanel />}
              {role === 'admin' && <AdminPanel />}
            </div>
          )}
        </div>
      </main>
    </AppContext.Provider>
  );
}
