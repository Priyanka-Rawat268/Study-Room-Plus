// TAB SWITCHING
function showLogin() {
    // show login form, hide signup form
    document.getElementById('loginForm').style.display = 'flex'
    document.getElementById('signupForm').style.display = 'none'

    // make login tab active
    document.querySelectorAll('.tab')[0].classList.add('active')
    document.querySelectorAll('.tab')[1].classList.remove('active')
}

function showSignup() {
    // show signup form, hide login form
    document.getElementById('signupForm').style.display = 'flex'
    document.getElementById('loginForm').style.display = 'none'

    // make signup tab active
    document.querySelectorAll('.tab')[1].classList.add('active')
    document.querySelectorAll('.tab')[0].classList.remove('active')
}

// LOGIN
function login() {
    let email = document.getElementById('loginEmail').value
    let password = document.getElementById('loginPassword').value

    // check if fields are empty
    if (email === '' || password === '') {
        alert('Please fill in all fields')
        return
    }

    // for now just go to dashboard
    window.location.href = 'dashboard.html'
}

// SIGNUP
function signup() {
    let name = document.getElementById('signupName').value
    let email = document.getElementById('signupEmail').value
    let password = document.getElementById('signupPassword').value

    // check if fields are empty
    if (name === '' || email === '' || password === '') {
        alert('Please fill in all fields')
        return
    }

    // for now just go to dashboard
    window.location.href = 'dashboard.html'
}




// =====================
// DASHBOARD
// =====================

// this array will store all classrooms for now
let classrooms = []

// SHOW / HIDE MODALS
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

// GENERATE RANDOM ROOM CODE
function generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase()
}

// CREATE CLASSROOM
function createClassroom() {
    let subject = document.getElementById('subjectName').value
    let name = document.getElementById('classroomName').value

    // check if fields are empty
    if (subject === '' || name === '') {
        alert('Please fill in all fields')
        return
    }

    // create a classroom object
    let classroom = {
        id: generateCode(),
        subject: subject,
        name: name,
        code: generateCode()
    }

    // add to our array
    classrooms.push(classroom)

    // hide the modal
    hideModals()

    // clear the inputs
    document.getElementById('subjectName').value = ''
    document.getElementById('classroomName').value = ''

    // refresh the grid
    renderClassrooms()
}

// JOIN CLASSROOM
function joinClassroom() {
    let code = document.getElementById('roomCode').value.toUpperCase()

    if (code === '') {
        alert('Please enter a room code')
        return
    }

    // find the classroom with this code
    let found = classrooms.find(c => c.code === code)

    if (!found) {
        alert('No classroom found with this code!')
        return
    }

    // go to that classroom
    localStorage.setItem('currentClassroom', JSON.stringify(found))
    window.location.href = 'classroom.html'
}

// RENDER CLASSROOMS ON SCREEN
function renderClassrooms() {
    let grid = document.getElementById('classroomGrid')
    let emptyMsg = document.getElementById('emptyMsg')

    if (classrooms.length === 0) {
        emptyMsg.style.display = 'block'
        return
    }

    // hide empty message
    emptyMsg.style.display = 'none'

    // clear the grid first
    grid.innerHTML = ''

    // loop through classrooms and create a card for each
    classrooms.forEach(function(classroom) {
        let card = document.createElement('div')
        card.className = 'classroom-card'
        card.innerHTML = `
            <h3>${classroom.name}</h3>
            <p>${classroom.subject}</p>
            <span class="room-code">Code: ${classroom.code}</span>
        `
        // clicking a card opens that classroom
        card.onclick = function() {
            localStorage.setItem('currentClassroom', JSON.stringify(classroom))
            window.location.href = 'classroom.html'
        }

        grid.appendChild(card)
    })
}

// LOGOUT
function logout() {
    window.location.href = 'index.html'
}





// =====================
// CLASSROOM PAGE
// =====================

let notes = []
let quizzes = []

// LOAD CLASSROOM DETAILS
function loadClassroom() {
    let classroom = JSON.parse(localStorage.getItem('currentClassroom'))
    if (!classroom) return

    document.getElementById('classroomTitle').textContent = classroom.name
    document.getElementById('classroomSubject').textContent = classroom.subject
    document.getElementById('classroomCode').textContent = 'Code: ' + classroom.code
}

// SWITCH TABS
function showTab(tab) {
    // hide all tabs
    document.getElementById('notesTab').style.display = 'none'
    document.getElementById('quizTab').style.display = 'none'
    document.getElementById('meetingTab').style.display = 'none'

    // remove active from all tab buttons
    document.querySelectorAll('.classroom-tab').forEach(function(btn) {
        btn.classList.remove('active')
    })

    // show the selected tab
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
// NOTES
// =====================

function showUploadModal() {
    document.getElementById('uploadModal').style.display = 'flex'
}

function hideAllModals() {
    document.getElementById('uploadModal').style.display = 'none'
    document.getElementById('createQuizModal').style.display = 'none'
}

function uploadNote() {
    let title = document.getElementById('noteTitle').value
    let desc = document.getElementById('noteDesc').value
    let file = document.getElementById('noteFile').files[0]

    if (title === '' || !file) {
        alert('Please enter a title and select a file')
        return
    }

    // create a temporary URL for the file
    let fileURL = URL.createObjectURL(file)

    // create note object
    let note = {
        title: title,
        desc: desc,
        fileName: file.name,
        url: fileURL
    }

    notes.push(note)
    hideAllModals()

    // clear inputs
    document.getElementById('noteTitle').value = ''
    document.getElementById('noteDesc').value = ''
    document.getElementById('noteFile').value = ''

    renderNotes()
}

function renderNotes() {
    let grid = document.getElementById('notesGrid')
    let emptyMsg = document.getElementById('emptyNotes')

    if (notes.length === 0) {
        emptyMsg.style.display = 'block'
        return
    }

    emptyMsg.style.display = 'none'
    grid.innerHTML = ''

    notes.forEach(function(note) {
        let card = document.createElement('div')
        card.className = 'note-card'
        card.innerHTML = `
            <h4>${note.title}</h4>
            <p>${note.desc || 'No description'}</p>
            <a href="${note.url}" target="_blank">📄 ${note.fileName}</a>
        `
        grid.appendChild(card)
    })
}

// =====================
// QUIZ
// =====================

function showCreateQuizModal() {
    document.getElementById('createQuizModal').style.display = 'flex'
}

function createQuiz() {
    let title = document.getElementById('quizTitle').value
    let question = document.getElementById('quizQuestion').value
    let optionA = document.getElementById('optionA').value
    let optionB = document.getElementById('optionB').value
    let optionC = document.getElementById('optionC').value
    let optionD = document.getElementById('optionD').value
    let correct = document.getElementById('correctAnswer').value

    if (!title || !question || !optionA || !optionB || !optionC || !optionD || !correct) {
        alert('Please fill in all fields')
        return
    }

    let quiz = {
        title: title,
        question: question,
        options: { A: optionA, B: optionB, C: optionC, D: optionD },
        correct: correct,
        attempted: false
    }

    quizzes.push(quiz)
    hideAllModals()

    // clear inputs
    document.getElementById('quizTitle').value = ''
    document.getElementById('quizQuestion').value = ''
    document.getElementById('optionA').value = ''
    document.getElementById('optionB').value = ''
    document.getElementById('optionC').value = ''
    document.getElementById('optionD').value = ''
    document.getElementById('correctAnswer').value = ''

    renderQuizzes()
}

function renderQuizzes() {
    let grid = document.getElementById('quizGrid')
    let emptyMsg = document.getElementById('emptyQuiz')

    if (quizzes.length === 0) {
        emptyMsg.style.display = 'block'
        return
    }

    emptyMsg.style.display = 'none'
    grid.innerHTML = ''

    quizzes.forEach(function(quiz, index) {
        let card = document.createElement('div')
        card.className = 'quiz-card'
        card.innerHTML = `
            <h4>${quiz.title}</h4>
            <p>${quiz.question}</p>
            <div class="quiz-options">
                <button class="quiz-option" onclick="attemptQuiz(${index}, 'A')">A. ${quiz.options.A}</button>
                <button class="quiz-option" onclick="attemptQuiz(${index}, 'B')">B. ${quiz.options.B}</button>
                <button class="quiz-option" onclick="attemptQuiz(${index}, 'C')">C. ${quiz.options.C}</button>
                <button class="quiz-option" onclick="attemptQuiz(${index}, 'D')">D. ${quiz.options.D}</button>
            </div>
            <p id="quizResult${index}"></p>
        `
        grid.appendChild(card)
    })
}

function attemptQuiz(index, selected) {
    let quiz = quizzes[index]
    let resultEl = document.getElementById('quizResult' + index)
    let options = document.querySelectorAll('.quiz-card')[index].querySelectorAll('.quiz-option')

    // disable all options after answering
    options.forEach(function(btn) {
        btn.disabled = true
    })

    if (selected === quiz.correct) {
        options[['A','B','C','D'].indexOf(selected)].classList.add('correct')
        resultEl.textContent = '✅ Correct!'
        resultEl.style.color = '#10b981'
    } else {
        options[['A','B','C','D'].indexOf(selected)].classList.add('wrong')
        options[['A','B','C','D'].indexOf(quiz.correct)].classList.add('correct')
        resultEl.textContent = '❌ Wrong! Correct answer is ' + quiz.correct
        resultEl.style.color = '#ef4444'
    }
}

// =====================
// MEETING
// =====================

function saveMeetLink() {
    let link = document.getElementById('meetLink').value

    if (link === '') {
        alert('Please paste a meeting link')
        return
    }

    // show the link
    document.getElementById('meetLinkDisplay').style.display = 'block'
    document.getElementById('meetLinkAnchor').href = link
    document.getElementById('meetLinkAnchor').textContent = link
}

// =====================
// NAVIGATION
// =====================

function goBack() {
    window.location.href = 'dashboard.html'
}

// =====================
// INIT — runs when page loads
// =====================

window.onload = function() {
    // check which page we are on and run the right function
    if (document.getElementById('classroomTitle')) {
        loadClassroom()
    }
}