// File purpose: Sign-in / register + optional web-OTP second step when MFA is enabled for the account.
// Security checks: MFA token is short-lived; credentials cleared after success.
// When the server returns mfaWebOtp, the current sign-in code is shown in a web notification (no authenticator app).

import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import type { Role } from '../types';

interface Props {
  onLogin: (token: string, role: Role) => void;
}

type AuthMode = 'login' | 'register';

interface MfaStepState {
  token: string;
  webOtp: boolean;
}

type ForgotFlow =
  | 'email'
  | {
      resetToken: string;
      mfaRequired: boolean;
      mfaWebOtp: boolean;
    };

function sameFormSecret(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export default function LoginForm({ onLogin }: Props) {
  const { showStatus } = useApp();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [mfaStep, setMfaStep] = useState<MfaStepState | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [simPreviewCode, setSimPreviewCode] = useState('');
  const [simPreviewErr, setSimPreviewErr] = useState('');
  const [forgotFlow, setForgotFlow] = useState<ForgotFlow | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetSimPreviewCode, setResetSimPreviewCode] = useState('');
  const [resetSimPreviewErr, setResetSimPreviewErr] = useState('');

  useEffect(() => {
    if (!mfaStep?.webOtp) {
      setSimPreviewCode('');
      setSimPreviewErr('');
      return;
    }
    const { token } = mfaStep;
    let cancelled = false;
    function tick() {
      api.loginMfaPreview(token).then(({ code }) => {
        if (!cancelled) {
          setSimPreviewCode(code);
          setSimPreviewErr('');
        }
      }).catch(() => {
        if (!cancelled) {
          setSimPreviewCode('');
          setSimPreviewErr('Could not load sign-in code (invalid step or code expired).');
        }
      });
    }
    tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [mfaStep]);

  useEffect(() => {
    if (!forgotFlow || forgotFlow === 'email' || !forgotFlow.mfaWebOtp) {
      setResetSimPreviewCode('');
      setResetSimPreviewErr('');
      return;
    }
    const { resetToken } = forgotFlow;
    let cancelled = false;
    function tick() {
      api.forgotPasswordMfaPreview(resetToken).then(({ code }) => {
        if (!cancelled) {
          setResetSimPreviewCode(code);
          setResetSimPreviewErr('');
        }
      }).catch(() => {
        if (!cancelled) {
          setResetSimPreviewCode('');
          setResetSimPreviewErr('Could not load reset code (invalid step or code expired).');
        }
      });
    }
    tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [forgotFlow]);

  function exitForgotFlow() {
    setForgotFlow(null);
    setResetNewPassword('');
    setResetConfirm('');
    setTotpCode('');
    setResetSimPreviewCode('');
    setResetSimPreviewErr('');
    showStatus('');
  }

  async function handleForgotEmail(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await api.forgotPassword(email);
      if (!data.resetToken) {
        showStatus(
          'If an account exists for that email, you can continue reset from the app (demo: no email is sent).',
          'neutral'
        );
        exitForgotFlow();
        return;
      }
      setForgotFlow({
        resetToken: data.resetToken,
        mfaRequired: data.mfaRequired,
        mfaWebOtp: Boolean(data.mfaWebOtp),
      });
      setResetNewPassword('');
      setResetConfirm('');
      setTotpCode('');
      if (data.mfaWebOtp) {
        showStatus(
          'Use the SecureExam notification for your one-time reset code, or type it below.',
          'neutral'
        );
      } else {
        showStatus('Choose a new password for your account.', 'neutral');
      }
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Request failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (forgotFlow === null || forgotFlow === 'email') return;
    const { resetToken, mfaRequired } = forgotFlow;
    if (!sameFormSecret(resetNewPassword, resetConfirm)) {
      showStatus('Passwords do not match.', 'error');
      return;
    }
    if (resetNewPassword.length < 10) {
      showStatus('Password must be at least 10 characters.', 'error');
      return;
    }
    if (mfaRequired) {
      const c = totpCode.trim();
      if (!c) {
        showStatus('Enter the one-time code from your notification.', 'error');
        return;
      }
    }
    setLoading(true);
    try {
      await api.resetPassword(
        resetToken,
        resetNewPassword,
        mfaRequired ? totpCode.trim() : undefined
      );
      showStatus('Password updated. You can sign in with your new password.', 'success');
      exitForgotFlow();
      setPassword('');
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Reset failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await api.login(email, password);
      if (data.mfaRequired) {
        setMfaStep({ token: data.mfaToken, webOtp: Boolean(data.mfaWebOtp) });
        setTotpCode('');
        showStatus(
          data.mfaWebOtp
            ? 'Use the SecureExam notification for your one-time sign-in code, or type it below.'
            : 'Enter the 6-digit sign-in code.',
          'neutral'
        );
        return;
      }
      onLogin(data.accessToken, data.role);
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Login failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaComplete(e: FormEvent) {
    e.preventDefault();
    const code = totpCode.trim();
    if (!mfaStep || !code) return;
    setLoading(true);
    try {
      const data = await api.loginMfa(mfaStep.token, code);
      setMfaStep(null);
      setTotpCode('');
      onLogin(data.accessToken, data.role);
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Invalid code', 'error');
    } finally {
      setLoading(false);
    }
  }

  function cancelMfa() {
    setMfaStep(null);
    setTotpCode('');
    setSimPreviewCode('');
    setSimPreviewErr('');
    showStatus('');
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    if (!sameFormSecret(password, confirmPassword)) {
      showStatus('Passwords do not match.', 'error');
      return;
    }
    if (password.length < 10) {
      showStatus('Password must be at least 10 characters.', 'error');
      return;
    }
    setLoading(true);
    try {
      await api.register(email, password);
      showStatus('Account created as a student. You can sign in now.', 'success');
      setMode('login');
      setConfirmPassword('');
      setPassword('');
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Registration failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  const inForgotEmail = forgotFlow === 'email';
  const inForgotReset = forgotFlow !== null && forgotFlow !== 'email';

  const headingId =
    inForgotEmail || inForgotReset ? 'forgot-heading' : mode === 'login' ? 'login-heading' : 'register-heading';
  const title = mfaStep
    ? 'Two-factor authentication'
    : inForgotEmail
      ? 'Forgot password'
      : inForgotReset
        ? 'Set a new password'
        : mode === 'login'
          ? 'Sign in'
          : 'Create student account';
  const lede = mfaStep
    ? mfaStep.webOtp
      ? 'Your password was accepted. A one-time code was issued for your account—check the SecureExam notification.'
      : 'Your password was accepted. Enter your one-time sign-in code.'
    : inForgotEmail
      ? 'Enter the email for your student or instructor account. MFA is required at reset when enabled on the account.'
      : inForgotReset
        ? forgotFlow.mfaWebOtp
          ? 'Enter a new password and the one-time code from the SecureExam notification.'
          : 'Enter and confirm your new password.'
        : mode === 'login'
          ? 'Enter your email and password to continue.'
          : 'New accounts are students only. Instructors and admins are assigned by an administrator.';

  return (
    <section className="card card--accent" aria-labelledby={headingId}>
      {inForgotReset && forgotFlow.mfaWebOtp && (
        <div className="mfa-sim-toast" role="status" aria-live="polite" aria-atomic="true">
          <div className="mfa-sim-toast__app">SecureExam</div>
          <div className="mfa-sim-toast__title">Your password reset code</div>
          {resetSimPreviewErr ? (
            <div className="mfa-sim-toast__err">{resetSimPreviewErr}</div>
          ) : (
            <div className="mfa-sim-toast__code">{resetSimPreviewCode || '…'}</div>
          )}
          <p className="mfa-sim-toast__hint">Delivered in-app for this reset only (bound to your reset session).</p>
          {resetSimPreviewCode && (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              style={{ marginTop: 8 }}
              onClick={() => { setTotpCode(resetSimPreviewCode); }}
            >
              Insert code into form
            </button>
          )}
        </div>
      )}
      {mfaStep?.webOtp && (
        <div className="mfa-sim-toast" role="status" aria-live="polite" aria-atomic="true">
          <div className="mfa-sim-toast__app">SecureExam</div>
          <div className="mfa-sim-toast__title">Your sign-in code</div>
          {simPreviewErr ? (
            <div className="mfa-sim-toast__err">{simPreviewErr}</div>
          ) : (
            <div className="mfa-sim-toast__code">{simPreviewCode || '…'}</div>
          )}
          <p className="mfa-sim-toast__hint">Delivered in-app for this sign-in only (bound to your session).</p>
          {simPreviewCode && (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              style={{ marginTop: 8 }}
              onClick={() => { setTotpCode(simPreviewCode); }}
            >
              Insert code into form
            </button>
          )}
        </div>
      )}
      <div className="card__head card__head--center">
        <h1 className="app-title">SecureExam</h1>
        {!mfaStep && !forgotFlow && (
          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              className={`auth-tabs__tab${mode === 'login' ? ' auth-tabs__tab--active' : ''}`}
              aria-selected={mode === 'login'}
              onClick={() => { setMode('login'); showStatus(''); }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              className={`auth-tabs__tab${mode === 'register' ? ' auth-tabs__tab--active' : ''}`}
              aria-selected={mode === 'register'}
              onClick={() => { setMode('register'); showStatus(''); }}
            >
              Register
            </button>
          </div>
        )}
        <h2 id={headingId} className="card__title">
          {title}
        </h2>
        <p className="card__lede">{lede}</p>
      </div>
      {mfaStep ? (
        <form className="form-stack" onSubmit={(e) => { void handleMfaComplete(e); }}>
          <div className="field">
            <label htmlFor="mfa-code">One-time sign-in code</label>
            <input
              id="mfa-code"
              name="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              minLength={6}
              maxLength={12}
              value={totpCode}
              onChange={(e) => { setTotpCode(e.target.value); }}
            />
          </div>
          <div className="field-row">
            <button className="btn btn--primary" type="submit" disabled={loading} aria-busy={loading}>
              {loading ? 'Verifying…' : 'Continue'}
            </button>
            <button className="btn btn--secondary" type="button" onClick={cancelMfa} disabled={loading}>
              Back
            </button>
          </div>
        </form>
      ) : inForgotEmail ? (
        <form className="form-stack" onSubmit={(e) => { void handleForgotEmail(e); }}>
          <div className="field">
            <label htmlFor="forgot-email">Email</label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="username"
              required
              placeholder="you@university.edu"
              value={email}
              onChange={(e) => { setEmail(e.target.value); }}
            />
          </div>
          <div className="field-row">
            <button className="btn btn--primary" type="submit" disabled={loading} aria-busy={loading}>
              {loading ? 'Sending…' : 'Continue'}
            </button>
            <button className="btn btn--secondary" type="button" onClick={exitForgotFlow} disabled={loading}>
              Back
            </button>
          </div>
        </form>
      ) : inForgotReset ? (
        <form className="form-stack" onSubmit={(e) => { void handleResetPasswordSubmit(e); }}>
          <div className="field">
            <label htmlFor="reset-new">New password</label>
            <input
              id="reset-new"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={resetNewPassword}
              onChange={(e) => { setResetNewPassword(e.target.value); }}
            />
            <span className="field__hint">At least 10 characters (server-enforced).</span>
          </div>
          <div className="field">
            <label htmlFor="reset-confirm">Confirm new password</label>
            <input
              id="reset-confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={resetConfirm}
              onChange={(e) => { setResetConfirm(e.target.value); }}
            />
          </div>
          {forgotFlow.mfaRequired && (
            <div className="field">
              <label htmlFor="reset-mfa-code">One-time reset code</label>
              <input
                id="reset-mfa-code"
                name="reset-mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                minLength={6}
                maxLength={12}
                value={totpCode}
                onChange={(e) => { setTotpCode(e.target.value); }}
              />
            </div>
          )}
          <div className="field-row">
            <button className="btn btn--primary" type="submit" disabled={loading} aria-busy={loading}>
              {loading ? 'Updating…' : 'Update password'}
            </button>
            <button className="btn btn--secondary" type="button" onClick={exitForgotFlow} disabled={loading}>
              Cancel
            </button>
          </div>
        </form>
      ) : mode === 'login' ? (
        <form className="form-stack" onSubmit={(e) => { void handleLogin(e); }}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              placeholder="you@university.edu"
              value={email}
              onChange={(e) => { setEmail(e.target.value); }}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => { setPassword(e.target.value); }}
            />
            <button
              type="button"
              className="btn btn--text-action"
              onClick={() => {
                setForgotFlow('email');
                showStatus('');
              }}
            >
              Forgot password?
            </button>
          </div>
          <button
            className="btn btn--primary"
            type="submit"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      ) : (
        <form className="form-stack" onSubmit={(e) => { void handleRegister(e); }}>
          <div className="field">
            <label htmlFor="reg-email">Email</label>
            <input
              id="reg-email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@university.edu"
              value={email}
              onChange={(e) => { setEmail(e.target.value); }}
            />
          </div>
          <div className="field">
            <label htmlFor="reg-password">Password</label>
            <input
              id="reg-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={password}
              onChange={(e) => { setPassword(e.target.value); }}
            />
            <span className="field__hint">At least 10 characters (server-enforced).</span>
          </div>
          <div className="field">
            <label htmlFor="reg-confirm">Confirm password</label>
            <input
              id="reg-confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); }}
            />
          </div>
          <button
            className="btn btn--primary"
            type="submit"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      )}
    </section>
  );
}
