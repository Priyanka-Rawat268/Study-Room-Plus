import { supabase } from './supabase.js'

// =====================
// ON PAGE LOAD
// =====================
window.addEventListener('load', function () {
    renderQuizzes()
    loadMeetLink()
})

// =====================
// SHOW MODAL
// =====================
function showCreateQuizModal() {
    document.getElementById('createQuizModal').style.display = 'flex'
}

function hideCreateQuizModal() {
    document.getElementById('createQuizModal').style.display = 'none'
}

// =====================
// CREATE QUIZ
// =====================
async function createQuiz() {
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

    let { data: { user } } = await supabase.auth.getUser()
    let classroom = JSON.parse(localStorage.getItem('currentClassroom'))

    let { error } = await supabase
        .from('quizzes')
        .insert([{
            title: title,
            question: question,
            option_a: optionA,
            option_b: optionB,
            option_c: optionC,
            option_d: optionD,
            correct_answer: correct,
            classroom_id: classroom.id,
            created_by: user.id
        }])

    if (error) {
        alert('Error creating quiz: ' + error.message)
        return
    }

    hideCreateQuizModal()

    document.getElementById('quizTitle').value = ''
    document.getElementById('quizQuestion').value = ''
    document.getElementById('optionA').value = ''
    document.getElementById('optionB').value = ''
    document.getElementById('optionC').value = ''
    document.getElementById('optionD').value = ''
    document.getElementById('correctAnswer').value = ''

    renderQuizzes()
}

// =====================
// RENDER QUIZZES
// =====================
async function renderQuizzes() {
    let classroom = JSON.parse(localStorage.getItem('currentClassroom'))
    let grid = document.getElementById('quizGrid')
    let emptyMsg = document.getElementById('emptyQuiz')

    let { data: quizzes, error } = await supabase
        .from('quizzes')
        .select('*')
        .eq('classroom_id', classroom.id)
        .order('created_at', { ascending: false })

    if (error) {
        console.log('Error loading quizzes:', error.message)
        return
    }

    if (!quizzes || quizzes.length === 0) {
        emptyMsg.style.display = 'block'
        return
    }

    emptyMsg.style.display = 'none'
    grid.innerHTML = ''

    quizzes.forEach(function (quiz, index) {
        let card = document.createElement('div')
        card.className = 'quiz-card'
        card.innerHTML = `
            <h4>${quiz.title}</h4>
            <p>${quiz.question}</p>
            <div class="quiz-options">
                <button class="quiz-option" onclick="attemptQuiz(${index}, 'A', '${quiz.correct_answer}', this)">A. ${quiz.option_a}</button>
                <button class="quiz-option" onclick="attemptQuiz(${index}, 'B', '${quiz.correct_answer}', this)">B. ${quiz.option_b}</button>
                <button class="quiz-option" onclick="attemptQuiz(${index}, 'C', '${quiz.correct_answer}', this)">C. ${quiz.option_c}</button>
                <button class="quiz-option" onclick="attemptQuiz(${index}, 'D', '${quiz.correct_answer}', this)">D. ${quiz.option_d}</button>
            </div>
            <p id="quizResult${index}" style="font-size: 13px; font-weight: 500;"></p>
        `
        grid.appendChild(card)
    })
}

// =====================
// ATTEMPT QUIZ
// =====================
function attemptQuiz(index, selected, correct, clickedBtn) {
    let card = document.querySelectorAll('.quiz-card')[index]
    let options = card.querySelectorAll('.quiz-option')
    let resultEl = document.getElementById('quizResult' + index)

    // disable all options
    options.forEach(function (btn) {
        btn.disabled = true
    })

    let letters = ['A', 'B', 'C', 'D']

    if (selected === correct) {
        clickedBtn.classList.add('correct')
        resultEl.textContent = '✅ Correct!'
        resultEl.style.color = '#34d399'
    } else {
        clickedBtn.classList.add('wrong')
        options[letters.indexOf(correct)].classList.add('correct')
        resultEl.textContent = '❌ Wrong! Correct answer is ' + correct
        resultEl.style.color = '#f87171'
    }
}

// =====================
// MEETING
// =====================
function loadMeetLink() {
    let classroom = JSON.parse(localStorage.getItem('currentClassroom'))
    let savedLink = localStorage.getItem('meetLink_' + classroom.id)

    if (savedLink) {
        document.getElementById('meetLinkDisplay').style.display = 'block'
        document.getElementById('meetLinkAnchor').href = savedLink
        document.getElementById('meetLinkAnchor').textContent = savedLink
    }
}

function saveMeetLink() {
    let link = document.getElementById('meetLink').value
    let classroom = JSON.parse(localStorage.getItem('currentClassroom'))

    if (link === '') {
        alert('Please paste a meeting link')
        return
    }

    localStorage.setItem('meetLink_' + classroom.id, link)

    document.getElementById('meetLinkDisplay').style.display = 'block'
    document.getElementById('meetLinkAnchor').href = link
    document.getElementById('meetLinkAnchor').textContent = link
}

window.showCreateQuizModal = showCreateQuizModal
window.hideCreateQuizModal = hideCreateQuizModal
window.createQuiz = createQuiz
window.attemptQuiz = attemptQuiz
window.saveMeetLink = saveMeetLink