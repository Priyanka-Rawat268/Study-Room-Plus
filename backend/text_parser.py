import os
import pymupdf4llm

def extract_text(filepath: str, ext: str) -> str:
    """Extract text/markdown from the document locally using pymupdf4llm for PDFs."""
    if ext == 'pdf':
        try:
            print(f"[parser] Parsing PDF locally with pymupdf4llm: {filepath}")
            full_text = pymupdf4llm.to_markdown(filepath)
            
            if not full_text:
                print("[parser] WARNING: pymupdf4llm returned empty. Might be an image-only PDF without OCR config.")
                return ""

            print(f"[parser] Extracted {len(full_text)} characters.")
            return full_text
        except Exception as e:
            print(f"[parser] pymupdf4llm CRITICAL ERROR: {e}")
            import traceback
            traceback.print_exc()
            return ""
            
    elif ext == 'txt':
        return _extract_txt(filepath)
    
    return ''


def _extract_txt(filepath: str) -> str:
    """Read a plain-text file."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read().strip()
    except Exception as e:
        print(f"[parser] Text extraction failed: {e}")
        return ''

def chunk_parsed_text(text: str, max_words: int = 1500) -> list[str]:
    """Splits text by paragraphs ensuring no chunk exceeds max_words."""
    paragraphs = text.split('\n\n')
    chunks = []
    current_chunk = []
    current_len = 0
    
    for para in paragraphs:
        para_len = len(para.split())
        if current_len + para_len > max_words and current_chunk:
            chunks.append('\n\n'.join(current_chunk))
            current_chunk = [para]
            current_len = para_len
        else:
            current_chunk.append(para)
            current_len += para_len
            
    if current_chunk:
        chunks.append('\n\n'.join(current_chunk))
    return chunks
