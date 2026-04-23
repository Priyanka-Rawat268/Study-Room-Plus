/* ─── upload.js ────────────────────────────────
   Handles file selection, drag-drop, form submit,
   and rendering of past quizzes on index.html
──────────────────────────────────────────────── */

const dropZone    = document.getElementById('dropZone');
const fileInput   = document.getElementById('fileInput');
const fileSelected = document.getElementById('fileSelected');
const fileNameEl  = document.getElementById('fileName');
const generateBtn = document.getElementById('generateBtn');
const btnText     = document.getElementById('btnText');
const btnSpinner  = document.getElementById('btnSpinner');
const uploadForm  = document.getElementById('uploadForm');
const overlay     = document.getElementById('loadingOverlay');
const toastEl     = document.getElementById('toast');

let selectedFile = null;

// ── Drag & drop visual feedback ──────────────
dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFileSelect(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFileSelect(fileInput.files[0]);
});

function handleFileSelect(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['pdf', 'txt'].includes(ext)) {
    showToast('Only PDF and TXT files are supported.', 'error');
    return;
  }
  selectedFile = file;
  fileNameEl.textContent = file.name;
  fileSelected.style.display = 'flex';
  dropZone.querySelector('h3').textContent = 'File ready';
  generateBtn.disabled = false;
}

// ── Form submit ───────────────────────────────
uploadForm.addEventListener('submit', async e => {
  e.preventDefault();
  if (!selectedFile) return;

  const timerMin = parseInt(document.getElementById('timerMinutes').value) || 10;

  // UI → loading state (2 Gemini calls: analyse + generate)
  generateBtn.disabled = true;
  btnSpinner.style.display = 'block';
  overlay.classList.add('active');

  const loadingText = document.getElementById('loadingText');

  // Cycle status messages during the wait
  const messages = [
    "Reading your document...",
    "Analyzing syllabus structure...",
    "Identifying key topics...",
    "Scaffolding exam sections...",
    "Crafting JEE-style questions...",
    "validating answer keys...",
    "Almost there, finalizing...",
    "Polishing the quiz interface..."
  ];
  let msgIdx = 0;
  
  const updateLoadingMsg = () => {
    const msg = messages[msgIdx];
    btnText.textContent = msg;
    if (loadingText) loadingText.textContent = msg;
    msgIdx = (msgIdx + 1) % messages.length;
  };

  updateLoadingMsg();
  const msgTimer = setInterval(updateLoadingMsg, 3500);

  const formData = new FormData();
  formData.append('file', selectedFile);
  formData.append('timer_minutes', timerMin);

  try {
    const res  = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Upload failed');

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

// ── Past quizzes ──────────────────────────────
async function loadQuizHistory() {
  const listEl = document.getElementById('quizList');
  try {
    const res    = await fetch('/api/quizzes');
    const quizzes = await res.json();

    if (!quizzes.length) {
      listEl.innerHTML = '<div class="empty-state">No quizzes yet — upload your first document! 🎉</div>';
      return;
    }

    listEl.innerHTML = quizzes.map(q => {
      const date = q.created_at
        ? new Date(q.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '';
      const regenBadge = q.parent_quiz_id
        ? '<span class="quiz-item-badge" style="background:rgba(16,185,129,0.1);border-color:rgba(16,185,129,0.4);color:#10b981">↻ AI Iteration</span>'
        : '';
      
      const resultBtnLabel = q.has_result ? '📈 Result' : '📖 Review';
      const resultBtn = `<button class="btn btn-secondary btn-xs" onclick="viewResult('${q.quiz_id}')">${resultBtnLabel}</button>`;

      return `
        <div class="quiz-item">
          <div class="quiz-item-info">
            <div style="display:flex; gap:8px; align-items:center; margin-bottom:4px">
              <h4>${escHtml(q.title)}</h4>
              ${regenBadge}
            </div>
            <span>${date} · ${q.question_count} Questions</span>
          </div>
          <div class="quiz-item-actions">
            ${resultBtn}
            <button class="btn btn-secondary btn-xs" onclick="retakeQuiz('${q.quiz_id}')">🔄 Retake</button>
            <button class="btn btn-primary btn-xs" onclick="regenQuiz('${q.quiz_id}')">✨ New via AI</button>
          </div>
        </div>`;
    }).join('');

  } catch {
    listEl.innerHTML = '<div class="empty-state">Could not load history.</div>';
  }
}

// ── Item Actions ──────────────────────────────
window.viewResult = (id) => {
  sessionStorage.setItem('quizId', id);
  // Clear any existing session result to force a fetch from the API
  sessionStorage.removeItem('quizResult');
  window.location.href = `/result?id=${id}`;
};

window.retakeQuiz = (id) => {
  sessionStorage.setItem('quizId', id);
  sessionStorage.removeItem('quizResult');
  sessionStorage.removeItem(`answers_${id}`);
  window.location.href = `/quiz?id=${id}`;
};

window.regenQuiz = async (id) => {
  overlay.classList.add('active');
  try {
    const res = await fetch(`/api/regen/${id}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Regeneration failed');
    sessionStorage.setItem('quizId', data.quiz_id);
    window.location.href = `/quiz?id=${data.quiz_id}`;
  } catch (err) {
    overlay.classList.remove('active');
    showToast(err.message, 'error');
  }
};

// ── Toast ─────────────────────────────────────
function showToast(msg, type = '') {
  toastEl.textContent = msg;
  toastEl.className   = `toast ${type}`;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 3500);
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

loadQuizHistory();
