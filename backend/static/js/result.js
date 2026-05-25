// ── State ────────────────────────────────────
const params   = new URLSearchParams(window.location.search);
const quizId   = params.get('id') || sessionStorage.getItem('quizId');

let result = null;

async function initResult() {
    const raw = sessionStorage.getItem('quizResult');
    if (raw) {
        result = JSON.parse(raw);
        renderAll();
    } else if (quizId) {
        try {
            const res = await fetch(`/api/result/${quizId}`);
            if (!res.ok) throw new Error('Result not found');
            result = await res.json();
            renderAll();
        } catch (err) {
            window.location.href = '/';
        }
    } else {
        window.location.href = '/';
    }
}

function renderAll() {
    const { score, total, percentage, title, mapping, overview, quiz_id } = result;
    document.title = `MC-QZ — ${title || 'Results'}`;

    // ── Score circle ──────────────────────────────
    const correctCount = mapping.filter(m => m.is_correct).length;
    const wrongCount   = mapping.filter(m => m.user_answer && !m.is_correct).length;
    const clampedPct   = Math.max(0, Math.min(100, percentage));

    const circleEl = document.getElementById('scoreCircle');
    const color = clampedPct >= 80 ? 'var(--success)'
                : clampedPct >= 50 ? 'var(--warning)'
                : 'var(--error)';

    // Visual conic gradient
    circleEl.style.background = `conic-gradient(${color} ${clampedPct}%, var(--bg-surface) 0)`;

    document.getElementById('scorePct').textContent    = result.is_review_only ? 'Study Mode' : `${score} / ${result.total_possible || total}`;
    document.getElementById('statCorrect').textContent = result.is_review_only ? '-' : correctCount;
    document.getElementById('statWrong').textContent   = result.is_review_only ? '-' : wrongCount;
    document.getElementById('statTotal').textContent   = total;

    document.getElementById('scoreGrade').textContent  =
      result.is_review_only ? '📖 Reviewing Solution Key' :
      clampedPct >= 90 ? '🏆 Excellent!' :
      clampedPct >= 75 ? '🎉 Great job!' :
      clampedPct >= 50 ? '👍 Keep going!' : '📚 Keep studying!';
    
    // Initialize syllabus and review
    if (overview) renderOverview(overview);
    renderReview(mapping);
}

// ── Retake ────────────────────────────────────
document.getElementById('retakeBtn').addEventListener('click', () => {
  const qid = sessionStorage.getItem('quizId');
  if (qid) {
    sessionStorage.removeItem('quizResult');
    window.location.href = `/quiz?id=${qid}`;
  }
});

// ── Regen ─────────────────────────────────────
document.getElementById('regenBtn').addEventListener('click', async () => {
  const qid = sessionStorage.getItem('quizId');
  if (!qid) return;

  const overlay = document.getElementById('regenOverlay');
  overlay.classList.add('active');

  try {
    const res  = await fetch(`/api/regen/${qid}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Regen failed');

    sessionStorage.removeItem('quizResult');
    sessionStorage.setItem('quizId', data.quiz_id);
    window.location.href = `/quiz?id=${data.quiz_id}`;
  } catch (err) {
    overlay.classList.remove('active');
    showToast(err.message, 'error');
  }
});

// ── Syllabus Overview Panel ───────────────────
function renderOverview(overview) {
  const panel = document.getElementById('overviewPanel');
  panel.style.display = 'block';

  document.getElementById('overviewSubject').textContent = overview.subject || '';
  document.getElementById('overviewSummary').textContent = overview.content_summary || '';

  const topicTags = document.getElementById('topicTags');
  topicTags.innerHTML = '';
  (overview.topics_covered || []).forEach(t => {
    const chip = document.createElement('span');
    chip.className   = 'tag';
    chip.textContent = t;
    topicTags.appendChild(chip);
  });

  const dp    = overview.difficulty_profile || {};
  const bars  = document.getElementById('difficultyBars');
  bars.innerHTML = '';
  const levels = [
    { label: 'Easy',   pct: dp.easy_pct   || 0, cls: 'diff-easy'   },
    { label: 'Medium', pct: dp.medium_pct || 0, cls: 'diff-medium' },
    { label: 'Hard',   pct: dp.hard_pct   || 0, cls: 'diff-hard'   },
  ];
  levels.forEach(({ label, pct, cls }) => {
    bars.insertAdjacentHTML('beforeend', `
      <div class="diff-row">
        <span class="diff-label">${label}</span>
        <div class="diff-track">
          <div class="diff-fill ${cls}" style="width:${pct}%"></div>
        </div>
        <span class="diff-pct">${pct}%</span>
      </div>`);
  });

  const linkages = overview.topic_linkages || [];
  const linkageSection = document.getElementById('linkageSection');
  const linkageList = document.getElementById('linkageList');
  linkageList.innerHTML = '';
  if (linkages.length) {
    linkageSection.style.display = 'block';
    linkages.forEach(l => {
      linkageList.insertAdjacentHTML('beforeend', `
        <div class="linkage-item">
          <span class="linkage-from">${escHtml(l.from)}</span>
          <span class="linkage-arrow">→</span>
          <span class="linkage-to">${escHtml(l.to)}</span>
          <span class="linkage-rel">${escHtml(l.relationship || '')}</span>
        </div>`);
    });
  } else { linkageSection.style.display = 'none'; }

  const conceptTags = document.getElementById('conceptTags');
  conceptTags.innerHTML = '';
  (overview.key_concepts || []).forEach(c => {
    const chip = document.createElement('span');
    chip.className   = 'tag tag-concept';
    chip.textContent = c;
    conceptTags.appendChild(chip);
  });

  const toggleBtn  = document.getElementById('overviewToggle');
  const overviewBody = document.getElementById('overviewBody');
  toggleBtn.onclick = () => {
    const hidden = overviewBody.style.display === 'none';
    overviewBody.style.display = hidden ? 'block' : 'none';
    toggleBtn.textContent      = hidden ? 'Hide ▲' : 'Show ▼';
  };
}

// ── Answer Review ─────────────────────────────
function renderReview(mapping) {
  const container = document.getElementById('reviewContainer');
  container.innerHTML = '';
  mapping.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = `review-item ${item.is_correct ? 'correct-item' : 'wrong-item'}`;
    div.style.animationDelay = `${idx * 0.03}s`;

    const optionsHtml = ['A','B','C','D'].map(letter => {
      const isCorrect    = letter === item.correct_answer;
      const isUserWrong  = letter === item.user_answer && !item.is_correct;
      const cls = isCorrect   ? 'review-option was-correct'
                : isUserWrong ? 'review-option was-user-wrong'
                : 'review-option';
      const icon = isCorrect ? '✓ ' : isUserWrong ? '✗ ' : '';
      return `<div class="${cls}">
        <strong>${letter}.</strong> ${icon}${escHtml(item.options[letter] || '')}
      </div>`;
    }).join('');

    const topicBadge = item.topic
      ? `<span class="tag" style="font-size:0.72rem">${escHtml(item.topic)}</span>` : '';
    const diffBadge  = item.difficulty
      ? `<span class="tag tag-diff-${item.difficulty}" style="font-size:0.72rem">${item.difficulty}</span>` : '';

    const ptsColor = item.points > 0 ? 'var(--success)' : item.points < 0 ? 'var(--error)' : 'var(--text-muted)';
    const ptsText  = item.points > 0 ? `+${item.points}` : item.points;

    div.innerHTML = `
      <div class="review-q-header">
        <span class="review-icon">${item.is_correct ? '✅' : item.user_answer ? '❌' : '⚪'}</span>
        <div style="flex:1">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px">
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${topicBadge}${diffBadge}
            </div>
            <span style="font-weight:700; font-size:0.85rem; color:${ptsColor}">${ptsText} pts</span>
          </div>
          <p class="review-question"><strong>Q${item.id}.</strong> ${escHtml(item.question)}</p>
        </div>
      </div>
      <div class="review-options">${optionsHtml}</div>
      ${!item.user_answer
        ? '<p class="review-explanation">⚠️ You skipped this question.</p>'
        : item.explanation
          ? `<p class="review-explanation">💡 ${escHtml(item.explanation)}</p>`
          : ''
      }`;
    container.appendChild(div);
  });
}

// ── Kickoff ───────────────────────────────────
initResult();

// ── Utils ─────────────────────────────────────
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast ${type}`;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3500);
}

function escHtml(str = '') {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
