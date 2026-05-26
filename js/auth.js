import { supabase } from './supabase.js'

// =====================
// GLOBAL EXPOSURE — Move to top for instant availability
// =====================
window.showLogin    = showLogin;
window.showSignup   = showSignup;
window.login        = login;
window.signup       = signup;
window.loginAsDemo  = loginAsDemo;
window.logout       = logout;
window.goBack       = goBack;

// =====================
// DEMO USER HELPERS
// =====================
const DEMO_USER = {
    email: 'demo@studyroom.plus',
    name:  'Demo User',
    id:    'demo-user-000',
    isDemo: true
}

export function isDemoUser() {
    return localStorage.getItem('demoUser') === 'true'
}

export function getDemoUser() {
    return DEMO_USER
}

function loginAsDemo() {
    localStorage.setItem('demoUser', 'true')
    localStorage.setItem('currentUser', DEMO_USER.email)
    localStorage.setItem('currentUserName', DEMO_USER.name)
    const demoClassroom = {
        id:         'demo-class-001',
        name:       'Demo Classroom',
        subject:    'Computer Science',
        code:       'DEMO01',
        created_by: DEMO_USER.id
    }
    localStorage.setItem('demoClassrooms', JSON.stringify([demoClassroom]))
    window.location.href = 'dashboard.html'
}

// =====================
// TAB SWITCHING
// =====================
function showLogin() {
    document.getElementById('loginForm').style.display = 'flex'
    document.getElementById('signupForm').style.display = 'none'
    document.querySelectorAll('.tab')[0].classList.add('active')
    document.querySelectorAll('.tab')[1].classList.remove('active')
}

function showSignup() {
    document.getElementById('signupForm').style.display = 'flex'
    document.getElementById('loginForm').style.display = 'none'
    document.querySelectorAll('.tab')[1].classList.add('active')
    document.querySelectorAll('.tab')[0].classList.remove('active')
}

// =====================
// AUTH LOGIC
// =====================
async function login() {
    let email    = document.getElementById('loginEmail').value
    let password = document.getElementById('loginPassword').value

    if (email === '' || password === '') {
        alert('Please fill in all fields')
        return
    }

    let { data, error } = await supabase.auth.signInWithPassword({
        email:    email,
        password: password
    })

    if (error) {
        alert('Login failed: ' + error.message)
        return
    }

    localStorage.removeItem('demoUser')
    localStorage.setItem('currentUser', data.user.email)
    localStorage.setItem('currentUserName', data.user.user_metadata.full_name || data.user.email)
    window.location.href = 'dashboard.html'
}

async function signup() {
    let name     = document.getElementById('signupName').value
    let email    = document.getElementById('signupEmail').value
    let password = document.getElementById('signupPassword').value

    if (name === '' || email === '' || password === '') {
        alert('Please fill in all fields')
        return
    }

    let { data, error } = await supabase.auth.signUp({
        email:    email,
        password: password,
        options:  { data: { full_name: name } }
    })

    if (error) {
        alert('Signup failed: ' + error.message)
        return
    }

    alert('Account created! Please check your email to confirm your account, then login.')
}

async function logout() {
    await supabase.auth.signOut();
    localStorage.clear();
    window.location.href = 'index.html';
}

function goBack() {
    window.history.back();
}