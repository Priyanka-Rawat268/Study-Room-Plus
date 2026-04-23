import { supabase } from './supabase.js'

// =====================
// ON PAGE LOAD
// =====================
window.addEventListener('load', function () {
    renderNotes()
})

// =====================
// SHOW MODAL
// =====================
function showUploadModal() {
    document.getElementById('uploadModal').style.display = 'flex'
}

function hideUploadModal() {
    document.getElementById('uploadModal').style.display = 'none'
}

// =====================
// UPLOAD NOTE
// =====================
async function uploadNote() {
    let title = document.getElementById('noteTitle').value
    let desc = document.getElementById('noteDesc').value
    let file = document.getElementById('noteFile').files[0]

    if (title === '' || !file) {
        alert('Please enter a title and select a file')
        return
    }

    let { data: { user } } = await supabase.auth.getUser()
    let classroom = JSON.parse(localStorage.getItem('currentClassroom'))

    // upload file to Supabase Storage
    let filePath = classroom.id + '/' + Date.now() + '_' + file.name

    let { error: uploadError } = await supabase.storage
        .from('notes')
        .upload(filePath, file)

    if (uploadError) {
        alert('Error uploading file: ' + uploadError.message)
        return
    }

    // get public URL of the file
    let { data: urlData } = supabase.storage
        .from('notes')
        .getPublicUrl(filePath)

    // save note details to database
    let { error: dbError } = await supabase
        .from('notes')
        .insert([{
            title: title,
            description: desc,
            file_name: file.name,
            file_url: urlData.publicUrl,
            classroom_id: classroom.id,
            uploaded_by: user.id
        }])

    if (dbError) {
        alert('Error saving note: ' + dbError.message)
        return
    }

    hideUploadModal()

    document.getElementById('noteTitle').value = ''
    document.getElementById('noteDesc').value = ''
    document.getElementById('noteFile').value = ''

    renderNotes()
}

// =====================
// RENDER NOTES
// =====================
async function renderNotes() {
    let classroom = JSON.parse(localStorage.getItem('currentClassroom'))
    let grid = document.getElementById('notesGrid')
    let emptyMsg = document.getElementById('emptyNotes')

    let { data: notes, error } = await supabase
        .from('notes')
        .select('*')
        .eq('classroom_id', classroom.id)
        .order('created_at', { ascending: false })

    if (error) {
        console.log('Error loading notes:', error.message)
        return
    }

    if (!notes || notes.length === 0) {
        emptyMsg.style.display = 'block'
        return
    }

    emptyMsg.style.display = 'none'
    grid.innerHTML = ''

    notes.forEach(function (note) {
        let card = document.createElement('div')
        card.className = 'note-card'
        card.innerHTML = `
            <div class="note-icon">📄</div>
            <div class="note-info">
                <h4>${note.title}</h4>
                <p>${note.description || 'No description'} · ${note.file_name}</p>
            </div>
            <a href="${note.file_url}" target="_blank">Download</a>
        `
        grid.appendChild(card)
    })
}

window.showUploadModal = showUploadModal
window.hideUploadModal = hideUploadModal
window.uploadNote = uploadNote