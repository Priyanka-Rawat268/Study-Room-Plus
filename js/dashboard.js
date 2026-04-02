import { supabase } from './supabase.js'

// =====================
// ON PAGE LOAD
// =====================
window.onload = async function () {
    // check if user is logged in
    let { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        window.location.href = 'index.html'
        return
    }

    // show welcome message
    let name = user.user_metadata.full_name || user.email
    document.getElementById('welcomeText').textContent = 'Hi, ' + name + '!'

    // load classrooms
    loadClassrooms()
}

// =====================
// LOAD CLASSROOMS
// =====================
async function loadClassrooms() {
    let { data: classrooms, error } = await supabase
        .from('classrooms')
        .select('*')
        .order('created_at', { ascending: false })

    if (error) {
        console.log('Error loading classrooms:', error.message)
        return
    }

    renderClassrooms(classrooms)
}

// =====================
// MODALS
// =====================
function showCreateModal() {
    document.getElementById('createModal').style.display = 'flex'
}

function showJoinModal() {
    document.getElementById('joinModal').style.display = 'flex'
}

function hideModals() {
    document.getElementById('createModal').style.display = 'none'
    document.getElementById('joinModal').style.display = 'none'
}

// =====================
// GENERATE ROOM CODE
// =====================
function generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
}

// =====================
// CREATE CLASSROOM
// =====================
async function createClassroom() {
    let subject = document.getElementById('subjectName').value
    let name = document.getElementById('classroomName').value

    if (subject === '' || name === '') {
        alert('Please fill in all fields')
        return
    }

    // get current user
    let { data: { user } } = await supabase.auth.getUser()

    // save to Supabase
    let { data, error } = await supabase
        .from('classrooms')
        .insert([{
            name: name,
            subject: subject,
            code: generateCode(),
            created_by: user.id
        }])
        .select()

    if (error) {
        alert('Error creating classroom: ' + error.message)
        return
    }

    // also add creator as a member
    await supabase
        .from('classroom_members')
        .insert([{
            classroom_id: data[0].id,
            user_id: user.id
        }])

    hideModals()

    document.getElementById('subjectName').value = ''
    document.getElementById('classroomName').value = ''

    loadClassrooms()
}

// =====================
// JOIN CLASSROOM
// =====================
async function joinClassroom() {
    let code = document.getElementById('roomCode').value.toUpperCase()

    if (code === '') {
        alert('Please enter a room code')
        return
    }

    // find classroom with this code
    let { data: classrooms, error } = await supabase
        .from('classrooms')
        .select('*')
        .eq('code', code)

    if (error || classrooms.length === 0) {
        alert('No classroom found with this code!')
        return
    }

    let classroom = classrooms[0]

    // get current user
    let { data: { user } } = await supabase.auth.getUser()

    // check if already a member
    let { data: existing } = await supabase
        .from('classroom_members')
        .select('*')
        .eq('classroom_id', classroom.id)
        .eq('user_id', user.id)

    if (existing.length === 0) {
        // add as member
        await supabase
            .from('classroom_members')
            .insert([{
                classroom_id: classroom.id,
                user_id: user.id
            }])
    }

    hideModals()
    loadClassrooms()
}

// =====================
// RENDER CLASSROOMS
// =====================
function renderClassrooms(classrooms) {
    let grid = document.getElementById('classroomGrid')
    let emptyMsg = document.getElementById('emptyMsg')

    if (!classrooms || classrooms.length === 0) {
        emptyMsg.style.display = 'block'
        return
    }

    emptyMsg.style.display = 'none'
    grid.innerHTML = ''

    let icons = ['📐', '🧬', '⚗️', '📖', '🌍', '💻', '🎨', '🏛️', '🔭', '📊']

    classrooms.forEach(function (classroom, index) {
        let card = document.createElement('div')
        card.className = 'classroom-card'
        card.innerHTML = `
            <div class="card-icon">${icons[index % icons.length]}</div>
            <h3>${classroom.name}</h3>
            <p>${classroom.subject}</p>
            <div class="card-footer">
                <span class="room-code">Code: ${classroom.code}</span>
            </div>
        `
        card.onclick = function () {
            localStorage.setItem('currentClassroom', JSON.stringify(classroom))
            window.location.href = 'classroom.html'
        }

        grid.appendChild(card)
    })
}

// =====================
// LOGOUT
// =====================
async function logout() {
    await supabase.auth.signOut()
    localStorage.clear()
    window.location.href = 'index.html'
}

// =====================
// EXPOSE FUNCTIONS TO HTML
// =====================
window.showCreateModal = showCreateModal
window.showJoinModal = showJoinModal
window.hideModals = hideModals
window.createClassroom = createClassroom
window.joinClassroom = joinClassroom
window.logout = logout