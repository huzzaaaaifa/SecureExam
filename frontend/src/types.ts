// File purpose: Shared TypeScript types used across the client.

export type ExamPhase = 'upcoming' | 'active' | 'ended';

export interface Exam {
  id: number;
  title: string;
  starts_at_utc: string;
  ends_at_utc: string;
  questionsJson?: string;
  archived?: number | boolean;
  /** Present on GET /api/exams/assigned (student). */
  phase?: ExamPhase;
}

/** Question shown to students (no answer key). */
export interface ExamQuestionPublic {
  id: string;
  type: 'text' | 'mcq';
  prompt?: string;
  points?: number;
  options?: string[];
  /** Instructor-only when authoring MCQs; never returned to students. */
  correctIndex?: number;
}

/** Full exam payload from GET /api/exams/:id during the exam window. */
export interface StudentExam {
  id: number;
  title: string;
  starts_at_utc: string;
  ends_at_utc: string;
  questions: ExamQuestionPublic[];
}

export interface ExamSubmission {
  id: number;
  studentUserId: number;
  email: string;
  submittedAtUtc: string;
  integrityHash: string;
  answersJson: string;
}

export interface SecurityAlert {
  id: number;
  tsUtc: string;
  type: string;
  detailsJson: string | null;
  ip: string | null;
  acknowledged: number | boolean;
}

export interface AuditEntry {
  id: number;
  tsUtc: string;
  actorUserId: number | null;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: 'allow' | 'deny' | 'error';
  ip: string | null;
  userAgent: string | null;
  prevHash: string | null;
  hash: string;
}

export interface Student {
  id: number;
  email: string;
}

/** Published result visible to the owning student. */
export interface MyPublishedResult {
  examId: number;
  examTitle: string;
  score: number;
  updatedAtUtc: string;
}

/** Instructor view of one row in the results roster for an exam. */
export interface ExamResultRow {
  studentUserId: number;
  email: string;
  score: number;
  published: number | boolean;
  updatedAtUtc: string;
}

export type Role = 'student' | 'instructor' | 'admin';

export type LoginResult =
  | { mfaRequired: false; accessToken: string; role: Role; expiresInSeconds: number }
  | {
      mfaRequired: true;
      mfaToken: string;
      role: Role;
      expiresInSeconds: number;
      /** Server issues a web-only OTP for this sign-in (bound to mfaToken). */
      mfaWebOtp?: boolean;
    };

/** Directory row returned to administrators only (no secrets). */
export interface AdminUser {
  id: number;
  email: string;
  role: Role;
  isActive: number | boolean;
  lockUntilUtc: string | null;
  failedLoginAttempts: number;
  createdAtUtc: string;
  /** 1 when web OTP MFA is enabled for this account. */
  mfaEnabled?: number | boolean;
}
export type StatusVariant = 'success' | 'error' | 'neutral';

export interface AppStatus {
  message: string;
  variant: StatusVariant;
}
