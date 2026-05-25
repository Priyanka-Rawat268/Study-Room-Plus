import os
import json
import re
import time
import google.generativeai as genai
from google.api_core import exceptions as google_exceptions
from dotenv import load_dotenv
from text_parser import chunk_parsed_text

load_dotenv(override=True)
genai.configure(api_key=os.getenv('GEMINI_API_KEY'))

# ─── Models ───────────────────────────────────────────────────────────────────
_MODEL_FALLBACK = [
    'models/gemini-2.5-flash',    # Primary — 20 RPD free tier
    'models/gemini-2.5-pro',      # Backup tier-1
    'models/gemini-2.0-flash',    # Backup tier-2
]

# ─── Preamble stripper ────────────────────────────────────────────────────────
_PREAMBLE_KEYWORDS = [
    'general instruction', 'important instruction', 'instructions to candidate',
    'read the following instruction', 'carefully read',
    'invigilator', 'omr', 'o.m.r', 'answer sheet', 'test booklet',
    'roll number', 'registration number', 'serial number',
    'negative marking', 'negative mark', 'marks will be deducted',
    'wrong answer', 'one-third', '1/3rd', '1/4th', 'one-fourth',
    'time allowed', 'maximum marks', 'total marks', 'full marks',
    'rough work', 'ball point pen', 'blue/black', 'blue pen', 'black pen',
    'do not open', 'seal', 'question booklet',
    'mobile phone', 'electronic device', 'calculator',
    'candidate must', 'candidates must', 'candidate should', 'candidates should',
    'centre superintendent', 'examination hall', 'examination center',
]

def _strip_preamble(text: str) -> str:
    lines = text.split('\n')
    scan_limit = max(10, len(lines) // 4)
    last_hit = -1
    for i, line in enumerate(lines[:scan_limit]):
        if any(kw in line.lower() for kw in _PREAMBLE_KEYWORDS):
            last_hit = i
    if last_hit == -1:
        return text
    skip_to = min(last_hit + 3, len(lines) - 1)
    print(f"[parser] Stripped preamble: skipped {skip_to} lines (last hit: line {last_hit})")
    return '\n'.join(lines[skip_to:]).strip()


# ─── System instructions ──────────────────────────────────────────────────────
_ANALYST_SYSTEM = (
    "You are an expert curriculum analyst. "
    "Analyse educational documents and return ONLY a raw JSON object — "
    "no markdown fences, no prose. "
    "Ignore all administrative headers like exam rules, time limits, marking schemes, "
    "OMR instructions, invigilator notes, and candidate conduct guidelines."
)

_QUIZ_SYSTEM = (
    "You are a high-fidelity subject-matter quiz-extraction and generation engine. "
    "Your goal is to extract ALL subject knowledge questions from the document. "
    "If the document looks like a test paper, extract the EXACT questions found. "
    "IMPORTANT: For complex questions like 'Match List I with List II' or 'Tables', "
    "YOU MUST PRESERVE the layout using newlines and spacing so it is readable. "
    "Output ONLY a raw JSON object."
)

# ─── Prompt: Document Analysis ────────────────────────────────────────────────
_ANALYSIS_PROMPT = """Analyse the following educational document and return a single JSON object
capturing its complete syllabus profile.

IGNORE completely: exam rules, time limits, marking schemes, OMR instructions, invigilator
directions, candidate conduct guidelines — these are logistics, not subject matter.

Required JSON structure (return ONLY this, no markdown):
{{
  "subject": "<main subject/domain, e.g. 'English Grammar' or 'Indian History'>",
  "content_summary": "<2-3 sentence overview of what this document teaches>",
  "topics_covered": ["<topic1>", "<topic2>", ...],
  "key_concepts": ["<concept1>", "<concept2>", ...],
  "difficulty_profile": {{
    "easy_pct": <integer 0-100, % of easy recall questions warranted>,
    "medium_pct": <integer 0-100, % of medium application questions>,
    "hard_pct": <integer 0-100, % of hard analytical questions>,
    "rationale": "<one sentence explaining why this difficulty balance suits this content>"
  }},
  "topic_weights": {{
    "<topic1>": <relative coverage weight 0-100>,
    "<topic2>": <relative coverage weight 0-100>
  }},
  "topic_linkages": [
    {{"from": "<topicA>", "to": "<topicB>", "relationship": "<how they conceptually connect>"}}
  ],
  "question_themes": ["<type of thinking e.g. 'factual recall', 'application', 'inference'>"],
  "marking_scheme": {{
    "correct": <float, e.g. 1.0>,
    "incorrect": <float, e.g. -0.33>,
    "unanswered": 0,
    "rationale": "<source from document, e.g. 'one-third penalty for wrong answers'>"
  }},
  "estimated_total_questions": <integer, count of questions in the document>,
  "regen_instructions": "<Detailed instructions for generating a NEW quiz...>"
}}

<DOCUMENT>
{text}
</DOCUMENT>

JSON object:"""

# ─── Prompt: Initial MCQ Generation ──────────────────────────────────────────
_MCQ_PROMPT = """Generate a high-quality MCQ quiz based strictly on the following SYLLABUS PROFILE and the provided <DOCUMENT>.

SYLLABUS PROFILE:
Subject: {subject}
Summary: {summary}
Topics: {topics}

TASK: Extract or generate as many questions as possible (aim for 30-100 questions to cover the full syllabus).
If <DOCUMENT> contains a real exam paper, extract the actual questions rather than generating new ones.

STRICT FORMATTING RULE:
- For 'Match the following' or tabular data, use multiple line breaks (\n) in the 'question' field to keep the columns aligned and readable.
- If the question is a 'Match List' type, format it strictly with arrays for list_1 and list_2, and ensure the correctOption maps them perfectly.
- Example for Match List: 
  "List I      List II\nA. Apple      1. Fruit\nB. Carrot      2. Vegetable"

STRICT RULES:
1. Questions test SUBJECT MATTER ONLY.
2. COMPLETELY IGNORE administrative rules, OMR info, or invigilator notes.
3. Four options (A, B, C, D). Exactly ONE correct.
4. Difficulty mix: {easy_pct}% easy, {medium_pct}% medium, {hard_pct}% hard.
5. No duplicates.
6. Return a raw JSON array only — no markdown, no extra text.

Schema for sections:
{{
  "marking_scheme": {{"correct": <float>, "incorrect": <float>, "unanswered": 0}},
  "sections": [
    {{
      "title": "<Section Title>",
      "directions": "<Instructions for this specific question block>",
      "questions": [
        {{"id":<int>,"question":"<string>","options":{{"A":"<string>","B":"<string>","C":"<string>","D":"<string>"}},"correct_answer":"<A|B|C|D>","explanation":"<string>","difficulty":"<string>","topic":"<string>"}}
      ]
    }}
  ]
}}

JSON object (starting with {{ ):"""

# ─── Prompt: Regeneration MCQ ─────────────────────────────────────────────────
_REGEN_PROMPT = """Generate a COMPLETELY NEW set of MCQ questions on the same subject as before.
Do NOT reuse, rephrase, or paraphrase any previous questions — create entirely fresh questions
testing the same knowledge from different angles.

SUBJECT PROFILE (derived from the original document):
Subject: {subject}
Topics covered (weights): {topic_weights}
Key concepts: {key_concepts}
Difficulty target: {easy_pct}% easy · {medium_pct}% medium · {hard_pct}% hard

Specific generation instructions:
{regen_instructions}

STRICT RULES:
1. Questions must be about the subject and topics listed above ONLY.
2. Match the exact difficulty distribution specified.
3. Each topic's question count must be proportional to its weight.
4. Four options (A, B, C, D). Exactly ONE correct.
5. No duplicates of questions from the original quiz.
6. Return a raw JSON array only — no markdown, no extra text.

Schema per element:
{{"id":<int>,"question":"<string>","options":{{"A":"<string>","B":"<string>","C":"<string>","D":"<string>"}},"correct_answer":"<A|B|C|D>","explanation":"<why this is correct>","difficulty":"<easy|medium|hard>","topic":"<topic name>"}}

JSON array (starting with [ ):"""

# ─── Prompt: Topic-Based MCQ (free-form user prompt) ──────────────────────
_TOPIC_PROMPT = """You are an expert academic quiz generator for B.Tech and undergraduate engineering students.

A student has given you the following request:
"{user_prompt}"

Based on this request:
1. Identify the SUBJECT (e.g. Operating Systems, Machine Learning, Engineering Maths).
2. Identify the specific TOPIC or sub-area being requested.
3. Choose an appropriate DIFFICULTY distribution (easy/medium/hard) if not specified — default to mixed (20% easy, 55% medium, 25% hard).
4. Generate exactly {num_questions} high-quality MCQs that directly answer this student’s request.

CONTENT GUIDELINES:
- Include numerical / calculation-based problems wherever the topic supports it.
- Cover a broad spread of sub-topics — do not cluster on one angle.
- Questions must be accurate, unambiguous, and solvable within 1.5 minutes.
- For programming / algorithm topics: include code-trace or complexity questions.
- For theoretical topics: include real-world application and comparison questions.
- Adjust style to match the request (e.g. if user says “easy”, skew easier; if “interview prep”, add tricky edge cases).
- NEVER include trick questions or ambiguous wording.

STRICT OUTPUT RULES:
1. Return ONLY a raw JSON object — no markdown, no prose.
2. Four options (A, B, C, D). Exactly ONE correct answer.
3. Provide a concise explanation per question.
4. No duplicate questions.
5. Populate the "title" field with a human-readable summary like "Operating Systems — Paging & Segmentation".

Schema:
{{
  "quiz_title": "<Subject — Topic inferred from request>",
  "marking_scheme": {{"correct": 1.0, "incorrect": -0.33, "unanswered": 0}},
  "sections": [
    {{
      "title": "<Section name e.g. Operating Systems — Paging>",
      "directions": "<Brief instructions for this section>",
      "questions": [
        {{"id": <int>, "question": "<string>", "options": {{"A": "<str>", "B": "<str>", "C": "<str>", "D": "<str>"}}, "correct_answer": "<A|B|C|D>", "explanation": "<string>", "difficulty": "<easy|medium|hard>", "topic": "<sub-topic>"}}
      ]
    }}
  ]
}}

JSON object (starting with {{ ):"""


def generate_mcqs_from_topic(
    user_prompt: str,
    num_questions: int = 20,
) -> dict:
    """
    Generate a B.Tech MCQ quiz from a free-form natural language user prompt.
    The AI infers subject, topic, difficulty, and style from the prompt itself.
    """
    prompt = _TOPIC_PROMPT.format(
        user_prompt=user_prompt,
        num_questions=num_questions,
    )

    try:
        raw     = generate_questions_with_backoff(prompt, _QUIZ_SYSTEM)
        cleaned = _clean_json(raw)
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError:
            repaired = _repair_json(cleaned)
            data = json.loads(repaired)
        data = _sanitize_dict_keys(data)
    except Exception as e:
        print(f"[generator] generate_mcqs_from_topic failed: {e}")
        return {"sections": [], "quiz_title": user_prompt[:60], "marking_scheme": {"correct": 1.0, "incorrect": -0.33, "unanswered": 0}}

    # Extract AI-generated title if present
    quiz_title = data.pop('quiz_title', user_prompt[:80])

    # Normalise output
    if 'sections' in data:
        for s in data['sections']:
            s['questions'] = _normalise_questions(s.get('questions', []))
        data['quiz_title'] = quiz_title
        return data

    # Fallback: flat array
    if isinstance(data, list):
        return {
            "quiz_title": quiz_title,
            "sections": [{"title": quiz_title, "directions": "", "questions": _normalise_questions(data)}],
            "marking_scheme": {"correct": 1.0, "incorrect": -0.33, "unanswered": 0},
        }

    return {"sections": [], "quiz_title": quiz_title, "marking_scheme": {"correct": 1.0, "incorrect": -0.33, "unanswered": 0}}


# ─── Model caller ─────────────────────────────────────────────────────────────
def _call_model(model_name: str, prompt: str, system: str, retries: int = 3) -> str:
    model = genai.GenerativeModel(model_name, system_instruction=system)
    delay = 8
    for attempt in range(retries):
        try:
            response = model.generate_content(prompt)
            return response.text.strip()
        except Exception as e:
            err = str(e)
            is_quota = '429' in err or 'quota' in err.lower()
            is_last  = attempt == retries - 1
            if is_quota and not is_last:
                print(f"[generator] {model_name} rate-limited — retrying in {delay}s…")
                time.sleep(delay)
                delay *= 2
            else:
                raise


def _try_models(prompt: str, system: str) -> str:
    last_error = None
    for model_name in _MODEL_FALLBACK:
        try:
            print(f"[generator] trying model: {model_name}")
            return _call_model(model_name, prompt, system)
        except Exception as e:
            print(f"[generator] {model_name} failed: {e}")
            last_error = e
    raise RuntimeError(f"All models exhausted. Last error: {last_error}")

from datetime import date

QUOTA_FILE = os.path.join(os.path.dirname(__file__), 'quota_tracker.json')

class QuotaTracker:
    def __init__(self, file_path=QUOTA_FILE):
        self.file_path = file_path
        self.data = self._load()

    def _load(self):
        if os.path.exists(self.file_path):
            try:
                with open(self.file_path, 'r') as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def _save(self):
        with open(self.file_path, 'w') as f:
            json.dump(self.data, f, indent=4)

    def can_make_request(self, model: str) -> str:
        today = str(date.today())
        now = time.time()
        if model not in self.data:
            self.data[model] = {'date': today, 'rpd': 0, 'rpm_timestamps': []}
            
        mdata = self.data[model]
        if mdata.get('date') != today:
            mdata['date'] = today
            mdata['rpd'] = 0
            mdata['rpm_timestamps'] = []
            
        mdata['rpm_timestamps'] = [ts for ts in mdata['rpm_timestamps'] if now - ts < 60]
        
        if mdata['rpd'] >= 18:
            return "RPD"
        if len(mdata['rpm_timestamps']) >= 3:
            return "RPM"
        return "OK"

    def record_request(self, model: str):
        self.can_make_request(model)
        self.data[model]['rpd'] += 1
        self.data[model]['rpm_timestamps'].append(time.time())
        self._save()

quota_tracker = QuotaTracker()


def generate_questions_with_backoff(prompt_chunk: str, system: str, max_retries: int = 4) -> str:
    # Each model has its own RPM token bucket. Cascade through them to bypass limits.
    # gemini-flash-latest = Gemini 3 Flash (highest priority)
    fallback_models = [
        'models/gemini-flash-latest',   # Gemini 3 Flash — primary
        'models/gemini-2.5-flash',      # Gemini 2.5 Flash — fallback 1
        'models/gemini-2.5-pro',        # Gemini 2.5 Pro  — fallback 2
    ]

    delay = 10
    total_models = len(fallback_models)

    for attempt in range(max_retries * total_models):
        active_model = fallback_models[attempt % total_models]

        # Predictive Block
        status = quota_tracker.can_make_request(active_model)
        if status == "RPD":
            print(f"[generator] {active_model} hit local Daily Safety limit (18 max). Skipping...")
            continue
        elif status == "RPM":
            print(f"[generator] {active_model} hit local Minute Safety limit (3 max). Swapping...")
            if attempt % total_models == total_models - 1:
                print(f"[generator] ALL models RPM-saturated. Waiting 60s for global refresh...")
                time.sleep(60)
            continue
            
        model = genai.GenerativeModel(
            active_model,
            system_instruction=system,
            generation_config={
                "response_mime_type": "application/json",
                "max_output_tokens": 8192,
            }
        )
        try:
            quota_tracker.record_request(active_model)
            response = model.generate_content(prompt_chunk)
            return response.text.strip()
        except google_exceptions.ResourceExhausted:
            is_last = attempt == (max_retries * total_models) - 1
            if not is_last:
                print(f"[generator] 429 on {active_model} — instantly swapping token buckets and retrying in {delay}s...")
                time.sleep(delay)
                # Keep delay lower since we are hopping to a brand new quota tier next iter!
            else:
                raise
        except Exception as e:
            print(f"[generator] Model {active_model} call failed: {e}")
            if attempt == (max_retries * total_models) - 1:
                raise


def _clean_json(raw: str) -> str:
    """
    Extracts the JSON block from a string.
    Finds balanced bounds to handle AI "chattiness".
    """
    raw = re.sub(r'^```(?:json)?', '', raw, flags=re.IGNORECASE)
    raw = re.sub(r'```$', '', raw)
    raw = raw.strip()

    # Find boundaries
    start_obj = raw.find('{')
    start_arr = raw.find('[')
    
    start = -1
    end = -1

    if start_obj != -1 and (start_arr == -1 or start_obj < start_arr):
        start = start_obj
        end = raw.rfind('}')
    elif start_arr != -1:
        start = start_arr
        end = raw.rfind(']')

    if start != -1 and end != -1:
        processed = raw[start:end+1].strip()
        # Basic sanity: must have at least one character inside
        if len(processed) > 2:
            return processed
    
    return raw.strip()


def _repair_json(raw: str) -> str:
    """
    Attempt to recover truncated JSON by closing open arrays/objects.
    Strategy: find the last complete top-level item boundary and close cleanly.
    """
    # Try clean parse first
    try:
        json.loads(raw)
        return raw
    except json.JSONDecodeError:
        pass

    # Walk backwards from end to find last full '}' or ']' that closes a complete item
    # For truncated arrays of objects: remove the incomplete trailing item, then close
    is_array = raw.lstrip().startswith('[')
    close_ch = ']' if is_array else '}'

    # Find last clean closing brace for an object element inside array
    last_good = raw.rfind('}')
    if last_good != -1:
        trimmed = raw[:last_good + 1]
        if is_array:
            # Strip any trailing comma then close the array
            trimmed = trimmed.rstrip().rstrip(',')
            trimmed += ']'
            # Wrap in sections structure if needed
        try:
            json.loads(trimmed)
            print(f"[generator] Repaired truncated JSON: recovered {len(trimmed)} chars")
            return trimmed
        except json.JSONDecodeError:
            pass

    return raw


def _sanitize_dict_keys(d):
    """Recursively clean any whitespace/quotes from dict keys AI might have added."""
    if not isinstance(d, dict):
        return d
    new_d = {}
    for k, v in d.items():
        # Strip newlines, spaces, and accidental quotes from keys
        new_k = str(k).strip().replace('\n', '').replace('"', '').replace("'", "")
        if isinstance(v, dict):
            new_d[new_k] = _sanitize_dict_keys(v)
        elif isinstance(v, list):
            new_d[new_k] = [_sanitize_dict_keys(i) if isinstance(i, dict) else i for i in v]
        else:
            new_d[new_k] = v
    return new_d


# ─── Public API ───────────────────────────────────────────────────────────────
def analyze_document(text: str) -> dict:
    clean = _strip_preamble(text)
    trimmed = clean[:12000]
    prompt = _ANALYSIS_PROMPT.format(text=trimmed)

    try:
        raw = _try_models(prompt, _ANALYST_SYSTEM)
        data = json.loads(_clean_json(raw))
        overview = _sanitize_dict_keys(data)
    except Exception as e:
        print(f"[generator] analyze_document failed: {e}")
        overview = {
            "subject": "Unknown",
            "content_summary": "Analysis failed.",
            "topics_covered": [],
            "difficulty_profile": {"easy_pct": 33, "medium_pct": 34, "hard_pct": 33},
            "marking_scheme": {"correct": 1.0, "incorrect": -0.33, "unanswered": 0}
        }

    # Normalise difficulty
    dp = overview.get('difficulty_profile', {})
    if not isinstance(dp, dict): dp = {}

    def _to_int(val, default):
        try:
            return int(str(val).replace('%', '').strip())
        except (ValueError, TypeError):
            return default

    easy   = _to_int(dp.get('easy_pct'),   30)
    medium = _to_int(dp.get('medium_pct'), 50)
    hard   = _to_int(dp.get('hard_pct'),   20)
    total  = easy + medium + hard
    if total != 100 and total > 0:
        overview['difficulty_profile'] = {
            'easy_pct': round(easy / total * 100),
            'medium_pct': round(medium / total * 100),
            'hard_pct': round(hard / total * 100)
        }

    return overview


TEST_MODE = os.getenv('TEST_MODE', 'true').lower() in ('true', '1', 't')

def generate_mcqs(text: str, overview: dict = None) -> dict:
    trimmed = _strip_preamble(text)
    full_chunks = chunk_parsed_text(trimmed, max_words=1500)
    
    if TEST_MODE:
        print(f"\n[generator] 🚀 RUNNING IN TEST MODE (TEST_MODE=true in .env)")
        print(f"[generator] 📊 PREDICTION & ESTIMATION:")
        print(f"[generator]    - Full scale document has {len(full_chunks)} total chunks.")
        print(f"[generator]    - We will only process 1 minimal chunk for testing.")
        
        # Take only the first chunk and truncate it slightly to save maximum tokens
        chunks = [full_chunks[0][:3000]] 
    else:
        chunks = full_chunks
        
    all_sections = []
    for i, chunk in enumerate(chunks):
        print(f"[generator] Processing chunk {i+1}/{len(chunks)}...")
        prompt = _MCQ_PROMPT.format(
            subject="General", 
            summary="Automatic Document Extraction", 
            topics="Multiple", 
            easy_pct=30, medium_pct=50, hard_pct=20
        ) + f"\n\n<DOCUMENT>\n{chunk}\n</DOCUMENT>"
        
        try:
            raw = generate_questions_with_backoff(prompt, _QUIZ_SYSTEM)
            data = json.loads(_clean_json(raw))
            data = _sanitize_dict_keys(data)
            
            if 'sections' in data:
                all_sections.extend(data['sections'])
            elif isinstance(data, list):
                all_sections.append({"title": f"Batch {i+1}", "directions": "", "questions": _normalise_questions(data)})
            else:
                all_sections.append({"title": f"Batch {i+1}", "directions": "", "questions": _normalise_questions(data.get('questions', []))})
                
        except Exception as e:
            print(f"[generator] Failed to process chunk {i+1}: {e}")
            
    return {
        "sections": all_sections,
        "marking_scheme": {"correct": 1.0, "incorrect": -0.33, "unanswered": 0}
    }


def generate_mcqs_from_overview(overview: dict) -> dict:
    dp = overview.get('difficulty_profile', {})
    tw = overview.get('topic_weights', {})
    tw_str = ', '.join(f"{t}: {w}%" for t, w in tw.items()) if tw else 'balanced across topics'

    prompt = _REGEN_PROMPT.format(
        subject            = overview.get('subject', 'the document subject'),
        topic_weights      = tw_str,
        key_concepts       = ', '.join(overview.get('key_concepts', [])),
        easy_pct           = dp.get('easy_pct',   30),
        medium_pct         = dp.get('medium_pct', 50),
        hard_pct           = dp.get('hard_pct',   20),
        regen_instructions = overview.get('regen_instructions', 'Cover all topics proportionally.'),
    )

    try:
        raw  = _try_models(prompt, _QUIZ_SYSTEM)
        data = json.loads(_clean_json(raw))
        data = _sanitize_dict_keys(data)
        
        if isinstance(data, list):
            return {"sections": [{"title": "General", "directions": "", "questions": _normalise_questions(data)}]}
        
        if "sections" in data:
            for s in data["sections"]:
                s["questions"] = _normalise_questions(s.get("questions", []))
            return data
    except Exception as e:
        print(f"[generator] regen failed: {e}")

    return {"sections": []}


def _normalise_questions(questions: list) -> list:
    if not isinstance(questions, list):
        return []
    
    valid_qs = []
    for i, q in enumerate(questions):
        if not isinstance(q, dict): continue
        
        # Ensure ID
        if 'id' not in q:
            q['id'] = i + 1
            
        # Ensure Ans
        ans = str(q.get('correct_answer', 'A')).upper().strip()
        q['correct_answer'] = ans if ans in ('A','B','C','D') else 'A'
        
        # Ensure Options
        opts = q.get('options', {})
        if not isinstance(opts, dict): q['options'] = {"A":"","B":"","C":"","D":""}
        
        q.setdefault('difficulty', 'medium')
        q.setdefault('topic', '')
        q.setdefault('explanation', '')
        valid_qs.append(q)
        
    return valid_qs
