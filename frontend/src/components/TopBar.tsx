// File purpose: Authenticated app header with brand, role indicator, optional MFA (staff only), and sign-out.

import { useCallback, useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import type { Role } from '../types';

interface Props {
  role: Role;
}

export default function TopBar({ role }: Props) {
  const { logout, showStatus } = useApp();
  const showMfaControls = role !== 'student';

  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);

  const loadMfaStatus = useCallback(async () => {
    setMfaLoading(true);
    try {
      const s = await api.mfaStatus();
      setMfaEnabled(s.enabled);
    } catch {
      setMfaEnabled(null);
    } finally {
      setMfaLoading(false);
    }
  }, []);

  function handleMfaToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (e.currentTarget.open) {
      void loadMfaStatus();
    }
  }

  async function enableWebOtpMfa() {
    setMfaBusy(true);
    try {
      await api.mfaEnableOtp();
      showStatus('Web OTP sign-in is enabled. After your password, you will use a one-time code shown in the app.', 'success');
      await loadMfaStatus();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Enable failed', 'error');
    } finally {
      setMfaBusy(false);
    }
  }

  async function disableMfa() {
    if (!confirm('Disable two-factor sign-in for this account?')) return;
    setMfaBusy(true);
    try {
      await api.mfaDisable();
      showStatus('MFA disabled.', 'success');
      await loadMfaStatus();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Disable failed', 'error');
    } finally {
      setMfaBusy(false);
    }
  }

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <div className="logo" aria-hidden="true">SE</div>
        <div className="topbar__title">SecureExam</div>
      </div>
      <div className="topbar__actions">
        <span className="role-chip" aria-live="polite">{role}</span>
        {showMfaControls && (
          <details className="topbar__mfa" onToggle={handleMfaToggle}>
            <summary className="topbar__mfa-summary">MFA</summary>
            <section className="topbar__mfa-panel" aria-label="Two-factor authentication">
              {mfaLoading && <p className="topbar__mfa-text">Loading…</p>}
              {!mfaLoading && mfaEnabled === null && (
                <p className="topbar__mfa-text">Could not load MFA status. Try again or refresh the page.</p>
              )}
              {!mfaLoading && mfaEnabled === true && (
                <div className="topbar__mfa-stack">
                  <p className="topbar__mfa-text">
                    Extra sign-in step is on: after your password, enter the one-time code shown in the SecureExam notification on the login screen.
                  </p>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={mfaBusy}
                    onClick={() => { void disableMfa(); }}
                  >
                    {mfaBusy ? 'Working…' : 'Disable MFA'}
                  </button>
                </div>
              )}
              {!mfaLoading && mfaEnabled === false && (
                <div className="topbar__mfa-stack">
                  <p className="topbar__mfa-text">
                    Turn on a second sign-in step. No authenticator app—each login shows a fresh code in the browser after your password.
                  </p>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={mfaBusy}
                    onClick={() => { void enableWebOtpMfa(); }}
                  >
                    {mfaBusy ? 'Please wait…' : 'Enable web OTP MFA'}
                  </button>
                </div>
              )}
            </section>
          </details>
        )}
        <button className="btn btn--ghost" type="button" onClick={logout}>
          Sign out
        </button>
      </div>
    </header>
  );
}
