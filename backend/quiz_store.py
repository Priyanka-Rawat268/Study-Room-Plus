import os
import json
from datetime import datetime


# ─── Quiz ─────────────────────────────────────────────────────────────────────

def save_quiz(quiz_id: str, quiz_data: dict, quiz_folder: str) -> str:
    quiz_data['created_at'] = datetime.now().isoformat()
    
    # Calculate total question count
    if 'sections' in quiz_data:
        total = sum(len(s.get('questions', [])) for s in quiz_data['sections'])
        quiz_data['question_count'] = total
    else:
        quiz_data['question_count'] = len(quiz_data.get('questions', []))
    
    path = os.path.join(quiz_folder, f'{quiz_id}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(quiz_data, f, indent=2, ensure_ascii=False)
    return path


def append_questions(quiz_id: str, new_sections: list, quiz_folder: str):
    quiz = load_quiz(quiz_id, quiz_folder)
    if not quiz: return
    
    if 'sections' not in quiz: quiz['sections'] = []
    
    # Simple strategy: just append the new sections
    quiz['sections'].extend(new_sections)
    
    # Recalculate count
    total = sum(len(s.get('questions', [])) for s in quiz['sections'])
    quiz['question_count'] = total
    
    save_quiz(quiz_id, quiz, quiz_folder)


def load_quiz(quiz_id: str, quiz_folder: str):
    path = os.path.join(quiz_folder, f'{quiz_id}.json')
    if not os.path.exists(path):
        return None
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def list_quizzes(quiz_folder: str) -> list:
    quizzes = []
    if not os.path.exists(quiz_folder):
        return quizzes
    
    # Results folder to check completion
    results_folder = os.path.join(os.path.dirname(quiz_folder), "results")

    files = sorted(
        (f for f in os.listdir(quiz_folder) if f.endswith('.json')),
        key=lambda f: os.path.getmtime(os.path.join(quiz_folder, f)),
        reverse=True,
    )
    for filename in files:
        path = os.path.join(quiz_folder, filename)
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # Recalculate count if sections exist
            q_count = data.get('question_count', 0)
            if 'sections' in data:
                q_count = sum(len(s.get('questions', [])) for s in data['sections'])

            quiz_id = data.get('quiz_id')
            quizzes.append({
                'quiz_id':        quiz_id,
                'title':          data.get('title'),
                'created_at':     data.get('created_at'),
                'question_count': q_count,
                'parent_quiz_id': data.get('parent_quiz_id'),
                'has_result':     os.path.exists(os.path.join(results_folder, f"{quiz_id}.json"))
            })
        except Exception:
            continue
    return quizzes


# ─── Overview ─────────────────────────────────────────────────────────────────

def save_overview(quiz_id: str, overview: dict, overview_folder: str) -> str:
    overview['quiz_id']    = quiz_id
    overview['created_at'] = datetime.now().isoformat()
    path = os.path.join(overview_folder, f'{quiz_id}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(overview, f, indent=2, ensure_ascii=False)
    return path


def load_overview(quiz_id: str, overview_folder: str):
    """Load overview for quiz_id; also searches by parent_quiz_id chain."""
    path = os.path.join(overview_folder, f'{quiz_id}.json')
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return None


def load_overview_for_quiz(quiz_id: str, quiz_folder: str, overview_folder: str):
    """
    Load the correct overview for a quiz — either its own (original)
    or its parent's (if this is a regen quiz).
    """
    quiz = load_quiz(quiz_id, quiz_folder)
    if not quiz:
        return None
    # Regen quizzes store parent_quiz_id → use parent's overview
    source_id = quiz.get('parent_quiz_id') or quiz_id
    return load_overview(source_id, overview_folder)
