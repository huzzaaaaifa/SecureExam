// File purpose: Auto-score submissions from exam question definitions (text + MCQ).

const DEFAULT_LEGACY_QUESTIONS = [
  { id: 'q1', type: 'text', points: 5, prompt: 'Question 1' },
  { id: 'q2', type: 'text', points: 5, prompt: 'Question 2' }
];

// Parses stored JSON or returns legacy two-question shape for older exams.
function parseQuestions(questionsJson) {
  if (questionsJson == null || questionsJson === '') {
    return DEFAULT_LEGACY_QUESTIONS;
  }
  try {
    const q = JSON.parse(questionsJson);
    return Array.isArray(q) && q.length > 0 ? q : DEFAULT_LEGACY_QUESTIONS;
  } catch {
    return DEFAULT_LEGACY_QUESTIONS;
  }
}

function isSafeQuestionId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

// Sums points: MCQ matches correctIndex; text awards points if non-empty answer (capped at 100).
export function computeAutoScore(questionsJson, answers) {
  const questions = parseQuestions(questionsJson);
  if (!answers || typeof answers !== 'object') return 0;
  const answerMap = new Map(Object.entries(answers));

  let total = 0;
  for (const q of questions) {
    const pts = Math.min(100, Math.max(0, Number(q.points) ?? 0));
    const id = q.id;
    if (!isSafeQuestionId(id)) continue;
    const val = answerMap.get(id);

    if (q.type === 'mcq') {
      const ci = Number(q.correctIndex);
      if (Number.isFinite(ci) && val !== undefined && val !== null) {
        if (typeof val === 'number' && val === ci) total += pts;
        else if (typeof val === 'string' && String(val).trim() !== '' && Number(val) === ci) total += pts;
      }
    } else {
      if (typeof val === 'string' && val.trim().length > 0) total += pts;
      else if (typeof val === 'number' && !Number.isNaN(val)) total += pts;
    }
  }
  return Math.min(100, Math.round(total));
}
