import { supabase } from './supabase.js'
import { isDemoUser } from './auth.js'

// ───────────────────────────────────────────────
// CONFIG — MC-QZ backend URL
// ───────────────────────────────────────────────
const MC_QZ_URL = 'http://127.0.0.1:5000'

// =====================
// ON PAGE LOAD
// =====================
window.onload = function () {
    checkBackendStatus()
    initAIGenerator()
    loadAIQuizHistory()
}

// =====================
// BACKEND STATUS CHECK
// =====================
async function checkBackendStatus() {
    const dot   = document.getElementById('statusDot')
    const text  = document.getElementById('statusText')
    const card  = document.getElementById('aiGenCard')

    if (!dot || !text) return

    try {
        const res = await fetch(`${MC_QZ_URL}/api/quizzes`, { signal: AbortSignal.timeout(2000) })
        if (res.ok) {
            dot.className = 'status-dot online'
            text.textContent = 'AI Backend: Online'
            card.classList.remove('backend-offline')
        } else {
            throw new Error()
        }
    } catch (e) {
        dot.className = 'status-dot offline'
        text.textContent = 'AI Backend: Offline'
        card.classList.add('backend-offline')
    }
}

// =====================
// AI GENERATOR INIT
// =====================
function initAIGenerator() {
    const form        = document.getElementById('aiGenerateForm')
    const slider      = document.getElementById('aiQuestionCount')
    const qDisplay    = document.getElementById('aiQCountDisplay')
    const timerInput  = document.getElementById('aiTimerMinutes')
    const timerDisp   = document.getElementById('aiTimerDisplay')
    const promptInput = document.getElementById('aiPromptInput')

    if (!form) return

    // Slider updates
    slider.addEventListener('input', (e) => {
        qDisplay.textContent = e.target.value
        // Auto-update timer recommendation (1.5 min per question)
        timerInput.value = Math.round(e.target.value * 1.5)
        timerDisp.textContent = timerInput.value
    })

    timerInput.addEventListener('input', (e) => {
        timerDisp.textContent = e.target.value
    })

    const loadingMessages = [
        'Connecting to Gemini AI…',
        'Analyzing your topic…',
        'Crafting exam-grade questions…',
        'Calibrating difficulty…',
        'Generating explanations…',
        'Validating answer keys…',
        'Almost there…',
    ]

    form.addEventListener('submit', async (e) => {
        e.preventDefault()
        const prompt = promptInput.value.trim()
        const numQ   = parseInt(slider.value) || 20
        const timer  = parseInt(timerInput.value) || Math.round(numQ * 1.5)

        if (!prompt) {
            alert('Please describe what you want to be quizzed on.')
            promptInput.focus()
            return
        }

        const btn     = document.getElementById('aiGenerateBtn')
        const btnText = document.getElementById('aiGenerateBtnText')
        const spinner = document.getElementById('aiSpinner')

        btn.disabled          = true
        spinner.style.display = 'inline-block'

        let msgIdx = 0
        const msgTimer = setInterval(() => {
            btnText.textContent = loadingMessages[msgIdx % loadingMessages.length]
            msgIdx++
        }, 3000)

        try {
            const res = await fetch(`${MC_QZ_URL}/api/generate-topic`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, num_questions: numQ, timer_minutes: timer }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Generation failed')

            clearInterval(msgTimer)
            // Remember to restore Quiz tab when user comes back
            sessionStorage.setItem('restoreTab', 'quiz')
            const returnUrl = encodeURIComponent(window.location.href)
            window.location.href = `${MC_QZ_URL}/quiz?id=${data.quiz_id}&return=${returnUrl}`

        } catch (err) {
            clearInterval(msgTimer)
            alert('AI Quiz Error: ' + err.message + '\n\nMake sure the Flask backend is running:\n  cd backend && python app.py')
        } finally {
            btn.disabled          = false
            btnText.textContent   = '✨ Generate Quiz'
            spinner.style.display = 'none'
        }
    })
}

// =====================
// AI QUIZ HISTORY
// =====================
async function loadAIQuizHistory() {
    const listEl = document.getElementById('aiQuizHistory')
    if (!listEl) return

    try {
        const res = await fetch(`${MC_QZ_URL}/api/quizzes`, { signal: AbortSignal.timeout(3000) })
        const quizzes = await res.json()

        if (!Array.isArray(quizzes) || quizzes.length === 0) {
            listEl.innerHTML = '<div class="ai-empty-state">No history yet. Start your first AI session!</div>'
            return
        }

        listEl.innerHTML = ''
        quizzes.slice(0, 10).forEach(q => {
            const item = document.createElement('div')
            item.className = 'ai-quiz-item'
            
            // Format name: uppercase first letter
            const displayTitle = q.name.charAt(0).toUpperCase() + q.name.slice(1)
            
            item.innerHTML = `
                <div class="ai-quiz-item-info">
                    <div class="ai-quiz-item-title">${displayTitle}</div>
                    <div class="ai-quiz-item-meta">
                        <span class="ai-badge badge-ai">🎯 AI</span>
                        ${q.count} Qs · ${q.timer} min
                    </div>
                </div>
                <div class="ai-quiz-item-actions">
                    <button class="btn btn-primary ai-action-btn" onclick="aiRetake('${q.id}')">Start</button>
                    ${q.score_pct !== null ? `<button class="btn btn-secondary ai-action-btn" onclick="aiViewResult('${q.id}')">Result (${q.score_pct}%)</button>` : ''}
                </div>
            `
            listEl.appendChild(item)
        })

    } catch (e) {
        listEl.innerHTML = '<div class="ai-empty-state">History unavailable while backend is offline.</div>'
    }
}

window.aiRetake = function (id) {
    sessionStorage.removeItem(`answers_${id}`)
    sessionStorage.setItem('restoreTab', 'quiz')
    const returnUrl = encodeURIComponent(window.location.href)
    window.location.href = `${MC_QZ_URL}/quiz?id=${id}&return=${returnUrl}`
}

window.aiViewResult = function (id) {
    sessionStorage.setItem('restoreTab', 'quiz')
    const returnUrl = encodeURIComponent(window.location.href)
    window.location.href = `${MC_QZ_URL}/result?id=${id}&return=${returnUrl}`
}

// ─── Meeting Link Logic ──────────────────────

function loadMeetLink() {
    let classroom = JSON.parse(localStorage.getItem('currentClassroom'))
    if (!classroom) return

    let savedLink = localStorage.getItem('meetLink_' + classroom.id)

    if (savedLink) {
        document.getElementById('meetLinkDisplay').style.display  = 'block'
        document.getElementById('meetLinkAnchor').href            = savedLink
        document.getElementById('meetLinkAnchor').textContent     = savedLink
    }
}

window.saveMeetLink = function() {
    let link      = document.getElementById('meetLink').value
    let classroom = JSON.parse(localStorage.getItem('currentClassroom'))

    if (link === '') {
        alert('Please paste a link')
        return
    }

    localStorage.setItem('meetLink_' + classroom.id, link)
    document.getElementById('meetLinkDisplay').style.display = 'block'
    document.getElementById('meetLinkAnchor').href           = link
    document.getElementById('meetLinkAnchor').textContent    = link
}

// Trigger meet link load on page load if meeting tab might be active
setTimeout(loadMeetLink, 100);