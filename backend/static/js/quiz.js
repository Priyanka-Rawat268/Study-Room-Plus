/* ─── quiz.js ─────────────────────────────────
   JEE-Style Workspace with Section Support, 
   Palette Sidebar, and Persistent Timer.
──────────────────────────────────────────────── */

// ── DOM Elements ─────────────────────────────
const viewQuizTitle  = document.getElementById('viewQuizTitle');
const timerDisplay   = document.getElementById('timerDisplay');
const paletteGrid    = document.getElementById('paletteGrid');
const questionDisplay = document.getElementById('questionDisplay');
const directionsPanel = document.getElementById('directionsPanel');
const directionsToggle = document.getElementById('directionsToggle');
const directionsContent = document.getElementById('directionsContent');
const sectionTitleDisplay = document.getElementById('sectionTitleDisplay');

const prevBtn        = document.getElementById('prevBtn');
const nextBtn        = document.getElementById('nextBtn');
const resetBtn       = document.getElementById('resetBtn');
const finalSubmitBtn = document.getElementById('finalSubmitBtn');
const endQuizBtn     = document.getElementById('endQuizBtn');

const valCorrect     = document.getElementById('valCorrect');
const valWrong       = document.getElementById('valWrong');
const editSchemeBtn  = document.getElementById('editSchemeBtn');

const schemeModal    = document.getElementById('schemeModal');
const inputCorrect   = document.getElementById('inputCorrect');
const inputWrong     = document.getElementById('inputWrong');
const saveSchemeBtn  = document.getElementById('saveSchemeBtn');
const closeSchemeBtn = document.getElementById('closeSchemeBtn');

const endQuizModal   = document.getElementById('endQuizModal');
const modalConfirmBtn = document.getElementById('modalConfirmBtn');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const endQuizModalBody = document.getElementById('endQuizModalBody');

const toastEl        = document.getElementById('toast');

// ── State ────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const quizId = params.get('id');

let quizData       = null;
let allQuestions   = []; // Flattened list for nav
let userAnswers    = {}; // { qid: 'A' }
let currentIdx     = 0;
let timerSeconds   = 0;
let timerInterval  = null;
let markingScheme  = { correct: 1.0, incorrect: -0.33 };

if (!quizId) { window.location.href = '/'; } else { init(); }

// ── Initialization ───────────────────────────
async function init() {
  try {
    const res = await fetch(`/api/quiz/${quizId}`);
    if (!res.ok) throw new Error('Quiz not found');
    quizData = await res.json();
    
    // Flatten the sections
    allQuestions = [];
    quizData.sections.forEach(sec => {
      sec.questions.forEach(q => {
        allQuestions.push({ ...q, section_title: sec.title, directions: sec.directions });
      });
    });

    markingScheme = quizData.marking_scheme || markingScheme;
    valCorrect.textContent = `+${markingScheme.correct}`;
    valWrong.textContent   = markingScheme.incorrect;
    viewQuizTitle.innerHTML = `${escHtml(quizData.title)} <span style="font-size: 0.85rem; opacity: 0.7; font-weight: normal; margin-left: 12px; background: rgba(0,0,0,0.1); padding: 2px 8px; border-radius: 4px;">ID: ${quizId}</span>`;
    
    // Initialize Answers from sessionStorage if exists (for partial persistence)
    const savedAnswers = sessionStorage.getItem(`answers_${quizId}`);
    if (savedAnswers) userAnswers = JSON.parse(savedAnswers);

    renderPalette();
    initTimer();
    showQuestion(0);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ── Timer Logic (localStorage persistent) ────
function initTimer() {
  const storageKey = `timer_${quizId}`;
  const savedTime  = localStorage.getItem(storageKey);
  
  if (savedTime !== null) {
    timerSeconds = parseInt(savedTime);
  } else {
    timerSeconds = (quizData.timer_minutes || 10) * 60;
  }

  renderTimer();
  timerInterval = setInterval(() => {
    timerSeconds--;
    localStorage.setItem(storageKey, timerSeconds);
    renderTimer();
    
    if (timerSeconds <= 0) {
      clearInterval(timerInterval);
      localStorage.removeItem(storageKey);
      showToast("⏰ Time's up! Auto-submitting...", "error");
      setTimeout(() => submitQuiz(), 1500);
    }
  }, 1000);
}

function renderTimer() {
  const m = Math.floor(timerSeconds / 60);
  const s = timerSeconds % 60;
  timerDisplay.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  
  const timerCard = timerDisplay.parentElement;
  if (timerSeconds < 60) {
    timerCard.style.borderColor = 'var(--error)';
    timerCard.style.color = 'var(--error)';
  } else if (timerSeconds < 180) {
    timerCard.style.borderColor = 'var(--warning)';
    timerCard.style.color = 'var(--warning)';
  }
}

// ── Navigation ───────────────────────────────
function showQuestion(idx) {
  currentIdx = idx;
  const q = allQuestions[idx];
  if (!q) return;

  // 1. Directions Panel
  if (q.directions && q.directions.trim()) {
    directionsPanel.style.display = 'block';
    sectionTitleDisplay.textContent = q.section_title || 'Section Instructions';
    directionsContent.innerHTML = q.directions.replace(/\n/g, '<br>');
    // Ensure it remains collapsed/expanded as per user state or default
  } else {
    directionsPanel.style.display = 'none';
  }

  // 2. Question Content
  questionDisplay.innerHTML = `
    <div class="question-card" style="box-shadow:none; border:none; background:transparent">
      <div class="question-number">Question ${idx + 1} of ${allQuestions.length}</div>
      <p class="question-text">${escHtml(q.question)}</p>
      <div class="options-grid">
        ${['A','B','C','D'].map(l => {
          const isSelected = userAnswers[q.id] === l;
          return `
            <button class="option-btn ${isSelected ? 'selected' : ''}" onclick="selectOption('${q.id}', '${l}')">
              <span class="option-letter">${l}</span>
              <span>${escHtml(q.options[l])}</span>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;

  // 3. Update Palette UI
  document.querySelectorAll('.palette-btn').forEach(btn => btn.classList.remove('current'));
  const currBtn = document.querySelector(`.palette-btn[data-idx="${idx}"]`);
  if (currBtn) currBtn.classList.add('current');

  // 4. Update Nav Buttons
  prevBtn.disabled = (idx === 0);
  if (idx === allQuestions.length - 1) {
    nextBtn.style.display = 'none';
    finalSubmitBtn.style.display = 'inline-flex';
  } else {
    nextBtn.style.display = 'inline-flex';
    finalSubmitBtn.style.display = 'none';
  }
}

function selectOption(qid, letter) {
  userAnswers[qid] = letter;
  sessionStorage.setItem(`answers_${quizId}`, JSON.stringify(userAnswers));
  
  // Update palette button visually
  const btn = document.querySelector(`.palette-btn[data-qid="${qid}"]`);
  if (btn) btn.classList.add('answered');
  
  showQuestion(currentIdx); // Re-render current q to show selection
}

// ── Palette ──────────────────────────────────
function renderPalette() {
  paletteGrid.innerHTML = '';
  allQuestions.forEach((q, i) => {
    const btn = document.createElement('button');
    btn.className = 'palette-btn';
    if (userAnswers[q.id]) btn.classList.add('answered');
    btn.textContent = i + 1;
    btn.dataset.idx = i;
    btn.dataset.qid = q.id;
    btn.onclick = () => showQuestion(i);
    paletteGrid.appendChild(btn);
  });
}

// ── Reset Choice ─────────────────────────────
resetBtn.onclick = () => {
  const q = allQuestions[currentIdx];
  if (userAnswers[q.id]) {
    delete userAnswers[q.id];
    sessionStorage.setItem(`answers_${quizId}`, JSON.stringify(userAnswers));
    const btn = document.querySelector(`.palette-btn[data-idx="${currentIdx}"]`);
    if (btn) {
      btn.classList.remove('answered');
      btn.classList.add('skipped'); // Yellow for "Visited but not answered"
    }
    showQuestion(currentIdx);
  }
};

// ── Section Toggle ───────────────────────────
directionsToggle.onclick = () => {
  directionsPanel.classList.toggle('expanded');
};

// ── Navigation Buttons ───────────────────────
prevBtn.onclick = () => { if (currentIdx > 0) showQuestion(currentIdx - 1); };
nextBtn.onclick = () => { if (currentIdx < allQuestions.length - 1) showQuestion(currentIdx + 1); };
finalSubmitBtn.onclick = () => confirmEndQuiz();

// ── Marking Scheme Modal ─────────────────────
editSchemeBtn.onclick = () => {
  inputCorrect.value = markingScheme.correct;
  inputWrong.value = markingScheme.incorrect;
  schemeModal.style.display = 'flex';
};

closeSchemeBtn.onclick = () => schemeModal.style.display = 'none';

saveSchemeBtn.onclick = () => {
  markingScheme.correct = parseFloat(inputCorrect.value) || 1.0;
  markingScheme.incorrect = parseFloat(inputWrong.value) || 0;
  valCorrect.textContent = `+${markingScheme.correct}`;
  valWrong.textContent = markingScheme.incorrect;
  schemeModal.style.display = 'none';
  showToast('Marking scheme updated!', 'success');
};

// ── End Quiz Confirmation ────────────────────
endQuizBtn.onclick = confirmEndQuiz;

function confirmEndQuiz() {
  const answeredCount = Object.keys(userAnswers).length;
  endQuizModalBody.innerHTML = `
    You have answered <strong>${answeredCount}</strong> of <strong>${allQuestions.length}</strong> questions.<br>
    Unanswered questions will not be penalized.
  `;
  endQuizModal.style.display = 'flex';
}

modalCancelBtn.onclick = () => endQuizModal.style.display = 'none';

modalConfirmBtn.onclick = () => {
  endQuizModal.style.display = 'none';
  submitQuiz();
};

// ── Final Submission ─────────────────────────
async function submitQuiz() {
  clearInterval(timerInterval);
  localStorage.removeItem(`timer_${quizId}`);

  // Show loading state
  questionDisplay.innerHTML = `
    <div class="question-loading">
      <div class="loading-spinner-lg"></div>
      <p>Grading your responses...</p>
    </div>
  `;

  try {
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        quiz_id: quizId, 
        answers: userAnswers,
        marking_override: markingScheme // Backend should handle this if provided
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Submission failed');

    sessionStorage.setItem('quizResult', JSON.stringify(data));
    sessionStorage.removeItem(`answers_${quizId}`);
    window.location.href = '/result';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

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

// Palette hover interactions
window.selectOption = selectOption;
