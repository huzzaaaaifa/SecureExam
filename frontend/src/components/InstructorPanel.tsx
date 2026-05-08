// File purpose: Instructor dashboard — exams with JSON questions, assign, grade, publish, archive.
// Security checks: dates validated client-side; server enforces ownership and RBAC.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import { toUtcIso } from '../utils';
import type { Exam, ExamQuestionPublic, ExamResultRow, ExamSubmission, Student } from '../types';

const DEFAULT_QUESTIONS_JSON = `[
  {"id":"q1","type":"text","points":5,"prompt":"Question 1"},
  {"id":"q2","type":"text","points":5,"prompt":"Question 2"}
]`;

function formatAnswersJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default function InstructorPanel() {
  const { showStatus } = useApp();

  const [resultsExamId, setResultsExamId] = useState<number | null>(null);
  const [resultsTitle, setResultsTitle] = useState('');
  const [resultRows, setResultRows] = useState<ExamResultRow[] | null>(null);
  const [submissionRows, setSubmissionRows] = useState<ExamSubmission[] | null>(null);
  const [resultsError, setResultsError] = useState('');
  const [resultsLoading, setResultsLoading] = useState(false);
  const [publishing, setPublishing] = useState<number | 'all' | null>(null);
  const [scoreBusy, setScoreBusy] = useState<number | null>(null);
  const [draftScores, setDraftScores] = useState<Record<number, string>>({});

  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [questionsJson, setQuestionsJson] = useState(DEFAULT_QUESTIONS_JSON);
  const [creating, setCreating] = useState(false);

  const [exams, setExams] = useState<Exam[] | null>(null);
  const [examsError, setExamsError] = useState('');
  const [loadingExams, setLoadingExams] = useState(false);

  const [assignExamId, setAssignExamId] = useState<number | null>(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [assigning, setAssigning] = useState(false);

  const assignFormRef = useRef<HTMLFormElement>(null);

  function applyResultRows(rows: ExamResultRow[]) {
    const nextDraftScores: Record<number, string> = {};
    for (const row of rows) {
      nextDraftScores[row.studentUserId] = String(row.score);
    }
    setResultRows(rows);
    setDraftScores(nextDraftScores);
  }

  const loadExams = useCallback(async () => {
    setLoadingExams(true);
    setExamsError('');
    try {
      const data = await api.getExams();
      setExams(data.exams);
    } catch (err) {
      setExamsError(err instanceof Error ? err.message : 'Failed to load exams');
    } finally {
      setLoadingExams(false);
    }
  }, []);

  const loadStudents = useCallback(async () => {
    try {
      const data = await api.getStudents();
      setStudents(data.students);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadExams();
    void loadStudents();
  }, [loadExams, loadStudents]);

  async function handleCreateExam(e: React.FormEvent) {
    e.preventDefault();
    let startsAtUtc: string;
    let endsAtUtc: string;
    let questions: ExamQuestionPublic[];
    try {
      startsAtUtc = toUtcIso(startsAt);
      endsAtUtc = toUtcIso(endsAt);
      questions = JSON.parse(questionsJson) as ExamQuestionPublic[];
      if (!Array.isArray(questions) || questions.length === 0) {
        showStatus('Questions must be a non-empty JSON array.', 'error');
        return;
      }
    } catch {
      showStatus('Invalid dates or questions JSON.', 'error');
      return;
    }
    setCreating(true);
    try {
      const data = await api.createExam(title, startsAtUtc, endsAtUtc, questions);
      showStatus(`Exam created (ID ${data.id}).`, 'success');
      setTitle('');
      setStartsAt('');
      setEndsAt('');
      setQuestionsJson(DEFAULT_QUESTIONS_JSON);
      void loadExams();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Create failed', 'error');
    } finally {
      setCreating(false);
    }
  }

  function selectExamForAssign(exam: Exam) {
    setAssignExamId(exam.id);
    setSelectedStudentIds([]);
    assignFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function toggleStudentSelected(id: number) {
    setSelectedStudentIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }

  function selectAllStudents() {
    setSelectedStudentIds(students.map(s => s.id));
  }

  function clearStudentSelection() {
    setSelectedStudentIds([]);
  }

  async function openResultsForExam(exam: Exam) {
    setResultsExamId(exam.id);
    setResultsTitle(exam.title);
    setResultRows(null);
    setDraftScores({});
    setSubmissionRows(null);
    setResultsError('');
    setResultsLoading(true);
    try {
      const [resData, subData] = await Promise.all([
        api.getExamResults(exam.id),
        api.getExamSubmissions(exam.id),
      ]);
      applyResultRows(resData.results);
      setSubmissionRows(subData.submissions);
    } catch (err) {
      setResultsError(err instanceof Error ? err.message : 'Failed to load results');
    } finally {
      setResultsLoading(false);
    }
  }

  async function saveScore(studentUserId: number, scoreStr: string) {
    if (!resultsExamId) return;
    const score = Number(scoreStr);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      showStatus('Score must be 0–100.', 'error');
      return;
    }
    setScoreBusy(studentUserId);
    try {
      await api.patchExamResultScore(resultsExamId, studentUserId, score);
      showStatus('Score updated (draft until published).', 'success');
      const data = await api.getExamResults(resultsExamId);
      applyResultRows(data.results);
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Update failed', 'error');
    } finally {
      setScoreBusy(null);
    }
  }

  async function publishOne(sid: number) {
    if (!resultsExamId) return;
    setPublishing(sid);
    try {
      const out = await api.publishExamResults(resultsExamId, { studentUserId: sid });
      showStatus(`Published (${out.publishedCount} row).`, 'success');
      const data = await api.getExamResults(resultsExamId);
      applyResultRows(data.results);
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Publish failed', 'error');
    } finally {
      setPublishing(null);
    }
  }

  async function publishAllUnpublished() {
    if (!resultsExamId) return;
    if (!confirm('Publish all unpublished results for this exam?')) return;
    setPublishing('all');
    try {
      const out = await api.publishExamResults(resultsExamId, {});
      showStatus(`Published ${out.publishedCount} result(s).`, 'success');
      const data = await api.getExamResults(resultsExamId);
      applyResultRows(data.results);
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Publish failed', 'error');
    } finally {
      setPublishing(null);
    }
  }

  async function archiveExam(exam: Exam) {
    if (!confirm(`Archive exam #${exam.id}? Students lose access; existing submissions remain.`)) return;
    try {
      await api.archiveExam(exam.id);
      showStatus('Exam archived.', 'success');
      if (resultsExamId === exam.id) {
        setResultsExamId(null);
        setResultRows(null);
        setDraftScores({});
        setSubmissionRows(null);
      }
      void loadExams();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Archive failed', 'error');
    }
  }

  async function handleAssignExam(e: React.FormEvent) {
    e.preventDefault();
    if (!assignExamId || selectedStudentIds.length === 0) return;
    setAssigning(true);
    try {
      const out = await api.assignExam(assignExamId, selectedStudentIds);
      const skipped = out.requestedCount - out.assignedCount;
      const extra =
        skipped > 0 ? ` (${skipped} already assigned.)` : '';
      showStatus(`Assigned ${out.assignedCount} student(s).${extra}`, 'success');
      setAssignExamId(null);
      setSelectedStudentIds([]);
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Assign failed', 'error');
    } finally {
      setAssigning(false);
    }
  }

  return (
    <section className="card" aria-labelledby="instructor-heading">
      <div className="card__head">
        <h2 id="instructor-heading" className="card__title">Instructor</h2>
        <p className="card__lede">Author questions (JSON), assign, review submissions, adjust scores, publish, archive.</p>
      </div>

      <form className="form-stack" onSubmit={(e) => { void handleCreateExam(e); }}>
        <h3 className="section-label">Create exam</h3>
        <div className="field">
          <label htmlFor="examTitle">Title</label>
          <input
            id="examTitle"
            type="text"
            maxLength={120}
            required
            placeholder="Exam title"
            value={title}
            onChange={(e) => { setTitle(e.target.value); }}
          />
        </div>
        <div className="field-row">
          <div className="field field--grow">
            <label htmlFor="startsAtUtc">Starts</label>
            <input
              id="startsAtUtc"
              type="datetime-local"
              required
              value={startsAt}
              onChange={(e) => { setStartsAt(e.target.value); }}
            />
          </div>
          <div className="field field--grow">
            <label htmlFor="endsAtUtc">Ends</label>
            <input
              id="endsAtUtc"
              type="datetime-local"
              required
              value={endsAt}
              onChange={(e) => { setEndsAt(e.target.value); }}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="questionsJson">Questions (JSON)</label>
          <textarea
            id="questionsJson"
            rows={8}
            className="mono-textarea"
            value={questionsJson}
            onChange={(e) => { setQuestionsJson(e.target.value); }}
            spellCheck={false}
          />
          <span className="field__hint">
            Array of objects: text (id, type, points, prompt) or mcq (+ options[], correctIndex).
          </span>
        </div>
        <button className="btn btn--primary" type="submit" disabled={creating} aria-busy={creating}>
          {creating ? 'Creating…' : 'Create exam'}
        </button>
      </form>

      <hr className="divider" />

      <div className="card__body">
        <div className="toolbar">
          <h3 className="section-label" style={{ margin: 0 }}>Your exams</h3>
          <button className="btn btn--secondary btn--sm" type="button" onClick={() => { void loadExams(); }} disabled={loadingExams}>
            {loadingExams ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <div className="list list--exams" aria-live="polite">
          {loadingExams && <div className="empty-state">Loading…</div>}
          {!loadingExams && examsError && (
            <div className="empty-state empty-state--error">{examsError}</div>
          )}
          {!loadingExams && !examsError && exams?.length === 0 && (
            <div className="empty-state">No exams yet. Create one above.</div>
          )}
          {!loadingExams && exams?.map(exam => (
            <article key={exam.id} className="list-item list-item--selectable">
              <div className="list-item__title">
                {exam.title}
                {Boolean(Number(exam.archived)) && (
                  <span className="audit-outcome audit-outcome--deny" style={{ marginLeft: 8 }}>archived</span>
                )}
              </div>
              <div className="list-item__meta">
                Exam #{exam.id} · {exam.starts_at_utc} → {exam.ends_at_utc}
              </div>
              <div className="list-item__actions">
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => { selectExamForAssign(exam); }}>
                  Assign
                </button>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => { void openResultsForExam(exam); }}>
                  Grade / publish
                </button>
                {!Boolean(Number(exam.archived)) && (
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => { void archiveExam(exam); }}>
                    Archive
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>

      <hr className="divider" />

      <div className="card__body">
        <h3 className="section-label">Grading &amp; publish</h3>
        <p className="card__lede card__lede--tight">
          Auto-score runs on submit (MCQ + text rules). Override scores below, then publish so students can see them.
        </p>
        {resultsExamId !== null && (
          <>
            <p className="list-item__meta" style={{ marginBottom: '12px' }}>
              Exam #{resultsExamId} — {resultsTitle}
            </p>
            <div className="toolbar" style={{ marginBottom: '12px' }}>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={resultsLoading || publishing !== null}
                onClick={() => { void publishAllUnpublished(); }}
              >
                {publishing === 'all' ? 'Publishing…' : 'Publish all unpublished'}
              </button>
            </div>
            {resultsLoading && <div className="empty-state">Loading…</div>}
            {!resultsLoading && resultsError && (
              <div className="empty-state empty-state--error">{resultsError}</div>
            )}
            {!resultsLoading && !resultsError && (resultRows?.length ?? 0) === 0 && (
              <div className="empty-state">No result rows yet (no submissions).</div>
            )}
            {!resultsLoading && !resultsError && (resultRows?.length ?? 0) > 0 && (
              <div className="table-wrap">
                <table className="user-table">
                  <thead>
                    <tr>
                      <th scope="col">Student</th>
                      <th scope="col">Score</th>
                      <th scope="col">Status</th>
                      <th scope="col">Publish</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultRows?.map(row => {
                      const pub = Boolean(Number(row.published));
                      return (
                        <tr key={row.studentUserId}>
                          <td className="user-table__email">{row.email}</td>
                          <td>
                            <div className="field-row" style={{ gap: 6, alignItems: 'center' }}>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={draftScores[row.studentUserId] ?? String(row.score)}
                                onChange={(e) => {
                                  setDraftScores(prev => ({ ...prev, [row.studentUserId]: e.target.value }));
                                }}
                                style={{ width: '4.5rem' }}
                              />
                              <button
                                type="button"
                                className="btn btn--secondary btn--compact"
                                disabled={scoreBusy === row.studentUserId}
                                onClick={() => {
                                  void saveScore(row.studentUserId, draftScores[row.studentUserId] ?? String(row.score));
                                }}
                              >
                                Save
                              </button>
                            </div>
                          </td>
                          <td>{pub ? 'Published' : 'Draft'}</td>
                          <td>
                            {!pub ? (
                              <button
                                type="button"
                                className="btn btn--secondary btn--compact"
                                disabled={publishing !== null}
                                aria-busy={publishing === row.studentUserId}
                                onClick={() => { void publishOne(row.studentUserId); }}
                              >
                                {publishing === row.studentUserId ? 'Publishing…' : 'Publish'}
                              </button>
                            ) : (
                              <span className="user-table__meta">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {submissionRows && submissionRows.length > 0 && (
              <>
                <h4 className="section-label" style={{ marginTop: '20px' }}>Submissions (review)</h4>
                {submissionRows.map(s => (
                  <article key={s.id} className="list-item" style={{ marginBottom: '10px' }}>
                    <div className="list-item__title">{s.email} · #{s.id}</div>
                    <div className="list-item__meta">{s.submittedAtUtc}</div>
                    <pre className="submission-pre">{formatAnswersJson(s.answersJson)}</pre>
                  </article>
                ))}
              </>
            )}
          </>
        )}
      </div>

      <hr className="divider" />

      <form ref={assignFormRef} className="form-stack" onSubmit={(e) => { void handleAssignExam(e); }}>
        <h3 className="section-label">Assign exam</h3>
        <p className="card__lede card__lede--tight">
          Pick an exam with Assign above, then choose one or more students (or all). Already-assigned pairs are skipped.
        </p>
        <div className="field-row">
          <div className="field field--grow">
            <label htmlFor="assignExamId">Exam ID</label>
            <input
              id="assignExamId"
              type="number"
              min={1}
              required
              readOnly
              value={assignExamId ?? ''}
            />
          </div>
        </div>
        <fieldset className="student-assign-fieldset">
          <legend className="section-label" style={{ marginBottom: 8 }}>Students</legend>
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={selectAllStudents}
              disabled={students.length === 0}
            >
              Select all
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={clearStudentSelection}
              disabled={selectedStudentIds.length === 0}
            >
              Clear selection
            </button>
            <span className="field__hint" style={{ margin: 0 }}>
              {selectedStudentIds.length} selected
            </span>
          </div>
          <div className="student-assign-scroll">
            {students.length === 0 && <div className="empty-state">No active students in directory.</div>}
            {students.map(s => (
              <label key={s.id} className="student-assign-row">
                <input
                  type="checkbox"
                  checked={selectedStudentIds.includes(s.id)}
                  onChange={() => { toggleStudentSelected(s.id); }}
                />
                <span>{s.email} <span className="user-table__meta">#{s.id}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <button
          className="btn btn--secondary"
          type="submit"
          disabled={assigning || !assignExamId || selectedStudentIds.length === 0}
          aria-busy={assigning}
        >
          {assigning ? 'Assigning…' : `Assign to ${selectedStudentIds.length || 0} student(s)`}
        </button>
      </form>
    </section>
  );
}
