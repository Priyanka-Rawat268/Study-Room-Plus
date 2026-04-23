import { supabase } from './supabase.js'
import { isDemoUser } from './auth.js'

// =====================
// GLOBAL EXPOSE (Do this first!)
// =====================
window.showTab = showTab;
window.goBack = goBack;
window.logout = logout;

// =====================
// ON PAGE LOAD
// =====================
window.onload = async function () {
    const urlParams = new URLSearchParams(window.location.search);
    const hasRoomId = urlParams.has('roomId');

    if (isDemoUser() || hasRoomId) {
        loadClassroom()
        restoreActiveTab()
        return
    }

    let { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        window.location.href = 'index.html'
        return
    }

    loadClassroom()
    restoreActiveTab()
}

function loadClassroom() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlRoomId = urlParams.get('roomId');

    let classroom = JSON.parse(localStorage.getItem('currentClassroom'));
    
    // If no classroom in storage but joined via link, create a temporary context
    if (!classroom && urlRoomId) {
        classroom = { id: urlRoomId, name: 'Live Session', subject: 'Guest Access', code: 'N/A' };
        localStorage.setItem('currentClassroom', JSON.stringify(classroom));
    }

    if (!classroom) {
        window.location.href = 'dashboard.html'
        return
    }

    document.getElementById('classroomTitle').textContent   = classroom.name
    document.getElementById('classroomSubject').textContent = classroom.subject + '  ·  Code: ' + classroom.code
}

function restoreActiveTab() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('roomId')) {
        showTab('meeting');
        return;
    }

    const tab = sessionStorage.getItem('restoreTab')
    if (tab) {
        sessionStorage.removeItem('restoreTab')
        showTab(tab)
    }
}

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