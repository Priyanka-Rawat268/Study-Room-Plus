/* ─── generate.js ──────────────────────────────
   Free-form prompt quiz generation.
   Handles: prompt textarea, question slider,
   auto-timer, submission, and quiz history.
──────────────────────────────────────────────── */

// ── DOM refs ──────────────────────────────────
const generateForm  = document.getElementById('generateForm');
const promptInput   = document.getElementById('promptInput');
const qSlider       = document.getElementById('questionCount');
const qCountDisplay = document.getElementById('qCountDisplay');
const timerInput    = document.getElementById('timerMinutes');
const timerDisplay  = document.getElementById('timerDisplay');
const timerLabel    = document.getElementById('timerLabel');
const generateBtn   = document.getElementById('generateBtn');
const btnText       = document.getElementById('btnText');
const btnSpinner    = document.getElementById('btnSpinner');
const overlay       = document.getElementById('loadingOverlay');
const toastEl       = document.getElementById('toast');

// ── Question slider → auto-update timer ───────
let userEditedTimer = false;

qSlider.addEventListener('input', () => {
  const n = parseInt(qSlider.value);
  qCountDisplay.textContent = n;
  if (!userEditedTimer) {
    const auto = Math.round(n * 1.5);
    timerInput.value = auto;
    timerDisplay.textContent = auto;
  }
  // Update slider gradient fill
  const pct = ((n - 5) / (50 - 5)) * 100;
  qSlider.style.background = `linear-gradient(90deg, var(--accent) ${pct}%, var(--bg-surface) ${pct}%)`;
});

timerInput.addEventListener('input', () => {
  userEditedTimer = true;
  timerDisplay.textContent = timerInput.value;
  timerLabel.textContent = '(custom)';
});

// ── Auto-expand textarea ───────────────────────
promptInput.addEventListener('input', () => {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 180) + 'px';
});

// ── Form submission ───────────────────────────
const loadingMessages = [
  'Reading your request…',
  'Identifying subject and topic…',
  'Crafting exam-grade questions…',
  'Calibrating difficulty…',
  'Generating explanations…',
  'Validating answer keys…',
  'Almost there…',
];

generateForm.addEventListener('submit', async e => {
  e.preventDefault();

  const prompt = promptInput.value.trim();
  const numQ   = parseInt(qSlider.value) || 20;
  const timer  = parseInt(timerInput.value) || Math.round(numQ * 1.5);

  if (!prompt) {
    showToast('Please describe what you want to be quizzed on.', 'error');
    promptInput.focus();
    return;
  }

  // UI → loading state
  generateBtn.disabled = true;
  btnSpinner.style.display = 'block';
  overlay.classList.add('active');

  let msgIdx = 0;
  const msgTimer = setInterval(() => {
    const msg = loadingMessages[msgIdx % loadingMessages.length];
    btnText.textContent = msg;
    document.getElementById('loadingText').textContent = msg;
    msgIdx++;
  }, 3500);

  try {
    const res = await fetch('/api/generate-topic', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt:        prompt,
        num_questions: numQ,
        timer_minutes: timer,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generation failed');

    clearInterval(msgTimer);
    window.location.href = `/quiz?id=${data.quiz_id}`;

  } catch (err) {
    clearInterval(msgTimer);
    overlay.classList.remove('active');
    generateBtn.disabled     = false;
    btnText.textContent      = '✨ Generate Quiz';
    btnSpinner.style.display = 'none';
    showToast(err.message, 'error');
  }
});

// ── Quiz history ──────────────────────────────
async function loadQuizHistory() {
  const listEl = document.getElementById('quizList');
  try {
    const res     = await fetch('/api/quizzes');
    const quizzes = await res.json();

    if (!quizzes.length) {
      listEl.innerHTML = '<div class="empty-state">No quizzes yet — describe your first topic above! 🎉</div>';
      return;
    }

    listEl.innerHTML = quizzes.map(q => {
      const date = q.created_at
        ? new Date(q.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '';

      let badge = '';
      if (q.source === 'topic') {
        badge = '<span class="quiz-item-badge badge-topic">🎯 AI</span>';
      } else if (q.parent_quiz_id) {
        badge = '<span class="quiz-item-badge badge-regen">↻ Regen</span>';
      } else {
        badge = '<span class="quiz-item-badge badge-pdf">📄 PDF</span>';
      }

      const resultBtnLabel = q.has_result ? '📈 Result' : '📖 Review';

      return `
        <div class="quiz-item">
          <div class="quiz-item-info">
            <div style="display:flex; gap:8px; align-items:center; margin-bottom:4px">
              <h4>${escHtml(q.title)}</h4>
              ${badge}
            </div>
            <span>${date}${date ? ' · ' : ''}${q.question_count} Questions</span>
          </div>
          <div class="quiz-item-actions">
            <button class="btn btn-secondary btn-xs" onclick="viewResult('${q.quiz_id}')">${resultBtnLabel}</button>
            <button class="btn btn-secondary btn-xs" onclick="retakeQuiz('${q.quiz_id}')">🔄 Retake</button>
            <button class="btn btn-primary btn-xs"   onclick="regenQuiz('${q.quiz_id}')">✨ Regenerate</button>
          </div>
        </div>`;
    }).join('');

  } catch {
    listEl.innerHTML = '<div class="empty-state">Could not load history.</div>';
  }
}

// ── Item actions ──────────────────────────────
window.viewResult = id => {
  sessionStorage.removeItem('quizResult');
  window.location.href = `/result?id=${id}`;
};

window.retakeQuiz = id => {
  sessionStorage.removeItem(`answers_${id}`);
  window.location.href = `/quiz?id=${id}`;
};

window.regenQuiz = async id => {
  overlay.classList.add('active');
  try {
    const res  = await fetch(`/api/regen/${id}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Regeneration failed');
    window.location.href = `/quiz?id=${data.quiz_id}`;
  } catch (err) {
    overlay.classList.remove('active');
    showToast(err.message, 'error');
  }
};

// ── Utils ─────────────────────────────────────
function showToast(msg, type = '') {
  toastEl.textContent = msg;
  toastEl.className   = `toast ${type}`;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 3500);
}

function escHtml(str = '') {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

loadQuizHistory();
