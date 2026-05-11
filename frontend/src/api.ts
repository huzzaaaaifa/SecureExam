// File purpose: Typed API client — all fetch calls go through here.
// Tokens are stored in module memory only (never localStorage or cookies).

import type {
  AdminUser,
  AuditEntry,
  Exam,
  ExamQuestionPublic,
  ExamResultRow,
  ExamSubmission,
  LoginResult,
  MyPublishedResult,
  Role,
  SecurityAlert,
  Student,
  StudentExam,
} from './types';

let _token = '';
let _onUnauthenticated: (() => void) | null = null;

export function configureApi(onUnauthenticated: () => void): void {
  _onUnauthenticated = onUnauthenticated;
}

export function setToken(token: string): void { _token = token; }
export function clearToken(): void { _token = ''; }

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

type Endpoint =
  | 'login'
  | 'loginMfa'
  | 'loginMfaPreview'
  | 'mfaEnableOtp'
  | 'mfaDisable'
  | 'mfaStatus'
  | 'register'
  | 'forgotPassword'
  | 'forgotPasswordMfaPreview'
  | 'resetPassword'
  | 'assignedExams'
  | 'myResults'
  | 'submissions'
  | 'createExam'
  | 'assignExam'
  | 'exams'
  | 'students'
  | 'adminUsers'
  | 'securityAlerts'
  | 'auditLog';

type RequestOptions = RequestInit & { pathSuffix?: string };

function safePathSuffix(pathSuffix: string): string {
  if (!pathSuffix.startsWith('/') || pathSuffix.startsWith('//') || pathSuffix.length > 80) {
    throw new Error('Invalid endpoint suffix');
  }
  for (const ch of pathSuffix) {
    const code = ch.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    if (!isDigit && !isUpper && !isLower && ch !== '/' && ch !== '_' && ch !== '-') {
      throw new Error('Invalid endpoint suffix');
    }
  }
  return pathSuffix;
}

function endpointPath(endpoint: Endpoint): string {
  switch (endpoint) {
    case 'login': return '/api/auth/login';
    case 'loginMfa': return '/api/auth/login/mfa';
    case 'loginMfaPreview': return '/api/auth/login/mfa-preview';
    case 'mfaEnableOtp': return '/api/auth/mfa/enable-otp';
    case 'mfaDisable': return '/api/auth/mfa/disable';
    case 'mfaStatus': return '/api/auth/mfa/status';
    case 'register': return '/api/auth/register';
    case 'forgotPassword': return '/api/auth/forgot-password';
    case 'forgotPasswordMfaPreview': return '/api/auth/forgot-password/mfa-preview';
    case 'resetPassword': return '/api/auth/reset-password';
    case 'assignedExams': return '/api/exams/assigned';
    case 'myResults': return '/api/results/me';
    case 'submissions': return '/api/submissions';
    case 'createExam': return '/api/exams';
    case 'assignExam': return '/api/exams/assign';
    case 'exams': return '/api/exams';
    case 'students': return '/api/admin/users/students';
    case 'adminUsers': return '/api/admin/users';
    case 'securityAlerts': return '/api/admin/security-alerts';
    case 'auditLog': return '/api/admin/audit';
  }
}

function endpointUrl(endpoint: Endpoint, pathSuffix?: string): string {
  const base = endpointPath(endpoint);
  if (!pathSuffix) return base;
  return `${base}${safePathSuffix(pathSuffix)}`;
}

async function request<T>(endpoint: Endpoint, options: RequestOptions = {}): Promise<T> {
  const { pathSuffix, ...fetchInit } = options;
  const url = endpointUrl(endpoint, pathSuffix);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((fetchInit.headers ?? {}) as Record<string, string>),
  };
  if (_token) headers.Authorization = `Bearer ${_token}`;

  const requestInfo = new Request(url, { ...fetchInit, headers, cache: 'no-store' });
  const response = await fetch(requestInfo);

  if (response.status === 401 && _token) {
    clearToken();
    _onUnauthenticated?.();
    throw new ApiError(401, 'Session expired. Please sign in again.');
  }

  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, (data as { error?: string }).error ?? 'Request failed');
  }
  return data as T;
}

export const api = {
  login: async (email: string, password: string): Promise<LoginResult> => {
    const data = await request<{
      accessToken?: string;
      mfaRequired?: boolean;
      mfaToken?: string;
      mfaWebOtp?: boolean;
      role: Role;
      expiresInSeconds: number;
    }>('login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (data.mfaRequired && data.mfaToken) {
      return {
        mfaRequired: true,
        mfaToken: data.mfaToken,
        role: data.role,
        expiresInSeconds: data.expiresInSeconds,
        mfaWebOtp: Boolean(data.mfaWebOtp),
      };
    }
    if (data.accessToken) {
      return {
        mfaRequired: false,
        accessToken: data.accessToken,
        role: data.role,
        expiresInSeconds: data.expiresInSeconds,
      };
    }
    throw new ApiError(500, 'Unexpected login response');
  },

  loginMfa: (mfaToken: string, code: string) =>
    request<{ accessToken: string; role: Role; expiresInSeconds: number }>('loginMfa', {
      method: 'POST',
      body: JSON.stringify({ mfaToken, code }),
    }),

  /** Current web OTP for this MFA challenge (no Bearer token; JWT identifies user). */
  loginMfaPreview: (mfaToken: string) =>
    request<{ code: string }>('loginMfaPreview', {
      method: 'POST',
      body: JSON.stringify({ mfaToken }),
    }),

  mfaStatus: () =>
    request<{ enabled: boolean; eligible: boolean }>('mfaStatus', { method: 'GET' }),

  mfaEnableOtp: () =>
    request<{ ok: boolean }>('mfaEnableOtp', { method: 'POST' }),

  mfaDisable: () =>
    request<{ ok: boolean }>('mfaDisable', { method: 'POST' }),

  register: (email: string, password: string) =>
    request<{ id: number; email: string; role: Role }>('register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  forgotPassword: (email: string) =>
    request<{
      ok: boolean;
      resetToken: string | null;
      mfaRequired: boolean;
      mfaWebOtp: boolean;
    }>('forgotPassword', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  forgotPasswordMfaPreview: (resetToken: string) =>
    request<{ code: string }>('forgotPasswordMfaPreview', {
      method: 'POST',
      body: JSON.stringify({ resetToken }),
    }),

  resetPassword: (resetToken: string, newPassword: string, code?: string) =>
    request<{ ok: boolean }>('resetPassword', {
      method: 'POST',
      body: JSON.stringify({ resetToken, newPassword, ...(code ? { code } : {}) }),
    }),

  getAssignedExams: () =>
    request<{ exams: Exam[] }>('assignedExams'),

  getStudentExam: (examId: number) =>
    request<{ exam: StudentExam }>('exams', {
      method: 'GET',
      pathSuffix: `/${examId}`,
    }),

  getMyPublishedResults: () =>
    request<{ results: MyPublishedResult[] }>('myResults'),

  getExamResults: (examId: number) =>
    request<{ examId: number; results: ExamResultRow[] }>('exams', {
      method: 'GET',
      pathSuffix: `/${examId}/results`,
    }),

  getExamSubmissions: (examId: number) =>
    request<{ examId: number; submissions: ExamSubmission[] }>('exams', {
      method: 'GET',
      pathSuffix: `/${examId}/submissions`,
    }),

  patchExamResultScore: (examId: number, studentUserId: number, score: number) =>
    request<{ ok: boolean }>('exams', {
      method: 'PATCH',
      pathSuffix: `/${examId}/results/${studentUserId}`,
      body: JSON.stringify({ score }),
    }),

  publishExamResults: (examId: number, body: { studentUserId?: number } = {}) =>
    request<{ ok: boolean; publishedCount: number }>('exams', {
      method: 'POST',
      pathSuffix: `/${examId}/publish-results`,
      body: JSON.stringify(body),
    }),

  submitAnswers: (examId: number, nonce: string, answers: Record<string, string | number>) =>
    request<{ id: number; integrityHash: string; score: number }>('submissions', {
      method: 'POST',
      body: JSON.stringify({ examId, nonce, answers }),
    }),

  createExam: (
    title: string,
    startsAtUtc: string,
    endsAtUtc: string,
    questions?: ExamQuestionPublic[]
  ) =>
    request<{ id: number }>('createExam', {
      method: 'POST',
      body: JSON.stringify({ title, startsAtUtc, endsAtUtc, ...(questions?.length ? { questions } : {}) }),
    }),

  patchExam: (examId: number, body: { title?: string; startsAtUtc?: string; endsAtUtc?: string; questions?: ExamQuestionPublic[] }) =>
    request<{ ok: boolean; id: number }>('exams', {
      method: 'PATCH',
      pathSuffix: `/${examId}`,
      body: JSON.stringify(body),
    }),

  archiveExam: (examId: number) =>
    request<{ ok: boolean }>('exams', {
      method: 'DELETE',
      pathSuffix: `/${examId}`,
    }),

  assignExam: (examId: number, studentUserIds: number[]) =>
    request<{ ok: boolean; assignedCount: number; requestedCount: number }>('assignExam', {
      method: 'POST',
      body: JSON.stringify({ examId, studentUserIds }),
    }),

  getExams: () =>
    request<{ exams: Exam[] }>('exams'),

  getStudents: () =>
    request<{ students: Student[] }>('students'),

  getAdminUsers: () =>
    request<{ users: AdminUser[] }>('adminUsers'),

  createAdminUser: (email: string, password: string, role: Role) =>
    request<{ id: number; email: string; role: Role }>('adminUsers', {
      method: 'POST',
      body: JSON.stringify({ email, password, role }),
    }),

  patchAdminUser: (userId: number, body: { role?: Role; isActive?: boolean }) =>
    request<{ ok: boolean; id: number; role: Role; isActive: boolean }>('adminUsers', {
      method: 'PATCH',
      pathSuffix: `/${userId}`,
      body: JSON.stringify(body),
    }),

  adminProvisionMfa: (userId: number) =>
    request<{ ok: boolean }>('adminUsers', {
      method: 'POST',
      pathSuffix: `/${userId}/mfa-provision`,
    }),

  adminClearMfa: (userId: number) =>
    request<{ ok: boolean }>('adminUsers', {
      method: 'POST',
      pathSuffix: `/${userId}/mfa-clear`,
    }),

  deleteUser: (userId: number) =>
    request<{ ok: boolean }>('adminUsers', {
      method: 'DELETE',
      pathSuffix: `/${userId}`,
    }),

  getSecurityAlerts: () =>
    request<{ alerts: SecurityAlert[] }>('securityAlerts', { method: 'GET' }),

  getAuditLog: () =>
    request<{ audit: AuditEntry[] }>('auditLog'),
};
