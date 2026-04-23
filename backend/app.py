import os
import uuid
import json
from flask import Flask, request, jsonify, render_template, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from text_parser import extract_text
from generator import generate_mcqs, generate_mcqs_from_overview, analyze_document, generate_mcqs_from_topic
from quiz_store import (
    save_quiz, load_quiz, list_quizzes,
    save_overview, load_overview, load_overview_for_quiz,
)

load_dotenv()

app = Flask(__name__)
CORS(app)

_BASE        = os.path.dirname(__file__)
UPLOAD_FOLDER   = os.path.join(_BASE, 'uploads')
QUIZ_FOLDER     = os.path.join(_BASE, 'quizzes')
OVERVIEW_FOLDER = os.path.join(_BASE, 'overviews')
ALLOWED_EXTENSIONS = {'pdf', 'txt'}

for folder in (UPLOAD_FOLDER, QUIZ_FOLDER, OVERVIEW_FOLDER):
    os.makedirs(folder, exist_ok=True)


_MS_DEFAULTS = {'correct': 1.0, 'incorrect': -0.33, 'unanswered': 0.0}

def _clean_ms(raw: dict) -> dict:
    """
    Sanitize marking scheme keys that Gemini may have returned with embedded
    newlines/quotes (e.g. '\\n    \"correct\"'  instead of 'correct').
    Falls back to sensible defaults for any missing key.
    """
    cleaned = {}
    for k, v in (raw or {}).items():
        clean_key = str(k).strip().replace('\n', '').replace('"', '').replace("'", "")
        try:
            cleaned[clean_key] = float(v)
        except (TypeError, ValueError):
            pass
    # Fill missing keys with defaults
    for key, default in _MS_DEFAULTS.items():
        cleaned.setdefault(key, default)
    return cleaned


def allowed_file(filename: str) -> bool:
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS



# ─── Page routes ──────────────────────────────────────────────────────────────

# ── Study-Room-Plus frontend (served at /app/) ────────────────────────────────
_FRONTEND_DIR = os.path.abspath(os.path.join(_BASE, '..'))

@app.route('/app/')
@app.route('/app/<path:filename>')
def study_room(filename='index.html'):
    """Serve the Study-Room-Plus frontend from the project root."""
    return send_from_directory(_FRONTEND_DIR, filename)


# ── MC-QZ quiz pages ──────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/quiz')
def quiz_page():
    return render_template('quiz.html')

@app.route('/result')
def result_page():
    return render_template('result.html')

@app.route('/admin/upload')
def admin_upload_page():
    """Hidden admin page — not linked from any public UI."""
    return render_template('admin_upload.html')


# ─── API: Topic-Based Generation ────────────────────────────────────────────

@app.route('/api/generate-topic', methods=['POST'])
def generate_topic():
    body = request.get_json()
    if not body:
        return jsonify({'error': 'JSON body required'}), 400

    user_prompt   = (body.get('prompt') or '').strip()
    num_questions = max(5, min(50, int(body.get('num_questions', 20))))
    timer_minutes = max(1, min(180, int(body.get('timer_minutes', round(num_questions * 1.5)))))

    if not user_prompt:
        return jsonify({'error': 'Prompt is required'}), 400

    import hashlib
    cache_key = f"{user_prompt}|{num_questions}"
    quiz_id   = hashlib.md5(cache_key.encode()).hexdigest()[:8]

    # Idempotency: return cached quiz if it exists
    existing = os.path.join(QUIZ_FOLDER, f"{quiz_id}.json")
    if os.path.exists(existing):
        print(f"[app] Idempotent hit for topic quiz {quiz_id} — serving from cache.")
        quiz_data = load_quiz(quiz_id, QUIZ_FOLDER)
        total_q = sum(len(s.get('questions', [])) for s in quiz_data.get('sections', []))
        return jsonify({
            'quiz_id':        quiz_id,
            'question_count': total_q,
            'timer_minutes':  timer_minutes,
            'title':          quiz_data.get('title', user_prompt[:60]),
            'status':         'cached',
        })

    try:
        print(f"[app] Generating topic quiz: prompt={user_prompt!r}, n={num_questions}")
        gen_data = generate_mcqs_from_topic(user_prompt, num_questions)

        ai_title       = gen_data.pop('quiz_title', user_prompt[:80])
        marking_scheme = _clean_ms(gen_data.get('marking_scheme') or {})

        quiz_data = {
            'quiz_id':        quiz_id,
            'title':          ai_title,
            'source':         'topic',
            'prompt':         user_prompt,
            'timer_minutes':  timer_minutes,
            'marking_scheme': marking_scheme,
            'sections':       gen_data.get('sections', []),
        }
        save_quiz(quiz_id, quiz_data, QUIZ_FOLDER)
        total_q = sum(len(s.get('questions', [])) for s in quiz_data['sections'])

        return jsonify({
            'quiz_id':        quiz_id,
            'question_count': total_q,
            'timer_minutes':  timer_minutes,
            'title':          ai_title,
        })

    except Exception as e:
        import traceback
        print(f"[generate-topic] ERROR: {e}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ─── API: Upload & Generate ───────────────────────────────────────────────────

@app.route('/api/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    timer_minutes = request.form.get('timer_minutes', 10, type=int)
    timer_minutes = max(1, min(180, timer_minutes))

    if not file.filename:
        return jsonify({'error': 'No file selected'}), 400
    if not allowed_file(file.filename):
        return jsonify({'error': 'Only PDF and TXT files are allowed'}), 400

    import hashlib

    # Compute idempotent MD5 Hash of the file to act as the exact quiz_id
    file_bytes = file.read()
    file.seek(0) # IMPORTANT: reset file cursor before saving to disk
    
    file_hash = hashlib.md5(file_bytes)
    quiz_id = file_hash.hexdigest()[:8]
    
    ext      = file.filename.rsplit('.', 1)[1].lower()
    filename = f'{quiz_id}.{ext}'
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)

    try:
        # Idempotency check: Have we processed this exact file before?
        existing_quiz_path = os.path.join(QUIZ_FOLDER, f"{quiz_id}.json")
        if os.path.exists(existing_quiz_path):
            print(f"[app] Idempotent hit for {quiz_id}: Quiz already exists on disk. Bypassing AI generation.")
            quiz_data = load_quiz(quiz_id, QUIZ_FOLDER)
            total_q = sum(len(s.get('questions', [])) for s in quiz_data.get('sections', []))
            return jsonify({
                'quiz_id':        quiz_id,
                'question_count': total_q,
                'timer_minutes':  timer_minutes,
                'title':          file.filename,
                'status':         'cached'
            })

        text = extract_text(filepath, ext)
        if not text.strip():
            return jsonify({'error': 'Could not extract any text from the file'}), 400

        #  Call: Generate Syllabus Profile 
        print(f"[app] Analyzing Syllabus Overview for quiz_id={quiz_id}…")
        overview_data = analyze_document(text)
        save_overview(quiz_id, overview_data, OVERVIEW_FOLDER)

        # ── Call: Generate MCQs directly from parsed text ──
        print(f"[app] Generating MCQs for quiz_id={quiz_id}…")
        gen_data = generate_mcqs(text, overview_data) # returns {"sections": [...], "marking_scheme": {...}}

        # Merge marking scheme: prefer generator detected, then default
        marking_scheme = _clean_ms(
            gen_data.get('marking_scheme') or overview_data.get('marking_scheme') or {}
        )

        quiz_data = {
            'quiz_id':        quiz_id,
            'title':          file.filename,
            'source_file':    filename,
            'timer_minutes':  timer_minutes,
            'marking_scheme': marking_scheme,
            'sections':       gen_data.get('sections', []),
        }
        save_quiz(quiz_id, quiz_data, QUIZ_FOLDER)

        # Count total questions
        total_q = sum(len(s.get('questions', [])) for s in quiz_data['sections'])

        return jsonify({
            'quiz_id':        quiz_id,
            'question_count': total_q,
            'timer_minutes':  timer_minutes,
            'title':          file.filename,
        })

    except Exception as e:
        import traceback
        print(f"[upload] ERROR: {e}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500




# ─── API: Get Quiz (strip answers) ───────────────────────────────────────────

@app.route('/api/quiz/<quiz_id>', methods=['GET'])
def get_quiz(quiz_id):
    quiz = load_quiz(quiz_id, QUIZ_FOLDER)
    if not quiz:
        return jsonify({'error': 'Quiz not found'}), 404

    # Backwards compatibility for flat questions
    sections = quiz.get('sections')
    if not sections and 'questions' in quiz:
        sections = [{ 'title': 'General', 'directions': '', 'questions': quiz['questions'] }]

    # Strip answers
    safe_sections = []
    for s in sections:
        safe_q = [
            {'id': q['id'], 'question': q['question'], 'options': q['options']}
            for q in s.get('questions', [])
        ]
        safe_sections.append({
            'title': s.get('title', ''),
            'directions': s.get('directions', ''),
            'questions': safe_q
        })

    # Add estimated total if available from overview
    ov = load_overview_for_quiz(quiz_id, QUIZ_FOLDER, OVERVIEW_FOLDER)
    est_total = ov.get('estimated_total_questions', 0) if ov else 0

    return jsonify({
        'quiz_id':        quiz['quiz_id'],
        'title':          quiz['title'],
        'timer_minutes':  quiz.get('timer_minutes', 10),
        'marking_scheme': quiz.get('marking_scheme', {'correct': 1.0, 'incorrect': -0.33, 'unanswered': 0}),
        'sections':       safe_sections,
        'estimated_total_questions': est_total,
        'total_actual_questions': sum(len(s.get('questions',[])) for s in safe_sections)
    })


# ─── API: Submit & Score ──────────────────────────────────────────────────────

@app.route('/api/submit', methods=['POST'])
def submit():
    data         = request.get_json()
    quiz_id      = data.get('quiz_id')
    user_answers = data.get('answers', {})
    
    # Allow override from frontend if user edited the scheme
    override_ms  = data.get('marking_override')

    quiz = load_quiz(quiz_id, QUIZ_FOLDER)
    if not quiz:
        return jsonify({'error': 'Quiz not found'}), 404

    ms_raw = override_ms or quiz.get('marking_scheme', {})
    print(f"[submit] ms_raw keys: {list(ms_raw.keys()) if ms_raw else 'empty'}")
    print(f"[submit] override_ms from client: {repr(override_ms)}")
    ms = _clean_ms(ms_raw)
    
    # Flatten questions for scoring
    all_questions = []
    if 'sections' in quiz:
        for s in quiz['sections']:
            all_questions.extend(s.get('questions', []))
    else:
        all_questions = quiz.get('questions', [])

    try:
        mapping, score = [], 0.0
        for q in all_questions:
            q_id       = str(q['id'])
            user_ans   = user_answers.get(q_id)
            correct    = q['correct_answer']
            
            is_correct = False
            points = 0.0

            if user_ans == correct:
                is_correct = True
                points = float(ms.get('correct', 1.0))
            elif user_ans is None or user_ans == "":
                points = float(ms.get('unanswered', 0.0))
            else:
                points = float(ms.get('incorrect', -0.33))
            
            score += points
            mapping.append({
                'id':             q['id'],
                'question':       q['question'],
                'user_answer':    user_ans,
                'correct_answer': correct,
                'options':        q['options'],
                'explanation':    q.get('explanation', ''),
                'difficulty':     q.get('difficulty', 'medium'),
                'topic':          q.get('topic', ''),
                'is_correct':     is_correct,
                'points':         points
            })

        total_possible = len(all_questions) * float(ms.get('correct', 1.0))
        percentage = round((score / total_possible) * 100, 1) if total_possible > 0 else 0

    except Exception as e:
        import traceback
        print(f"[submit] SCORING ERROR: {e}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

    # Save result to disk for history viewing
    RESULT_FOLDER = os.path.join(_BASE, 'results')
    os.makedirs(RESULT_FOLDER, exist_ok=True)
    
    result_data = {
        'score':          round(score, 2),
        'total_possible': round(total_possible, 2),
        'percentage':     percentage,
        'title':          quiz.get('title', ''),
        'mapping':        mapping,
        'quiz_id':        quiz_id,
        'marking_scheme': ms,
        'submitted_at':   None
    }
    with open(os.path.join(RESULT_FOLDER, f"{quiz_id}.json"), "w") as f:
        json.dump(result_data, f)

    return jsonify({
        **result_data,
        'overview': load_overview_for_quiz(quiz_id, QUIZ_FOLDER, OVERVIEW_FOLDER)
    })


# ─── API: Get Result ─────────────────────────────────────────────────────────

@app.route('/api/result/<quiz_id>', methods=['GET'])
def get_result(quiz_id):
    RESULT_FOLDER = os.path.join(_BASE, 'results')
    path = os.path.join(RESULT_FOLDER, f"{quiz_id}.json")
    
    quiz = load_quiz(quiz_id, QUIZ_FOLDER)
    if not quiz:
        return jsonify({'error': 'Quiz not found'}), 404

    res = None
    if os.path.exists(path):
        with open(path, "r") as f:
            res = json.load(f)
    else:
        # Create a dummy "Review" result (0 score) so user can see answers
        all_questions = []
        if 'sections' in quiz:
            for s in quiz['sections']:
                all_questions.extend(s.get('questions', []))
        else:
            all_questions = quiz.get('questions', [])

        mapping = []
        for q in all_questions:
            mapping.append({
                'id':             q['id'],
                'question':       q['question'],
                'user_answer':    None,
                'correct_answer': q['correct_answer'],
                'options':        q['options'],
                'explanation':    q.get('explanation', ''),
                'difficulty':     q.get('difficulty', 'medium'),
                'topic':          q.get('topic', ''),
                'is_correct':     False,
                'points':         0
            })
        
        res = {
            'score':          0,
            'total_possible': len(all_questions),
            'percentage':     0,
            'title':          quiz.get('title', ''),
            'mapping':        mapping,
            'quiz_id':        quiz_id,
            'marking_scheme': quiz.get('marking_scheme', {}),
            'is_review_only': True
        }
    
    # Also attach overview
    res['overview'] = load_overview_for_quiz(quiz_id, QUIZ_FOLDER, OVERVIEW_FOLDER)
    return jsonify(res)



# ─── API: Regenerate Quiz ─────────────────────────────────────────────────────

@app.route('/api/regen/<parent_quiz_id>', methods=['POST'])
def regen(parent_quiz_id):
    """
    Generate a fresh quiz from the stored overview of parent_quiz_id.
    The parent can itself be a regen quiz — we walk up to find the root overview.
    """
    overview = load_overview_for_quiz(parent_quiz_id, QUIZ_FOLDER, OVERVIEW_FOLDER)
    if not overview:
        return jsonify({'error': 'Overview not found for this quiz'}), 404

    parent_quiz = load_quiz(parent_quiz_id, QUIZ_FOLDER)
    timer_minutes = (parent_quiz or {}).get('timer_minutes', 10)

    try:
        print(f"[app] Regenerating quiz from parent={parent_quiz_id}…")
        gen_data = generate_mcqs_from_overview(overview)

        new_id = str(uuid.uuid4())[:8]
        quiz_data = {
            'quiz_id':        new_id,
            'title':          (parent_quiz or {}).get('title', 'Quiz'),
            'timer_minutes':  timer_minutes,
            'marking_scheme': (parent_quiz or {}).get('marking_scheme', {'correct': 1.0, 'incorrect': -0.33, 'unanswered': 0}),
            'parent_quiz_id': parent_quiz_id,
            'sections':       gen_data.get('sections', []),
        }
        save_quiz(new_id, quiz_data, QUIZ_FOLDER)

        total_q = sum(len(s.get('questions', [])) for s in quiz_data['sections'])

        return jsonify({
            'quiz_id':        new_id,
            'question_count': total_q,
            'timer_minutes':  timer_minutes,
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── API: Overview ────────────────────────────────────────────────────────────

@app.route('/api/overview/<quiz_id>', methods=['GET'])
def get_overview(quiz_id):
    overview = load_overview_for_quiz(quiz_id, QUIZ_FOLDER, OVERVIEW_FOLDER)
    if not overview:
        return jsonify({'error': 'Overview not found'}), 404
    return jsonify(overview)


# ─── API: Quiz history ────────────────────────────────────────────────────────

@app.route('/api/quizzes', methods=['GET'])
def get_quizzes():
    return jsonify(list_quizzes(QUIZ_FOLDER))


if __name__ == '__main__':
    app.run(debug=True, port=5000)
