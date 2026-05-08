// File purpose: Student dashboard — assigned exams, server-driven questions, one-shot submit.
// Security checks: exam content from GET /api/exams/:id only; nonce + integrity on submit.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import { createNonce } from '../utils';
import type { Exam, MyPublishedResult, StudentExam } from '../types';

export default function StudentPanel() {
  const { showStatus } = useApp();

  const [published, setPublished] = useState<MyPublishedResult[] | null>(null);
  const [resultsError, setResultsError] = useState('');
  const [loadingResults, setLoadingResults] = useState(true);

  const [exams, setExams] = useState<Exam[] | null>(null);
  const [examsError, setExamsError] = useState('');
  const [loadingExams, setLoadingExams] = useState(false);

  const [selectedExamId, setSelectedExamId] = useState<number | null>(null);
  const [examDetail, setExamDetail] = useState<StudentExam | null>(null);
  const [examLoadError, setExamLoadError] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const submissionFormRef = useRef<HTMLFormElement>(null);

  const loadExams = useCallback(async () => {
    setLoadingExams(true);
    setExamsError('');
    try {
      const data = await api.getAssignedExams();
      setExams(data.exams);
    } catch (err) {
      setExamsError(err instanceof Error ? err.message : 'Failed to load exams');
    } finally {
      setLoadingExams(false);
    }
  }, []);

  const loadPublishedResults = useCallback(async () => {
    setLoadingResults(true);
    setResultsError('');
    try {
      const data = await api.getMyPublishedResults();
      setPublished(data.results);
    } catch (err) {
      setResultsError(err instanceof Error ? err.message : 'Failed to load results');
    } finally {
      setLoadingResults(false);
    }
  }, []);

  useEffect(() => {
    void loadExams();
    void loadPublishedResults();
  }, [loadExams, loadPublishedResults]);

  async function selectExam(exam: Exam) {
    setSelectedExamId(exam.id);
    setExamDetail(null);
    setExamLoadError('');
    setSubmitted(false);
    submissionFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const data = await api.getStudentExam(exam.id);
      setExamDetail(data.exam);
      const init: Record<string, string> = {};
      for (const q of data.exam.questions) {
        init[q.id] = '';
      }
      setAnswers(init);
    } catch (err) {
      setExamLoadError(err instanceof Error ? err.message : 'Could not load exam');
    }
  }

  function setAnswer(id: string, value: string) {
    setAnswers(prev => ({ ...prev, [id]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedExamId || !examDetail) return;
    if (!confirm(`Submit exam #${selectedExamId}? This cannot be undone.`)) return;
    setSubmitting(true);
    try {
      const payload: Record<string, string | number> = {};
      for (const q of examDetail.questions) {
        const raw = answers[q.id] ?? '';
        if (q.type === 'mcq') {
          const n = Number(raw);
          payload[q.id] = Number.isFinite(n) ? n : raw;
        } else {
          payload[q.id] = raw;
        }
      }
      const result = await api.submitAnswers(selectedExamId, createNonce(), payload);
      showStatus(`Submitted (score ${result.score}, ID ${result.id}).`, 'success');
      setSubmitted(true);
      void loadPublishedResults();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Submission failed', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card" aria-labelledby="student-heading">
      <div className="card__head">
        <h2 id="student-heading" className="card__title">Student</h2>
        <p className="card__lede">Your exams, server-provided questions, and published scores.</p>
      </div>

      <div className="card__body">
        <h3 className="section-label">Published results</h3>
        <p className="card__lede card__lede--tight">
          Scores appear after your instructor publishes them.
        </p>
        <div className="toolbar">
          <button
            className="btn btn--secondary btn--sm"
            type="button"
            onClick={() => { void loadPublishedResults(); }}
            disabled={loadingResults}
            aria-busy={loadingResults}
          >
            {loadingResults ? 'Loading…' : 'Refresh results'}
          </button>
        </div>
        <div className="list list--exams" aria-live="polite">
          {loadingResults && published === null && <div className="empty-state">Loading…</div>}
          {!loadingResults && resultsError && (
            <div className="empty-state empty-state--error">{resultsError}</div>
          )}
          {!loadingResults && !resultsError && published?.length === 0 && (
            <div className="empty-state">No published results yet.</div>
          )}
          {!loadingResults && published?.map(r => (
            <article key={`${r.examId}-${r.updatedAtUtc}`} className="list-item">
              <div className="list-item__title">{r.examTitle}</div>
              <div className="list-item__meta">
                Exam #{r.examId} · Score: <strong>{r.score}</strong> · Updated {r.updatedAtUtc}
              </div>
            </article>
          ))}
        </div>
      </div>

      <hr className="divider" />

      <div className="card__body">
        <h3 className="section-label">Assigned exams</h3>
        <div className="toolbar">
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => { void loadExams(); }}
            disabled={loadingExams}
            aria-busy={loadingExams}
          >
            {loadingExams ? 'Loading…' : 'Refresh assignments'}
          </button>
        </div>
        <div className="list list--exams" aria-live="polite">
          {loadingExams && <div className="empty-state">Loading…</div>}
          {!loadingExams && examsError && (
            <div className="empty-state empty-state--error">{examsError}</div>
          )}
          {!loadingExams && !examsError && exams?.length === 0 && (
            <div className="empty-state">No assigned exams.</div>
          )}
          {!loadingExams && exams?.map(exam => {
            const phase = exam.phase ?? 'active';
            const canOpen = phase === 'active';
            const phaseNote =
              phase === 'upcoming'
                ? 'Not open yet — load becomes available at the start time.'
                : phase === 'ended'
                  ? 'Window ended — answers can no longer be loaded for submission.'
                  : null;
            return (
              <article key={exam.id} className="list-item list-item--selectable">
                <div className="list-item__title">{exam.title}</div>
                <div className="list-item__meta">
                  Exam #{exam.id} · {exam.starts_at_utc} → {exam.ends_at_utc}
                  {exam.phase && (
                    <span className="user-table__meta" style={{ display: 'block', marginTop: 4 }}>
                      Status: {phase}
                    </span>
                  )}
                  {phaseNote && (
                    <span className="user-table__meta" style={{ display: 'block', marginTop: 4 }}>
                      {phaseNote}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => { void selectExam(exam); }}
                  disabled={(!canOpen) || (submitted && selectedExamId === exam.id)}
                >
                  {canOpen ? 'Load exam and answer' : 'Unavailable'}
                </button>
              </article>
            );
          })}
        </div>
      </div>

      <hr className="divider" />

      <form ref={submissionFormRef} className="form-stack" onSubmit={(e) => { void handleSubmit(e); }}>
        <h3 className="section-label">Submit answers</h3>
        <div className="field-row">
          <div className="field field--grow">
            <label htmlFor="submitExamId">Exam ID</label>
            <input
              id="submitExamId"
              type="number"
              min={1}
              required
              readOnly
              value={selectedExamId ?? ''}
              onChange={() => {}}
            />
          </div>
        </div>
        {examLoadError && <div className="empty-state empty-state--error">{examLoadError}</div>}
        {examDetail && (
          <>
            {examDetail.questions.map(q => (
              <div className="field" key={q.id}>
                <label htmlFor={`ans-${q.id}`}>
                  {q.prompt ?? q.id}
                  {typeof q.points === 'number' ? ` (${q.points} pts)` : ''}
                </label>
                {q.type === 'mcq' && q.options?.length ? (
                  <select
                    id={`ans-${q.id}`}
                    required
                    value={answers[q.id] ?? ''}
                    disabled={submitted}
                    onChange={(e) => { setAnswer(q.id, e.target.value); }}
                  >
                    <option value="" disabled>— choose —</option>
                    {q.options.map((opt, idx) => (
                      <option key={`${q.id}-${opt}`} value={idx}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <textarea
                    id={`ans-${q.id}`}
                    maxLength={2000}
                    rows={3}
                    required
                    placeholder="Your answer"
                    value={answers[q.id] ?? ''}
                    disabled={submitted}
                    onChange={(e) => { setAnswer(q.id, e.target.value); }}
                  />
                )}
              </div>
            ))}
          </>
        )}
        <button
          className="btn btn--primary"
          type="submit"
          disabled={submitting || submitted || !selectedExamId || !examDetail}
          aria-busy={submitting}
        >
          {submitted ? 'Submitted' : submitting ? 'Submitting…' : 'Submit once'}
        </button>
      </form>
    </section>
  );
}
