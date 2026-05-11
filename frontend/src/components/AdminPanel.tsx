// File purpose: Admin-only user directory and audit log (server enforces RBAC).
// Security checks: React text rendering only; updates go through authenticated API.

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import type { AdminUser, AuditEntry, Role, SecurityAlert } from '../types';

function outcomeClass(outcome: AuditEntry['outcome']): string {
  if (outcome === 'allow') return 'audit-outcome audit-outcome--allow';
  if (outcome === 'deny')  return 'audit-outcome audit-outcome--deny';
  return 'audit-outcome audit-outcome--error';
}

function userIsActive(u: AdminUser): boolean {
  return Boolean(Number(u.isActive));
}

function isLockedOut(u: AdminUser): boolean {
  if (!u.lockUntilUtc) return false;
  return new Date(u.lockUntilUtc) > new Date();
}

function formatAlertDetails(json: string | null): string {
  if (!json) return '—';
  try {
    return JSON.stringify(JSON.parse(json));
  } catch {
    return json;
  }
}

function mfaOn(u: AdminUser): boolean {
  return Boolean(Number(u.mfaEnabled));
}

export default function AdminPanel() {
  const { showStatus, currentUserId } = useApp();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [usersError, setUsersError] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [rowBusy, setRowBusy] = useState<number | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<Role>('student');
  const [creatingUser, setCreatingUser] = useState(false);

  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [auditError, setAuditError] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);

  const [alerts, setAlerts] = useState<SecurityAlert[] | null>(null);
  const [alertsError, setAlertsError] = useState('');
  const [alertsLoading, setAlertsLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError('');
    try {
      const data = await api.getAdminUsers();
      setUsers(data.users);
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadAuditLog = useCallback(async () => {
    setAuditLoading(true);
    setAuditError('');
    try {
      const data = await api.getAuditLog();
      setEntries(data.audit);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const loadSecurityAlerts = useCallback(async () => {
    setAlertsLoading(true);
    setAlertsError('');
    try {
      const data = await api.getSecurityAlerts();
      setAlerts(data.alerts);
    } catch (err) {
      setAlertsError(err instanceof Error ? err.message : 'Failed to load security alerts');
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
    void loadAuditLog();
    void loadSecurityAlerts();
  }, [loadUsers, loadAuditLog, loadSecurityAlerts]);

  async function saveRole(user: AdminUser, role: Role) {
    if (role === user.role) return;
    setRowBusy(user.id);
    try {
      await api.patchAdminUser(user.id, { role });
      showStatus(`Role updated for ${user.email}.`, 'success');
      await loadUsers();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Update failed', 'error');
      await loadUsers();
    } finally {
      setRowBusy(null);
    }
  }

  async function setActive(user: AdminUser, isActive: boolean) {
    if (userIsActive(user) === isActive) return;
    setRowBusy(user.id);
    try {
      await api.patchAdminUser(user.id, { isActive });
      showStatus(`${user.email} is now ${isActive ? 'active' : 'inactive'}.`, 'success');
      await loadUsers();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Update failed', 'error');
      await loadUsers();
    } finally {
      setRowBusy(null);
    }
  }

  async function provisionMfa(user: AdminUser) {
    if (
      !confirm(
        `Enable web OTP sign-in for ${user.email}? They will see a one-time code in the browser after entering their password.`
      )
    ) {
      return;
    }
    setRowBusy(user.id);
    try {
      await api.adminProvisionMfa(user.id);
      showStatus(`Web OTP MFA enabled for ${user.email}.`, 'success');
      await loadUsers();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Provision failed', 'error');
    } finally {
      setRowBusy(null);
    }
  }

  async function clearMfa(user: AdminUser) {
    if (!confirm(`Remove MFA enrollment for ${user.email}? They will sign in with password only until MFA is set up again.`)) {
      return;
    }
    setRowBusy(user.id);
    try {
      await api.adminClearMfa(user.id);
      showStatus(`MFA cleared for ${user.email}.`, 'success');
      await loadUsers();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Clear failed', 'error');
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteUser(user: AdminUser) {
    if (!confirm(`Permanently delete ${user.email}? This cannot be undone.`)) return;
    setRowBusy(user.id);
    try {
      await api.deleteUser(user.id);
      showStatus(`Deleted ${user.email}.`, 'success');
      await loadUsers();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setRowBusy(null);
    }
  }

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 10) {
      showStatus('Password must be at least 10 characters.', 'error');
      return;
    }
    setCreatingUser(true);
    try {
      await api.createAdminUser(newEmail, newPassword, newRole);
      showStatus(`User created: ${newEmail.trim().toLowerCase()} (${newRole}).`, 'success');
      setNewEmail('');
      setNewPassword('');
      setNewRole('student');
      await loadUsers();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Create failed', 'error');
    } finally {
      setCreatingUser(false);
    }
  }

  return (
    <>
      <section className="card" aria-labelledby="users-heading">
        <div className="card__head">
          <h2 id="users-heading" className="card__title">Users</h2>
          <p className="card__lede">Create accounts, manage roles, and account status.</p>
        </div>
        <div className="card__body">
          <form className="form-stack" onSubmit={(e) => { void handleCreateUser(e); }}>
            <h3 className="section-label">Add user</h3>
            <div className="field-row">
              <div className="field field--grow">
                <label htmlFor="new-user-email">Email</label>
                <input
                  id="new-user-email"
                  type="email"
                  autoComplete="off"
                  required
                  value={newEmail}
                  onChange={(e) => { setNewEmail(e.target.value); }}
                />
              </div>
              <div className="field field--grow">
                <label htmlFor="new-user-password">Temporary password</label>
                <input
                  id="new-user-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); }}
                />
              </div>
              <div className="field">
                <label htmlFor="new-user-role">Role</label>
                <select
                  id="new-user-role"
                  value={newRole}
                  onChange={(e) => { setNewRole(e.target.value as Role); }}
                >
                  <option value="student">student</option>
                  <option value="instructor">instructor</option>
                  <option value="admin">admin</option>
                </select>
              </div>
            </div>
            <button
              type="submit"
              className="btn btn--primary btn--sm"
              disabled={creatingUser}
              aria-busy={creatingUser}
            >
              {creatingUser ? 'Creating…' : 'Create user'}
            </button>
          </form>

          <hr className="divider" />

          <div className="toolbar">
            <button
              className="btn btn--secondary"
              type="button"
              onClick={() => { void loadUsers(); }}
              disabled={usersLoading}
              aria-busy={usersLoading}
            >
              {usersLoading ? 'Loading…' : 'Refresh users'}
            </button>
          </div>
          {usersLoading && users === null && <div className="empty-state">Loading…</div>}
          {!usersLoading && usersError && (
            <div className="empty-state empty-state--error">{usersError}</div>
          )}
          {users && users.length === 0 && !usersError && (
            <div className="empty-state">No user accounts.</div>
          )}
          {users && users.length > 0 && (
            <section className="table-wrap" aria-label="User accounts">
              <table className="user-table">
                <thead>
                  <tr>
                    <th scope="col">ID</th>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col">MFA</th>
                    <th scope="col">Lock / fails</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => {
                    const active = userIsActive(u);
                    const busy = rowBusy === u.id;
                    return (
                      <tr key={u.id}>
                        <td>{u.id}</td>
                        <td className="user-table__email">{u.email}</td>
                        <td>
                          <label className="visually-hidden" htmlFor={`role-${u.id}`}>Role for user {u.id}</label>
                          <select
                            id={`role-${u.id}`}
                            className="user-table__select"
                            key={`${u.id}-${u.role}`}
                            defaultValue={u.role}
                            disabled={busy}
                            onChange={(e) => {
                              const roleSelect = e.currentTarget;
                              void saveRole(u, roleSelect.value as Role);
                            }}
                          >
                            <option value="student">student</option>
                            <option value="instructor">instructor</option>
                            <option value="admin">admin</option>
                          </select>
                        </td>
                        <td>{active ? 'Active' : 'Inactive'}</td>
                        <td>{mfaOn(u) ? 'On' : 'Off'}</td>
                        <td className="user-table__meta">
                          {isLockedOut(u) ? `Locked until ${u.lockUntilUtc}` : '—'}
                          {' · '}
                          fails: {u.failedLoginAttempts}
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
                            <button
                              type="button"
                              className={`btn btn--secondary btn--compact${active ? '' : ' btn--primary'}`}
                              disabled={busy}
                              aria-busy={busy}
                              onClick={() => { void setActive(u, !active); }}
                            >
                              {active ? 'Deactivate' : 'Activate'}
                            </button>
                            <button
                              type="button"
                              className="btn btn--secondary btn--compact"
                              disabled={busy}
                              onClick={() => { void provisionMfa(u); }}
                            >
                              Enable web OTP MFA
                            </button>
                            <button
                              type="button"
                              className="btn btn--secondary btn--compact"
                              disabled={busy}
                              onClick={() => { void clearMfa(u); }}
                            >
                              Clear MFA
                            </button>
                            {u.id !== currentUserId && (
                              <button
                                type="button"
                                className="btn btn--compact btn--danger"
                                disabled={busy}
                                onClick={() => { void deleteUser(u); }}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </section>

      <section className="card" aria-labelledby="alerts-heading">
        <div className="card__head">
          <h2 id="alerts-heading" className="card__title">Security alerts</h2>
          <p className="card__lede">Automated signals (e.g. lockouts, repeated login failures). Review alongside the audit log.</p>
        </div>
        <div className="card__body">
          <div className="toolbar">
            <button
              className="btn btn--secondary"
              type="button"
              onClick={() => { void loadSecurityAlerts(); }}
              disabled={alertsLoading}
              aria-busy={alertsLoading}
            >
              {alertsLoading ? 'Loading…' : 'Refresh alerts'}
            </button>
          </div>
          {alertsLoading && alerts === null && <div className="empty-state">Loading…</div>}
          {!alertsLoading && alertsError && (
            <div className="empty-state empty-state--error">{alertsError}</div>
          )}
          {alerts && alerts.length === 0 && !alertsError && (
            <div className="empty-state">No security alerts recorded.</div>
          )}
          {alerts && alerts.length > 0 && (
            <section className="table-wrap" aria-label="Security alerts">
              <table className="user-table">
                <thead>
                  <tr>
                    <th scope="col">ID</th>
                    <th scope="col">Time (UTC)</th>
                    <th scope="col">Type</th>
                    <th scope="col">IP</th>
                    <th scope="col">Ack</th>
                    <th scope="col">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map(a => (
                    <tr key={a.id}>
                      <td>{a.id}</td>
                      <td className="user-table__meta">{a.tsUtc}</td>
                      <td>{a.type}</td>
                      <td className="user-table__meta">{a.ip ?? '—'}</td>
                      <td>{Boolean(Number(a.acknowledged)) ? 'Yes' : 'No'}</td>
                      <td className="user-table__meta" style={{ maxWidth: '280px', wordBreak: 'break-word' }}>
                        {formatAlertDetails(a.detailsJson)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </section>

      <section className="card" aria-labelledby="admin-heading">
        <div className="card__head">
          <h2 id="admin-heading" className="card__title">Audit log</h2>
          <p className="card__lede">Recent events (administrators).</p>
        </div>
        <div className="card__body">
          <div className="toolbar">
            <button
              className="btn btn--secondary"
              type="button"
              onClick={() => { void loadAuditLog(); }}
              disabled={auditLoading}
              aria-busy={auditLoading}
            >
              {auditLoading ? 'Loading…' : 'Refresh audit'}
            </button>
          </div>
          <div className="list list--audit" aria-live="polite">
            {auditLoading && entries === null && <div className="empty-state">Loading…</div>}
            {!auditLoading && auditError && (
              <div className="empty-state empty-state--error">{auditError}</div>
            )}
            {!auditLoading && !auditError && entries?.length === 0 && (
              <div className="empty-state">No audit records yet.</div>
            )}
            {!auditLoading && entries?.map(entry => (
              <article key={entry.id} className="list-item list-item--audit">
                <div>
                  <strong>#{entry.id}</strong>{' '}
                  {entry.tsUtc} · {entry.action}
                  <span className={outcomeClass(entry.outcome)}>{entry.outcome}</span>
                </div>
                <div className="list-item__meta">
                  Actor: {entry.actorRole ?? 'system'} · Resource: {entry.resourceType}
                  {entry.resourceId ? ` #${entry.resourceId}` : ''}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
