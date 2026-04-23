import { supabase } from './supabase.js'
import { isDemoUser } from './auth.js'

// =====================
// ON PAGE LOAD
// =====================
window.onload = async function () {

    // ── Demo bypass ───────────────────────────────
    if (isDemoUser()) {
        loadClassroom()
        restoreActiveTab()
        return
    }

    // ── Real auth ─────────────────────────────────
    let { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        window.location.href = 'index.html'
        return
    }

    loadClassroom()
    restoreActiveTab()
}

// =====================
// LOAD CLASSROOM DETAILS
// =====================
function loadClassroom() {
    let classroom = JSON.parse(localStorage.getItem('currentClassroom'))
    if (!classroom) {
        window.location.href = 'dashboard.html'
        return
    }

    document.getElementById('classroomTitle').textContent   = classroom.name
    document.getElementById('classroomSubject').textContent = classroom.subject + '  ·  Code: ' + classroom.code
}

// =====================
// RESTORE TAB AFTER RETURNING FROM FLASK
// =====================
function restoreActiveTab() {
    const tab = sessionStorage.getItem('restoreTab')
    if (tab) {
        sessionStorage.removeItem('restoreTab')
        showTab(tab)
    }
}

// =====================
// TAB SWITCHING
// =====================
function showTab(tab) {
    document.getElementById('notesTab').style.display   = 'none'
    document.getElementById('quizTab').style.display    = 'none'
    document.getElementById('meetingTab').style.display = 'none'

    document.querySelectorAll('.classroom-tab').forEach(function (btn) {
        btn.classList.remove('active')
    })

    if (tab === 'notes') {
        document.getElementById('notesTab').style.display = 'block'
        document.querySelectorAll('.classroom-tab')[0].classList.add('active')
    } else if (tab === 'quiz') {
        document.getElementById('quizTab').style.display = 'block'
        document.querySelectorAll('.classroom-tab')[1].classList.add('active')
    } else if (tab === 'meeting') {
        document.getElementById('meetingTab').style.display = 'block'
        document.querySelectorAll('.classroom-tab')[2].classList.add('active')
    }
}

// =====================
// NAVIGATION
// =====================
function goBack() {
    window.location.href = 'dashboard.html'
}

async function logout() {
    if (!isDemoUser()) {
        await supabase.auth.signOut()
    }
    localStorage.clear()
    window.location.href = 'index.html'
}

window.showTab = showTab
window.goBack  = goBack
window.logout  = logout