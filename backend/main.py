import json
import os
import re
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytz
import requests  # For HTTP requests to HF API and DxGPT
import uvicorn
import google.generativeai as genai
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Try to load .env file if python-dotenv is available
try:
    from dotenv import load_dotenv
    # Load .env from backend directory or parent directory
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
        print(f"[MediVoice] Loaded .env file from {env_path}")
    else:
        load_dotenv()  # Try default locations
except ImportError:
    pass  # python-dotenv not installed, skip .env loading

# Import prescription module
sys.path.insert(0, str(Path(__file__).parent.parent))
try:
    from prescription_module import get_ghana_suggestions
    PRESCRIPTION_MODULE_AVAILABLE = True
except ImportError as e:
    print(f"[MediVoice] Warning: Prescription module not available: {e}")
    PRESCRIPTION_MODULE_AVAILABLE = False

# Groq API Configuration
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "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")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.1-8b-instant"

# Debug: Check if GROQ_API_KEY is loaded (show first/last 4 chars for security)
if GROQ_API_KEY:
    token_preview = f"{GROQ_API_KEY[:4]}...{GROQ_API_KEY[-4:]}" if len(GROQ_API_KEY) > 8 else "***"
    print(f"[MediVoice] Groq API configured with model {GROQ_MODEL}")
else:
    print("[MediVoice] ⚠️  GROQ_API_KEY not found in environment variables")

# DxGPT API Configuration (legacy, may still be used in some fallback scenarios)
AZURE_API_KEY = os.getenv("AZURE_API_KEY", "8b431ac9f02849f589df297c730df8a2")
AZURE_API_URL = "https://dxgpt-apim.azure-api.net/api/diagnose"

# Gemini API Configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
# Default to gemini-2.0-flash (verified working via REST API)
# Fallback models: gemini-1.5-flash, gemini-1.5-pro, gemini-pro
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
GEMINI_FALLBACK_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro", "gemini-pro"]

if GEMINI_API_KEY:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        print(f"[MediVoice] Gemini configured with model {GEMINI_MODEL}")
        # Try to list available models for debugging
        try:
            all_models = list(genai.list_models())
            available_models = [
                m.name.replace("models/", "") 
                for m in all_models 
                if 'generateContent' in m.supported_generation_methods
            ]
            if available_models:
                print(f"[MediVoice] Available Gemini models: {', '.join(available_models)}")
                # Update fallback list to only include available models
                GEMINI_FALLBACK_MODELS = [m for m in available_models if m in GEMINI_FALLBACK_MODELS]
                if GEMINI_FALLBACK_MODELS:
                    print(f"[MediVoice] Using available models: {GEMINI_FALLBACK_MODELS}")
            else:
                print("[MediVoice] Warning: No Gemini models found with generateContent support")
        except Exception as e:
            print(f"[MediVoice] Could not list Gemini models: {e}")
    except Exception as e:
        print(f"[MediVoice] Warning: Could not configure Gemini: {e}")
else:
    print("[MediVoice] Gemini API key (GEMINI_API_KEY) not set; skipping Gemini.")


# Removed local model loading code - using cloud APIs instead


def _robust_json_extract(text: str) -> Dict[str, Any]:
    """
    Extracts the first JSON object from LLM output.
    Handles fenced blocks (```json ... ```), and raw inline JSON.
    """
    if not text or not text.strip():
        raise ValueError("Empty LLM output")

    # Prefer fenced JSON blocks
    fence = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text, flags=re.IGNORECASE)
    candidate = fence.group(1) if fence else None

    # Fallback: substring from first { to last }
    if candidate is None:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("No JSON object found in LLM output")
        candidate = text[start : end + 1]

    # Sanitize common issues
    candidate = candidate.strip()
    candidate = candidate.replace("\u201c", '"').replace("\u201d", '"').replace("\u2018", "'").replace(
        "\u2019", "'"
    )

    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        # Minimal last-chance cleanup: remove trailing commas and try again
        candidate2 = re.sub(r",\s*([}\]])", r"\1", candidate)
        return json.loads(candidate2)


# Removed unused functions - using cloud APIs instead


def _normalize_vitals(obj: Dict[str, Any]) -> Dict[str, Optional[str]]:
    # Ensure required keys exist; coerce values to strings if present.
    out: Dict[str, Optional[str]] = {"bp": None, "temp": None, "pulse": None, "spo2": None, "weight": None}
    if not isinstance(obj, dict):
        return out

    def pick(*keys: str) -> Optional[Any]:
        for k in keys:
            if k in obj and obj[k] not in (None, ""):
                return obj[k]
        return None

    out["bp"] = pick("bp", "blood_pressure", "bloodPressure")
    out["temp"] = pick("temp", "temperature")
    out["pulse"] = pick("pulse", "hr", "heart_rate", "heartRate")
    out["spo2"] = pick("spo2", "SpO2", "o2sat", "oxygen_saturation", "oxygenSaturation")
    out["weight"] = pick("weight", "wt", "body_weight", "bodyWeight")

    for k, v in list(out.items()):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            out[k] = str(v)
        elif isinstance(v, str):
            out[k] = v.strip()
        else:
            out[k] = json.dumps(v, ensure_ascii=False)
    return out


def extract_vitals_regex(text: str) -> Dict[str, Optional[str]]:
    """
    Free regex-based vitals extraction.
    Handles common patterns like "BP 140/90", "temp 37.5", etc.
    """
    text_lower = text.lower()
    vitals = {"bp": None, "temp": None, "pulse": None, "spo2": None, "weight": None}
    
    # Blood Pressure patterns
    bp_patterns = [
        r'bp[:\s]+(\d{2,3})[\/\-](\d{2,3})',
        r'blood\s+pressure[:\s]+(\d{2,3})[\/\-](\d{2,3})',
        r'pressure[:\s]+(\d{2,3})[\/\-](\d{2,3})',
        r'(\d{2,3})[\/\-](\d{2,3})\s*(?:mmhg|bp)',
        r'(\d{2,3})\s*over\s*(\d{2,3})',  # "140 over 90"
    ]
    for pattern in bp_patterns:
        match = re.search(pattern, text_lower)
        if match:
            vitals["bp"] = f"{match.group(1)}/{match.group(2)}"
            break
    
    # Temperature patterns
    temp_patterns = [
        r'temp(?:erature)?[:\s]+(\d{2}\.?\d?)',
        r'(\d{2}\.?\d?)\s*(?:degrees?|°)?\s*(?:celsius|c|f)',
        r'(\d{2}\.?\d?)\s*degrees?',
    ]
    for pattern in temp_patterns:
        match = re.search(pattern, text_lower)
        if match:
            vitals["temp"] = match.group(1)
            break
    
    # Pulse/Heart Rate
    pulse_patterns = [
        r'pulse[:\s]+(?:is\s+)?(\d{2,3})',
        r'heart\s+rate[:\s]+(?:is\s+)?(\d{2,3})',
        r'hr[:\s]+(?:is\s+)?(\d{2,3})',
        r'(\d{2,3})\s*bpm',
        r'pulse\s+(?:of\s+)?(\d{2,3})',
        r'heart\s+rate\s+(?:of\s+)?(\d{2,3})',
        r'(\d{2,3})\s*(?:beats?\s+)?per\s+minute',
    ]
    for pattern in pulse_patterns:
        match = re.search(pattern, text_lower)
        if match:
            vitals["pulse"] = match.group(1)
            break
    
    # SpO2 - More comprehensive patterns
    spo2_patterns = [
        # Direct SpO2 mentions
        r'spo2[:\s]+(?:is\s+)?(\d{2,3})',
        r'sp\s*o\s*2[:\s]+(?:is\s+)?(\d{2,3})',
        r's\s*p\s*o\s*2[:\s]+(?:is\s+)?(\d{2,3})',  # Speech recognition might add spaces
        r'spo\s*2[:\s]+(?:is\s+)?(\d{2,3})',
        
        # Oxygen saturation variations
        r'oxygen[:\s]+(?:saturation|sat)[:\s]+(?:is\s+)?(\d{2,3})',
        r'oxygen\s+(?:saturation|sat)[:\s]+(?:is\s+)?(\d{2,3})',
        r'saturation[:\s]+(?:is\s+)?(\d{2,3})',
        r'oxygen\s+level[:\s]+(?:is\s+)?(\d{2,3})',
        
        # O2 sat variations
        r'o2[:\s]+(?:sat|saturation)[:\s]+(?:is\s+)?(\d{2,3})',
        r'o\s*2[:\s]+(?:sat|saturation)[:\s]+(?:is\s+)?(\d{2,3})',
        r'o2\s*sat[:\s]+(?:is\s+)?(\d{2,3})',
        
        # Number first patterns
        r'(\d{2,3})\s*%?\s*(?:oxygen|o2|spo2|saturation)',
        r'(\d{2,3})\s*percent\s*(?:oxygen|o2|spo2)',
        r'(\d{2,3})\s*%\s*(?:oxygen|o2|spo2)',
        
        # Simple oxygen mentions (if number is in 90-100 range, likely SpO2)
        r'oxygen[:\s]+(?:is\s+)?(\d{2,3})',
        r'o2[:\s]+(?:is\s+)?(\d{2,3})',
    ]
    for pattern in spo2_patterns:
        match = re.search(pattern, text_lower)
        if match:
            value = match.group(1)
            # Validate: SpO2 is typically 80-100, but accept 70-100 for safety
            val_int = int(value)
            if 70 <= val_int <= 100:
                vitals["spo2"] = value
                break
    
    # Weight patterns
    weight_patterns = [
        r'weight[:\s]+(\d{2,3}\.?\d?)\s*(?:kg|kilograms?|kilos?)',
        r'(\d{2,3}\.?\d?)\s*(?:kg|kilograms?|kilos?)',
        r'weight[:\s]+(\d{2,3}\.?\d?)',
    ]
    for pattern in weight_patterns:
        match = re.search(pattern, text_lower)
        if match:
            vitals["weight"] = match.group(1)
            break
    
    return vitals


def extract_vitals_groq_api(transcript: str) -> Dict[str, Any]:
    """
    Extract vitals using Groq API with Llama 3 8B.
    """
    if not GROQ_API_KEY:
        print("[MediVoice] Warning: GROQ_API_KEY not set")
        return {}
    
    prompt = (
        "Extract vital signs from this medical transcript into STRICT JSON with keys: bp, temp, pulse, spo2, weight.\n"
        "- Use bp format like \"140/90\" when possible.\n"
        "- temp should be a number in Celsius if present.\n"
        "- pulse should be a number (bpm) if present.\n"
        "- spo2 (SpO2, oxygen saturation, O2 sat) should be a number between 70-100 (percent) if present. Look for: 'spo2', 'oxygen saturation', 'o2 sat', 'oxygen level', 'saturation'.\n"
        "- weight should be a number in kg if present.\n"
        "Return ONLY the JSON object (no markdown, no extra text).\n"
        f"Transcript: {transcript}"
    )
    
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": "You are a medical AI assistant. Always respond with valid JSON only."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.1,
        "max_tokens": 500
    }
    
    try:
        response = requests.post(
            GROQ_API_URL,
            headers=headers,
            json=payload,
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            generated_text = result.get("choices", [{}])[0].get("message", {}).get("content", "")
            return _robust_json_extract(generated_text)
        else:
            print(f"[MediVoice] Groq API error: {response.status_code} - {response.text}")
            
    except requests.exceptions.Timeout:
        print("[MediVoice] Groq API timeout")
    except Exception as e:
        print(f"[MediVoice] Groq API error: {e}")
    
    return {}


def extract_vitals_hybrid(transcript: str) -> Dict[str, Optional[str]]:
    """
    Hybrid approach: Accurate Groq API first, regex as offline fallback.
    Best accuracy when online, still works offline!
    """
    # Step 1: Try Groq API first (most accurate)
    vitals_groq = extract_vitals_groq_api(transcript)
    if vitals_groq:
        groq_norm = _normalize_vitals(vitals_groq)
        # If Groq API found at least one vital, use it
        if any(groq_norm.values()):
            print("[MediVoice] Using Groq API extraction (primary method)")
            return groq_norm
    
    # Step 2: Groq API failed or unavailable - use regex as offline fallback
    print("[MediVoice] Groq API unavailable, using regex fallback...")
    vitals_regex = extract_vitals_regex(transcript)
    
    # Step 3: If regex found some but not all, try to fill gaps with Groq API one more time
    # (in case it was a temporary network issue)
    missing = [k for k, v in vitals_regex.items() if v is None]
    if missing and GROQ_API_KEY:
        print(f"[MediVoice] Regex missed: {missing}, retrying Groq API to fill gaps...")
        vitals_groq_retry = extract_vitals_groq_api(transcript)
        if vitals_groq_retry:
            groq_norm_retry = _normalize_vitals(vitals_groq_retry)
            # Merge: use Groq for missing values
            for key in missing:
                if groq_norm_retry.get(key):
                    vitals_regex[key] = groq_norm_retry[key]
                    print(f"[MediVoice] Groq API filled missing {key}")
    
    return vitals_regex


def _get_dxgpt_diagnosis(description: str, vitals: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """
    Get diagnosis from DxGPT Azure API (FREE with your key).
    Returns list of diagnosis items compatible with DiagnosisItem format.
    """
    # Format description with vitals if provided
    full_description = description
    if vitals:
        bp = str(vitals.get("bp") or "").strip()
        temp = str(vitals.get("temp") or "").strip()
        pulse = str(vitals.get("pulse") or "").strip()
        spo2 = str(vitals.get("spo2") or "").strip()
        weight = str(vitals.get("weight") or "").strip()
        
        vitals_parts = []
        if bp:
            vitals_parts.append(f"BP {bp}")
        if temp:
            vitals_parts.append(f"Temperature {temp}°C")
        if pulse:
            vitals_parts.append(f"Pulse {pulse} bpm")
        if spo2:
            vitals_parts.append(f"SpO2 {spo2}%")
        if weight:
            vitals_parts.append(f"Weight {weight} kg")
        
        if vitals_parts:
            full_description += f". Vitals: {', '.join(vitals_parts)}."
    
    # Prepare DxGPT request
    payload = {
        "description": full_description,
        "myuuid": str(uuid.uuid4()),
        "lang": "en",
        "timezone": "Africa/Accra",  # Ghana timezone
        "diseases_list": "",
        "model": "gpt4o",
        "response_mode": "direct"
    }
    
    headers = {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "Ocp-Apim-Subscription-Key": AZURE_API_KEY
    }
    
    try:
        response = requests.post(AZURE_API_URL, json=payload, headers=headers, timeout=30)
        
        # Handle quota exceeded errors - return empty list to trigger Groq fallback
        if response.status_code == 403:
            error_data = response.json() if response.text else {}
            if "quota" in str(error_data).lower() or "quota" in response.text.lower():
                print("[MediVoice] DxGPT quota exceeded, will use Groq fallback")
                return []
        
        response.raise_for_status()
        data = response.json()
        
        # DEBUG: Print full response to see what DxGPT actually returns
        print("=" * 80)
        print("[MediVoice] DxGPT FULL RESPONSE:")
        print(json.dumps(data, indent=2, ensure_ascii=False))
        print("=" * 80)
        
        # Also log the first item structure if available
        if isinstance(data.get("data"), list) and len(data.get("data", [])) > 0:
            print("\n[MediVoice] First diagnosis item keys:", list(data["data"][0].keys()))
            print("[MediVoice] First diagnosis item:", json.dumps(data["data"][0], indent=2, ensure_ascii=False))
        
        # Convert DxGPT response to DiagnosisItem format
        diagnoses = []
        if data.get("result") == "success" and isinstance(data.get("data"), list):
            for item in data.get("data", [])[:3]:  # Top 3 diagnoses
                condition = item.get("diagnosis", "").strip()
                full_description = item.get("description", "").strip()
                
                # Extract brief reasoning (why it's this diagnosis) vs full description
                # Look for symptom matches or create a brief summary
                symptoms_in_common = item.get("symptoms_in_common", [])
                symptoms_not_in_common = item.get("symptoms_not_in_common", [])
                
                # Build brief reasoning based on symptom matches
                if symptoms_in_common:
                    reasoning_parts = [f"Matches {len(symptoms_in_common)} symptom(s): {', '.join(symptoms_in_common[:3])}"]
                    if len(symptoms_in_common) > 3:
                        reasoning_parts[0] += f" and {len(symptoms_in_common) - 3} more"
                    if symptoms_not_in_common:
                        reasoning_parts.append(f"Some symptoms ({len(symptoms_not_in_common)}) don't match")
                    brief_reasoning = ". ".join(reasoning_parts) + "."
                elif full_description:
                    # Use first sentence of description as brief reasoning
                    first_sentence = full_description.split('.')[0].strip()
                    if first_sentence and len(first_sentence) < len(full_description) * 0.7:
                        brief_reasoning = first_sentence + "."
                    else:
                        # If description is short, use it as-is
                        brief_reasoning = full_description[:150] + ("..." if len(full_description) > 150 else "")
                else:
                    brief_reasoning = "Based on symptom analysis and clinical presentation."
                
                # Calculate probability based on symptoms_in_common
                total_symptoms = len(symptoms_in_common) + len(symptoms_not_in_common)
                
                if total_symptoms > 0:
                    # Higher match = higher probability
                    probability = len(symptoms_in_common) / total_symptoms
                    # Boost if more symptoms match than don't match
                    if len(symptoms_in_common) > len(symptoms_not_in_common):
                        probability = min(1.0, probability * 1.2)
                else:
                    probability = 0.5  # Default if no symptom data
                
                if condition:
                    diagnoses.append({
                        "condition": condition,
                        "probability": min(1.0, max(0.0, probability)),
                        "reasoning": brief_reasoning,  # Brief "why" explanation
                        "detailed_reasoning": full_description if full_description and full_description != brief_reasoning else None  # Full description for expanded view
                    })
        
        return diagnoses
    except requests.exceptions.RequestException as e:
        print(f"[MediVoice] DxGPT API error: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"[MediVoice] Response: {e.response.text}")
        return []
    except Exception as e:
        print(f"[MediVoice] DxGPT processing error: {e}")
        return []

def _get_gemini_prescription(
    condition: str,
    diagnosis: str,
    patient_weight: Optional[str] = None,
    allergies: Optional[str] = None,
    age: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Get prescription recommendations using Gemini (Google AI).
    This is used as the most accurate primary AI source.
    """
    if not GEMINI_API_KEY:
        print("[MediVoice] Gemini API key not configured")
        return []

    # Build patient context
    patient_info: List[str] = []
    if age:
        patient_info.append(f"Age: {age} years")
    if patient_weight:
        patient_info.append(f"Weight: {patient_weight} kg")
    if allergies:
        patient_info.append(f"Allergies: {allergies}")
    patient_context = ". ".join(patient_info) or "No additional patient information."

    system_prompt = (
        "You are a clinical pharmacology assistant. "
        "Given a diagnosis and patient context, you must return SAFE, guideline-aligned prescriptions.\n"
        "Output STRICT JSON ONLY: an array of objects with keys:\n"
        "  \"medication\" (generic name),\n"
        "  \"dosage\" (specific amount like '10mg', '80/480 mg twice daily'),\n"
        "  \"frequency\" (e.g. 'twice daily', 'every 6 hours'),\n"
        "  \"duration\" (e.g. '7 days', 'until BP controlled'),\n"
        "  \"instructions\" (clear advice in plain English),\n"
        "  \"warnings\" (contraindications, pregnancy cautions, organ impairment, major interactions).\n"
        "Use Ghana primary care context when suggesting treatments. "
        "If unsure, be conservative and reflect uncertainty in the warnings."
    )

    user_prompt = (
        f"Diagnosis: {condition}\n"
        f"Clinical details: {diagnosis}\n"
        f"Patient: {patient_context}\n\n"
        "Return ONLY the JSON array, with no additional text."
    )

    # Try models in order: primary model, then fallbacks
    # Ensure gemini-2.0-flash is tried first if it's in the fallback list
    models_to_try = [GEMINI_MODEL] + [m for m in GEMINI_FALLBACK_MODELS if m != GEMINI_MODEL]
    # If gemini-2.0-flash is available, prioritize it
    if "gemini-2.0-flash" in models_to_try and models_to_try[0] != "gemini-2.0-flash":
        models_to_try.remove("gemini-2.0-flash")
        models_to_try.insert(0, "gemini-2.0-flash")
    
    # Track if all models failed with 404 (model not available) or 429 (quota exceeded)
    all_404 = True
    quota_exceeded = False
    
    for model_name in models_to_try:
        try:
            # Combine system prompt and user prompt into a single prompt
            # The google-generativeai SDK accepts a simple string prompt
            full_prompt = f"{system_prompt}\n\n{user_prompt}"
            
            model = genai.GenerativeModel(model_name)
            resp = model.generate_content(full_prompt)
            text = getattr(resp, "text", "") or ""
            
            all_404 = False  # At least one model didn't return 404
            
            if not text:
                print(f"[MediVoice] Gemini ({model_name}): empty response, trying next model...")
                continue
            
            # Extract JSON array from response
            start = text.find("[")
            end = text.rfind("]")
            if start == -1 or end == -1 or end <= start:
                print(f"[MediVoice] Gemini ({model_name}): no JSON array found, trying next model...")
                continue
            
            json_str = text[start : end + 1]
            data = json.loads(json_str)
            
            if isinstance(data, list) and len(data) > 0:
                print(f"[MediVoice] ✅ Gemini ({model_name}) generated {len(data)} prescription(s)")
                return data
            elif isinstance(data, list):
                print(f"[MediVoice] Gemini ({model_name}): empty list returned, trying next model...")
                continue
            else:
                print(f"[MediVoice] Gemini ({model_name}): JSON is not a list, trying next model...")
                continue
                
        except json.JSONDecodeError as e:
            all_404 = False
            print(f"[MediVoice] Gemini ({model_name}) JSON decode error: {e}, trying next model...")
            continue
        except Exception as e:
            error_msg = str(e)
            # If it's a 429 (quota exceeded), skip Gemini entirely
            if "429" in error_msg or "quota" in error_msg.lower() or "exceeded" in error_msg.lower():
                quota_exceeded = True
                print(f"[MediVoice] ⚠️  Gemini quota exceeded (429). Skipping Gemini, using Groq instead.")
                break  # Exit loop immediately - no point trying other models
            # If it's a 404 (model not found), try next model
            elif "404" in error_msg or "not found" in error_msg.lower():
                print(f"[MediVoice] Gemini ({model_name}) not available: {error_msg[:100]}, trying next model...")
                # Keep all_404 = True if this is a 404
            else:
                all_404 = False
                # Other errors: log and try next model
                print(f"[MediVoice] Gemini ({model_name}) error: {error_msg[:100]}, trying next model...")
                continue
    
    # All models failed
    if quota_exceeded:
        print("[MediVoice] ⚠️  Gemini API quota exceeded. Using Groq for prescriptions.")
        print("[MediVoice]    To fix: 1) Check your Google Cloud billing/quota limits")
        print("[MediVoice]           2) Wait for quota reset or upgrade your plan")
    elif all_404:
        print("[MediVoice] ⚠️  All Gemini models returned 404. Your API key may not have access to Gemini models.")
        print("[MediVoice]    Check: 1) Enable Gemini API in Google Cloud Console")
        print("[MediVoice]          2) Verify API key has correct permissions")
        print("[MediVoice]          3) Check billing is enabled (free tier is OK)")
    else:
        print("[MediVoice] All Gemini models failed. Using Groq for prescriptions.")
    return []

def _match_ai_medication_to_nhis(ai_medication: str, nhis_drugs: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Match AI-suggested medication with NHIS-compliant drugs from Ghana Essential Medicines List.
    Uses fuzzy matching to find the best match.
    
    Args:
        ai_medication: Medication name suggested by AI
        nhis_drugs: List of NHIS-compliant drugs from Ghana Essential Medicines List
    
    Returns:
        Matched NHIS drug if found, None otherwise
    """
    if not ai_medication or not nhis_drugs:
        return None
    
    ai_med_lower = ai_medication.lower().strip()
    
    # Direct match
    for drug in nhis_drugs:
        generic_name = drug.get("generic_name", "").lower()
        if ai_med_lower == generic_name:
            return drug
    
    # Partial match (contains)
    for drug in nhis_drugs:
        generic_name = drug.get("generic_name", "").lower()
        # Check if AI medication contains generic name or vice versa
        if ai_med_lower in generic_name or generic_name in ai_med_lower:
            return drug
    
    # Word-based matching (check if key words match)
    ai_words = set(ai_med_lower.split())
    for drug in nhis_drugs:
        generic_name = drug.get("generic_name", "").lower()
        drug_words = set(generic_name.split())
        # If significant overlap in words
        if ai_words and drug_words:
            overlap = len(ai_words.intersection(drug_words))
            if overlap >= 1 and overlap >= len(ai_words) * 0.5:  # At least 50% word overlap
                return drug
    
    return None


def _get_rule_based_diagnosis(symptoms: str, vitals: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """
    Simple rule-based diagnosis fallback when AI services are unavailable.
    Provides basic diagnoses based on common symptom patterns.
    """
    symptoms_lower = symptoms.lower()
    diagnoses = []
    
    # Fever patterns
    if any(word in symptoms_lower for word in ["fever", "high temperature", "chills", "sweating"]):
        if "headache" in symptoms_lower and "body ache" in symptoms_lower:
            diagnoses.append({
                "condition": "Viral Infection (likely)",
                "probability": 0.65,
                "reasoning": "Fever with headache and body aches suggests viral infection",
                "detailed_reasoning": "Common presentation of viral infections including influenza, COVID-19, or other viral illnesses. Recommend symptomatic treatment and monitoring."
            })
        else:
            diagnoses.append({
                "condition": "Fever (unspecified cause)",
                "probability": 0.5,
                "reasoning": "Fever present, requires further evaluation",
                "detailed_reasoning": "Fever can indicate infection, inflammation, or other conditions. Clinical assessment and possibly lab tests needed."
            })
    
    # Respiratory patterns
    if any(word in symptoms_lower for word in ["cough", "shortness of breath", "chest pain", "wheezing"]):
        diagnoses.append({
            "condition": "Respiratory Tract Infection",
            "probability": 0.6,
            "reasoning": "Respiratory symptoms suggest upper or lower respiratory infection",
            "detailed_reasoning": "May be bronchitis, pneumonia, or upper respiratory infection. Consider chest X-ray if severe."
        })
    
    # Pain patterns
    if "headache" in symptoms_lower and "severe" in symptoms_lower:
        diagnoses.append({
            "condition": "Severe Headache (requires evaluation)",
            "probability": 0.7,
            "reasoning": "Severe headache may indicate migraine, tension headache, or more serious conditions",
            "detailed_reasoning": "Severe headaches require clinical evaluation to rule out serious causes like meningitis, stroke, or intracranial pressure."
        })
    
    # Hypothermia pattern
    if any(word in symptoms_lower for word in ["hypothermia", "low temperature", "cold", "unconscious"]):
        temp = vitals.get("temp") if vitals else None
        if temp:
            try:
                temp_val = float(str(temp).replace("°C", "").replace("C", "").strip())
                if temp_val < 35:
                    diagnoses.append({
                        "condition": "Hypothermia",
                        "probability": 0.9,
                        "reasoning": f"Low body temperature ({temp}°C) indicates hypothermia",
                        "detailed_reasoning": "Hypothermia is a medical emergency. Requires immediate rewarming and monitoring."
                    })
            except:
                pass
    
    # If no specific pattern matched, provide generic diagnosis based on symptoms
    if not diagnoses:
        # Try to extract key symptoms for a more specific generic diagnosis
        key_symptoms = []
        if "pain" in symptoms_lower:
            key_symptoms.append("pain")
        if "fever" in symptoms_lower or "temperature" in symptoms_lower:
            key_symptoms.append("fever")
        if "nausea" in symptoms_lower or "vomiting" in symptoms_lower:
            key_symptoms.append("gastrointestinal symptoms")
        if "dizziness" in symptoms_lower or "weakness" in symptoms_lower:
            key_symptoms.append("neurological symptoms")
        
        symptom_summary = ", ".join(key_symptoms) if key_symptoms else "presenting symptoms"
        
        diagnoses.append({
            "condition": "Clinical Assessment Required",
            "probability": 0.5,
            "reasoning": f"Patient presents with {symptom_summary}. Requires clinical evaluation.",
            "detailed_reasoning": f"Unable to provide specific diagnosis without AI services. Patient reports: {symptoms[:200]}. Please consult with a healthcare provider for proper evaluation and diagnosis."
        })
    
    return diagnoses


def _get_groq_diagnosis(description: str, vitals: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """
    Get diagnosis recommendations using Groq API with Llama 3 8B.
    """
    if not GROQ_API_KEY:
        print("[MediVoice] Warning: GROQ_API_KEY not set")
        return []
    
    # Format description with vitals if provided
    full_description = description
    if vitals:
        vitals_parts = []
        if vitals.get("bp"):
            vitals_parts.append(f"BP {vitals['bp']}")
        if vitals.get("temp"):
            vitals_parts.append(f"Temperature {vitals['temp']}°C")
        if vitals.get("pulse"):
            vitals_parts.append(f"Pulse {vitals['pulse']} bpm")
        if vitals.get("spo2"):
            vitals_parts.append(f"SpO2 {vitals['spo2']}%")
        if vitals.get("weight"):
            vitals_parts.append(f"Weight {vitals['weight']} kg")
        
        if vitals_parts:
            full_description += f". Vitals: {', '.join(vitals_parts)}."
    
    prompt = (
        "You are a medical AI assistant specializing in clinical diagnosis. Analyze the patient symptoms and provide differential diagnoses in STRICT JSON format.\n"
        "Return as JSON array with objects containing: diagnosis (condition name), probability (0.0 to 1.0), reasoning (brief explanation of why this diagnosis matches), detailed_reasoning (full clinical analysis).\n"
        "Format:\n"
        "[{\"diagnosis\": \"condition name\", \"probability\": 0.85, \"reasoning\": \"brief why\", \"detailed_reasoning\": \"full analysis\"}]\n"
        "Return ONLY the JSON array, no markdown, no extra text. Provide 2-3 most likely diagnoses.\n\n"
        f"Patient presentation: {full_description}\n"
        "Provide differential diagnoses with probabilities and reasoning."
    )
    
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": "You are a medical AI assistant. Always respond with valid JSON only."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3,
        "max_tokens": 2000
    }
    
    try:
        print(f"[MediVoice] Calling Groq API: {GROQ_MODEL}")
        response = requests.post(
            GROQ_API_URL,
            headers=headers,
            json=payload,
            timeout=60
        )
        
        if response.status_code == 200:
            result = response.json()
            generated_text = result.get("choices", [{}])[0].get("message", {}).get("content", "")
            print(f"[MediVoice] ✅ Groq API call successful")
            print(f"[MediVoice] Generated text length: {len(generated_text)}")
            print(f"[MediVoice] Generated text preview: {generated_text[:300]}")
            
            # Extract JSON from response
            try:
                # Try to find JSON array first
                json_match = re.search(r'\[[\s\S]*?\]', generated_text)
                if json_match:
                    json_str = json_match.group(0)
                    diagnoses = json.loads(json_str)
                    if isinstance(diagnoses, list) and len(diagnoses) > 0:
                        print(f"[MediVoice] ✅ Groq generated {len(diagnoses)} diagnosis(es)")
                        # Ensure all required fields are present
                        for diag in diagnoses:
                            if "diagnosis" not in diag:
                                diag["diagnosis"] = diag.get("condition", "")
                            if "probability" not in diag:
                                diag["probability"] = 0.7
                            if "reasoning" not in diag:
                                diag["reasoning"] = diag.get("detailed_reasoning", "Based on symptom analysis.")
                            if "detailed_reasoning" not in diag:
                                diag["detailed_reasoning"] = diag.get("reasoning", "")
                        return [d for d in diagnoses if d.get("diagnosis")]
                
                # Fallback: try to extract single JSON object
                json_match = re.search(r'\{[\s\S]*?\}', generated_text)
                if json_match:
                    diagnosis = json.loads(json_match.group(0))
                    if isinstance(diagnosis, dict) and diagnosis.get("diagnosis"):
                        if "probability" not in diagnosis:
                            diagnosis["probability"] = 0.7
                        if "reasoning" not in diagnosis:
                            diagnosis["reasoning"] = diagnosis.get("detailed_reasoning", "Based on symptom analysis.")
                        if "detailed_reasoning" not in diagnosis:
                            diagnosis["detailed_reasoning"] = diagnosis.get("reasoning", "")
                        print(f"[MediVoice] ✅ Groq generated 1 diagnosis")
                        return [diagnosis]
                
                print("[MediVoice] Could not extract diagnoses from Groq response")
            except json.JSONDecodeError as e:
                print(f"[MediVoice] Groq JSON parse error: {e}")
                print(f"[MediVoice] Raw response: {generated_text[:500]}")
        else:
            print(f"[MediVoice] ❌ Groq API error: {response.status_code} - {response.text[:200]}")
            return []
    
    except requests.exceptions.Timeout:
        print("[MediVoice] ❌ Groq API timeout (60s)")
        return []
    except Exception as e:
        print(f"[MediVoice] ❌ Groq API error: {e}")
        return []
    
    return []


def _get_groq_prescription(condition: str, diagnosis: str, patient_weight: Optional[str] = None,
                                allergies: Optional[str] = None, age: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Get prescription recommendations using Groq API with Llama 3 8B.
    """
    if not GROQ_API_KEY:
        print("[MediVoice] Warning: GROQ_API_KEY not set")
        return []
    
    # Build comprehensive prompt
    patient_info = []
    if age:
        patient_info.append(f"Age: {age} years")
    if patient_weight:
        patient_info.append(f"Weight: {patient_weight} kg")
    if allergies:
        patient_info.append(f"Allergies: {allergies}")
    
    patient_context = ". ".join(patient_info) if patient_info else "No additional patient information."
    
    prompt = (
        "You are a medical AI assistant specializing in clinical pharmacology. Provide specific prescription recommendations in STRICT JSON format.\n"
        "For the given diagnosis, suggest appropriate medications with SPECIFIC dosages, frequencies, and durations based on clinical guidelines.\n"
        "Return as JSON array with objects containing: medication (generic name), dosage (specific amount like '10mg', '25mg twice daily'), frequency (e.g., 'twice daily', 'once daily', 'every 6 hours'), duration (e.g., '7 days', 'until BP controlled'), instructions (clinical guidance), warnings (contraindications/side effects).\n"
        "Format:\n"
        "[{\"medication\": \"drug generic name\", \"dosage\": \"specific dose\", \"frequency\": \"how often\", \"duration\": \"how long\", \"instructions\": \"clinical guidance\", \"warnings\": \"safety info\"}]\n"
        "Return ONLY the JSON array, no markdown, no extra text. Be specific with dosages.\n\n"
        f"Diagnosis: {condition}\n"
        f"Clinical Details: {diagnosis}\n"
        f"Patient Information: {patient_context}\n"
        "Provide specific medication recommendations with exact dosages based on standard treatment protocols."
    )
    
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": "You are a medical AI assistant. Always respond with valid JSON only."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3,
        "max_tokens": 2000
    }
    
    try:
        print(f"[MediVoice] Calling Groq API for prescription: {GROQ_MODEL}")
        response = requests.post(
            GROQ_API_URL,
            headers=headers,
            json=payload,
            timeout=60
        )
        
        if response.status_code == 200:
            result = response.json()
            generated_text = result.get("choices", [{}])[0].get("message", {}).get("content", "")
            print(f"[MediVoice] ✅ Groq prescription API call successful")
            print(f"[MediVoice] Generated text length: {len(generated_text)}")
            print(f"[MediVoice] Generated text preview: {generated_text[:300]}")
            
            # Extract JSON from response
            try:
                # Try to find JSON array in the response
                json_match = re.search(r'\[[\s\S]*?\]', generated_text)
                if json_match:
                    prescriptions = json.loads(json_match.group(0))
                    if isinstance(prescriptions, list):
                        print(f"[MediVoice] ✅ Groq generated {len(prescriptions)} prescription(s)")
                        return prescriptions

                # Fallback: try to extract single JSON object
                json_match = re.search(r'\{[\s\S]*?\}', generated_text)
                if json_match:
                    prescription = json.loads(json_match.group(0))
                    if isinstance(prescription, dict):
                        return [prescription]
            except json.JSONDecodeError as e:
                print(f"[MediVoice] Groq JSON parse error: {e}")
                print(f"[MediVoice] Raw response: {generated_text[:500]}")
        else:
            print(f"[MediVoice] ❌ Groq prescription API error: {response.status_code} - {response.text[:200]}")
            return []
    
    except requests.exceptions.Timeout:
        print("[MediVoice] ❌ Groq prescription API timeout (60s)")
        return []
    except Exception as e:
        print(f"[MediVoice] ❌ Groq prescription API error: {e}")
        return []

    return []


def _get_common_emergency_prescriptions(condition: str, diagnosis: str) -> List[Dict[str, Any]]:
    """
    Knowledge base of common emergency medications for conditions not in NHIS database.
    Provides specific prescriptions for urgent conditions.
    """
    condition_lower = condition.lower()
    diagnosis_lower = diagnosis.lower()
    combined = f"{condition_lower} {diagnosis_lower}"
    
    prescriptions = []
    
    # Hypertensive Crisis / Hypertension Emergency
    if "hypertensive" in combined or "hypertension" in combined or "high blood pressure" in combined:
        if "crisis" in combined or "emergency" in combined or "severe" in combined:
            prescriptions.append({
                "medication": "Labetalol",
                "dosage": "20-80mg IV bolus, then 0.5-2mg/min infusion",
                "frequency": "As needed for BP control",
                "duration": "Until BP < 180/120 mmHg",
                "instructions": "Hypertensive emergency. Monitor BP every 15 minutes. Target: reduce BP by 25% in first hour, then gradually to normal over 24-48 hours.",
                "warnings": "Contraindicated in heart failure, asthma. Monitor for hypotension."
            })
            prescriptions.append({
                "medication": "Nifedipine",
                "dosage": "10-20mg sublingual or oral",
                "frequency": "Every 30 minutes if needed",
                "duration": "Until BP controlled",
                "instructions": "Alternative for hypertensive crisis. Monitor BP closely.",
                "warnings": "May cause reflex tachycardia. Use with caution in elderly."
            })
        else:
            # Chronic hypertension
            prescriptions.append({
                "medication": "Amlodipine",
                "dosage": "5-10mg once daily",
                "frequency": "Once daily",
                "duration": "Long-term",
                "instructions": "First-line treatment for hypertension. Start with 5mg, titrate to 10mg if needed.",
                "warnings": "May cause peripheral edema. Monitor for hypotension."
            })
    
    # Acute pain / Severe pain
    if "severe pain" in combined or "acute pain" in combined or "pain" in combined:
        prescriptions.append({
            "medication": "Morphine",
            "dosage": "2.5-10mg IV or 5-15mg IM",
            "frequency": "Every 4-6 hours as needed",
            "duration": "Until pain controlled",
            "instructions": "For severe pain. Titrate to effect. Monitor respiratory rate.",
            "warnings": "Respiratory depression risk. Naloxone should be available. Contraindicated in respiratory depression."
        })
        prescriptions.append({
            "medication": "Paracetamol",
            "dosage": "500-1000mg",
            "frequency": "Every 6-8 hours",
            "duration": "3-5 days",
            "instructions": "For mild to moderate pain. Maximum 4g per day.",
            "warnings": "Avoid in liver disease. Do not exceed maximum daily dose."
        })
    
    # Fever / Hyperthermia
    if "fever" in combined or "hyperthermia" in combined or "high temperature" in combined:
        prescriptions.append({
            "medication": "Paracetamol",
            "dosage": "500-1000mg",
            "frequency": "Every 6-8 hours",
            "duration": "Until afebrile",
            "instructions": "Antipyretic for fever. Maximum 4g per day.",
            "warnings": "Avoid in liver disease."
        })
        prescriptions.append({
            "medication": "Ibuprofen",
            "dosage": "400-600mg",
            "frequency": "Every 6-8 hours",
            "duration": "Until afebrile",
            "instructions": "Alternative antipyretic. Take with food.",
            "warnings": "Contraindicated in peptic ulcer disease, renal impairment."
        })
    
    # Asthma / Bronchospasm
    if "asthma" in combined or "bronchospasm" in combined or "wheezing" in combined:
        prescriptions.append({
            "medication": "Salbutamol",
            "dosage": "2.5-5mg nebulized or 2-4 puffs inhaler",
            "frequency": "Every 4-6 hours or as needed",
            "duration": "Until symptoms resolve",
            "instructions": "Bronchodilator for asthma. Use spacer with inhaler if available.",
            "warnings": "May cause tachycardia, tremor. Monitor for paradoxical bronchospasm."
        })
    
    # Seizure / Convulsion
    if "seizure" in combined or "convulsion" in combined or "epilepsy" in combined:
        prescriptions.append({
            "medication": "Diazepam",
            "dosage": "5-10mg IV or 10-20mg rectal",
            "frequency": "As needed for acute seizure",
            "duration": "Acute management",
            "instructions": "For acute seizure control. Monitor respiratory rate.",
            "warnings": "Respiratory depression risk. Have airway management equipment ready."
        })
    
    # Hypothermia / Severe Hypothermia
    if "hypothermia" in combined or "low temperature" in combined or "low body temperature" in combined:
        if "severe" in combined or "profound" in combined:
            # Severe hypothermia (<28°C) - medical emergency
            prescriptions.append({
                "medication": "Warm IV fluids",
                "dosage": "Normal saline warmed to 40-42°C",
                "frequency": "Continuous infusion",
                "duration": "Until core temperature >35°C",
                "instructions": "Severe hypothermia emergency. Active external and internal rewarming required. Monitor core temperature continuously. Avoid rough handling (risk of ventricular fibrillation).",
                "warnings": "Do not give up resuscitation until patient is warm. Hypothermic patients may appear dead but can recover with rewarming."
            })
            prescriptions.append({
                "medication": "Oxygen",
                "dosage": "High flow via mask or nasal cannula",
                "frequency": "Continuous",
                "duration": "Until normothermic and stable",
                "instructions": "Warm, humidified oxygen if available. Monitor SpO2 and respiratory rate.",
                "warnings": "Monitor for respiratory depression in severe cases."
            })
        else:
            # Mild to moderate hypothermia (28-35°C)
            prescriptions.append({
                "medication": "Warm blankets and environment",
                "dosage": "Passive rewarming",
                "frequency": "Continuous",
                "duration": "Until core temperature >35°C",
                "instructions": "Remove wet clothing. Provide warm, dry blankets. Warm environment. Monitor temperature.",
                "warnings": "If temperature continues to drop or patient becomes unresponsive, seek emergency care immediately."
            })
            prescriptions.append({
                "medication": "Warm oral fluids",
                "dosage": "If patient is conscious and alert",
                "frequency": "As tolerated",
                "duration": "Until normothermic",
                "instructions": "Only if patient is conscious. Avoid alcohol or caffeine.",
                "warnings": "Do not give fluids if patient is unconscious or has altered mental status."
            })
    
    return prescriptions


def _get_dxgpt_prescription(condition: str, diagnosis: str, patient_weight: Optional[str] = None, 
                           allergies: Optional[str] = None, age: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Get prescription/treatment recommendations from DxGPT API (AI-powered).
    """
    # Build description for prescription request
    description = f"Diagnosis: {condition}. {diagnosis}"
    if patient_weight:
        description += f" Patient weight: {patient_weight} kg."
    if allergies:
        description += f" Known allergies: {allergies}."
    if age:
        description += f" Patient age: {age} years."
    
    description += " Please provide treatment recommendations including: medication names, dosages, frequency, duration, and any important warnings or contraindications. Format as JSON if possible."
    
    # Prepare DxGPT request
    payload = {
        "description": description,
        "myuuid": str(uuid.uuid4()),
        "lang": "en",
        "timezone": "Africa/Accra",
        "diseases_list": "",
        "model": "gpt4o",
        "response_mode": "direct"
    }
    
    headers = {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "Ocp-Apim-Subscription-Key": AZURE_API_KEY
    }
    
    try:
        response = requests.post(AZURE_API_URL, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        data = response.json()
        
        # DEBUG: Print prescription response
        print("=" * 80)
        print("[MediVoice] DxGPT PRESCRIPTION RESPONSE:")
        print(json.dumps(data, indent=2, ensure_ascii=False))
        print("=" * 80)
        
        prescriptions = []
        if data.get("result") == "success":
            # Check if response has treatment/prescription data
            if isinstance(data.get("data"), list):
                for item in data.get("data", []):
                    # Look for treatment-related fields
                    treatment = item.get("treatment") or item.get("medication") or item.get("prescription")
                    if treatment:
                        prescriptions.append({
                            "medication": item.get("medication_name") or item.get("drug") or str(treatment),
                            "dosage": item.get("dosage") or item.get("dose") or "As prescribed",
                            "frequency": item.get("frequency") or item.get("times_per_day") or "As directed",
                            "duration": item.get("duration") or item.get("course") or "As directed",
                            "instructions": item.get("instructions") or item.get("notes") or "",
                            "warnings": item.get("warnings") or item.get("contraindications") or ""
                        })
            
            # If no structured data, try to parse from description
            if not prescriptions and isinstance(data.get("data"), list):
                for item in data.get("data", []):
                    desc = item.get("description", "")
                    diagnosis_text = item.get("diagnosis", "")
                    
                    # Combine description and diagnosis for better extraction
                    full_text = f"{diagnosis_text} {desc}".strip()
                    
                    if full_text:
                        # Try to extract JSON from text if present
                        try:
                            # Look for JSON objects in the text
                            json_pattern = r'\{[^{}]*(?:"medication"|"drug"|"treatment")[^{}]*\}'
                            json_matches = re.findall(json_pattern, full_text, re.IGNORECASE | re.DOTALL)
                            if json_matches:
                                for json_str in json_matches:
                                    try:
                                        parsed = json.loads(json_str)
                                        prescriptions.append({
                                            "medication": parsed.get("medication") or parsed.get("drug") or parsed.get("treatment") or "See description",
                                            "dosage": parsed.get("dosage") or parsed.get("dose") or "As prescribed",
                                            "frequency": parsed.get("frequency") or parsed.get("times_per_day") or "As directed",
                                            "duration": parsed.get("duration") or parsed.get("course") or "As directed",
                                            "instructions": parsed.get("instructions") or parsed.get("notes") or full_text[:200],
                                            "warnings": parsed.get("warnings") or parsed.get("contraindications") or ""
                                        })
                                    except:
                                        pass
                        except:
                            pass
                        
                        # If still no prescriptions, try to extract medication names from text
                        if not prescriptions:
                            # Look for common medication patterns
                            medication_patterns = [
                                r'(?:prescribe|recommend|give|take|use)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)',
                                r'([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:\d+\s*(?:mg|ml|g|tablet|capsule))',
                                r'(?:medication|drug|treatment):\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)',
                            ]
                            
                            for pattern in medication_patterns:
                                matches = re.findall(pattern, full_text, re.IGNORECASE)
                                if matches:
                                    for med in matches[:3]:  # Limit to 3 medications
                                        if len(med.split()) <= 4:  # Reasonable medication name length
                                            prescriptions.append({
                                                "medication": med.strip(),
                                                "dosage": "As prescribed",
                                                "frequency": "As directed",
                                                "duration": "As directed",
                                                "instructions": full_text[:300],
                                                "warnings": ""
                                            })
                                            break
                                    if prescriptions:
                                        break
                        
                        # Last resort: create a prescription from the full description
                        if not prescriptions and ("treatment" in full_text.lower() or "medication" in full_text.lower() or "prescribe" in full_text.lower() or "drug" in full_text.lower()):
                            prescriptions.append({
                                "medication": condition or "See description",
                                "dosage": "As prescribed",
                                "frequency": "As directed",
                                "duration": "As directed",
                                "instructions": full_text[:500],
                                "warnings": ""
                            })
        
        return prescriptions
    except requests.exceptions.RequestException as e:
        print(f"[MediVoice] DxGPT prescription API error: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"[MediVoice] Response: {e.response.text}")
        return []
    except Exception as e:
        print(f"[MediVoice] DxGPT prescription processing error: {e}")
        return []


# In-memory drug store (in production, use a database)
# 100 Top Most Popular Drugs in Ghana with random stock levels
import random
random.seed(42)  # For consistent random numbers

# Helper function to generate random stock
def _random_stock() -> int:
    return random.randint(0, 2000)

# 100 Top Most Popular Drugs in Ghana
_popular_ghana_drugs = [
    # Analgesics & Antipyretics (10)
    ("Paracetamol", "Acetaminophen", "Analgesic", "tablet", "500mg", "tablets", 0.50),
    ("Ibuprofen", "Ibuprofen", "NSAID", "tablet", "400mg", "tablets", 0.75),
    ("Aspirin", "Acetylsalicylic Acid", "Analgesic", "tablet", "100mg", "tablets", 0.30),
    ("Diclofenac", "Diclofenac Sodium", "NSAID", "tablet", "50mg", "tablets", 1.20),
    ("Tramadol", "Tramadol", "Analgesic", "capsule", "50mg", "capsules", 2.00),
    ("Codeine", "Codeine Phosphate", "Analgesic", "tablet", "30mg", "tablets", 1.50),
    ("Naproxen", "Naproxen", "NSAID", "tablet", "250mg", "tablets", 1.00),
    ("Piroxicam", "Piroxicam", "NSAID", "capsule", "20mg", "capsules", 1.80),
    ("Ketorolac", "Ketorolac", "NSAID", "tablet", "10mg", "tablets", 2.50),
    ("Mefenamic Acid", "Mefenamic Acid", "NSAID", "capsule", "250mg", "capsules", 1.50),
    
    # Antimalarials (12)
    ("Artemether-Lumefantrine", "Coartem", "Antimalarial", "tablet", "20mg/120mg", "tablets", 2.50),
    ("Artesunate", "Artesunate", "Antimalarial", "tablet", "50mg", "tablets", 3.00),
    ("Quinine", "Quinine Sulfate", "Antimalarial", "tablet", "300mg", "tablets", 2.00),
    ("Chloroquine", "Chloroquine Phosphate", "Antimalarial", "tablet", "250mg", "tablets", 1.50),
    ("Amodiaquine", "Amodiaquine", "Antimalarial", "tablet", "200mg", "tablets", 2.20),
    ("Mefloquine", "Mefloquine", "Antimalarial", "tablet", "250mg", "tablets", 4.00),
    ("Primaquine", "Primaquine", "Antimalarial", "tablet", "15mg", "tablets", 1.80),
    ("Proguanil", "Proguanil", "Antimalarial", "tablet", "100mg", "tablets", 1.20),
    ("Sulfadoxine-Pyrimethamine", "Fansidar", "Antimalarial", "tablet", "500mg/25mg", "tablets", 3.50),
    ("Dihydroartemisinin-Piperaquine", "Duo-Cotecxin", "Antimalarial", "tablet", "40mg/320mg", "tablets", 4.50),
    ("Atovaquone-Proguanil", "Malarone", "Antimalarial", "tablet", "250mg/100mg", "tablets", 8.00),
    ("Halofantrine", "Halfan", "Antimalarial", "tablet", "250mg", "tablets", 3.00),
    
    # Antibiotics (20)
    ("Amoxicillin", "Amoxicillin", "Antibiotic", "capsule", "500mg", "capsules", 1.20),
    ("Amoxicillin", "Amoxicillin", "Antibiotic", "syrup", "250mg/5ml", "bottles", 8.50),
    ("Metronidazole", "Flagyl", "Antibiotic", "tablet", "400mg", "tablets", 1.50),
    ("Ciprofloxacin", "Ciprofloxacin", "Antibiotic", "tablet", "500mg", "tablets", 2.80),
    ("Azithromycin", "Azithromycin", "Antibiotic", "tablet", "500mg", "tablets", 3.50),
    ("Erythromycin", "Erythromycin", "Antibiotic", "tablet", "250mg", "tablets", 2.20),
    ("Doxycycline", "Doxycycline", "Antibiotic", "capsule", "100mg", "capsules", 2.50),
    ("Ceftriaxone", "Ceftriaxone", "Antibiotic", "injection", "1g", "vials", 15.00),
    ("Cefuroxime", "Cefuroxime", "Antibiotic", "tablet", "250mg", "tablets", 3.00),
    ("Cefixime", "Cefixime", "Antibiotic", "capsule", "400mg", "capsules", 4.00),
    ("Cephalexin", "Cephalexin", "Antibiotic", "capsule", "500mg", "capsules", 2.50),
    ("Clindamycin", "Clindamycin", "Antibiotic", "capsule", "300mg", "capsules", 3.50),
    ("Gentamicin", "Gentamicin", "Antibiotic", "injection", "80mg/2ml", "ampoules", 5.00),
    ("Penicillin V", "Penicillin V", "Antibiotic", "tablet", "250mg", "tablets", 1.00),
    ("Benzylpenicillin", "Penicillin G", "Antibiotic", "injection", "1MU", "vials", 4.00),
    ("Tetracycline", "Tetracycline", "Antibiotic", "capsule", "250mg", "capsules", 1.80),
    ("Chloramphenicol", "Chloramphenicol", "Antibiotic", "capsule", "250mg", "capsules", 2.00),
    ("Trimethoprim-Sulfamethoxazole", "Co-trimoxazole", "Antibiotic", "tablet", "160mg/800mg", "tablets", 1.50),
    ("Nitrofurantoin", "Nitrofurantoin", "Antibiotic", "capsule", "100mg", "capsules", 2.20),
    ("Vancomycin", "Vancomycin", "Antibiotic", "injection", "500mg", "vials", 25.00),
    
    # Antihypertensives (10)
    ("Amlodipine", "Amlodipine", "Antihypertensive", "tablet", "5mg", "tablets", 1.80),
    ("Enalapril", "Enalapril", "Antihypertensive", "tablet", "5mg", "tablets", 2.00),
    ("Hydrochlorothiazide", "HCTZ", "Diuretic", "tablet", "25mg", "tablets", 1.50),
    ("Losartan", "Losartan", "Antihypertensive", "tablet", "50mg", "tablets", 2.50),
    ("Atenolol", "Atenolol", "Beta Blocker", "tablet", "50mg", "tablets", 1.50),
    ("Propranolol", "Propranolol", "Beta Blocker", "tablet", "40mg", "tablets", 1.20),
    ("Captopril", "Captopril", "ACE Inhibitor", "tablet", "25mg", "tablets", 1.80),
    ("Nifedipine", "Nifedipine", "Calcium Channel Blocker", "tablet", "10mg", "tablets", 1.50),
    ("Furosemide", "Furosemide", "Diuretic", "tablet", "40mg", "tablets", 1.00),
    ("Bisoprolol", "Bisoprolol", "Beta Blocker", "tablet", "5mg", "tablets", 2.20),
    
    # Antidiabetics (6)
    ("Metformin", "Metformin", "Antidiabetic", "tablet", "500mg", "tablets", 1.20),
    ("Glibenclamide", "Glibenclamide", "Antidiabetic", "tablet", "5mg", "tablets", 1.80),
    ("Gliclazide", "Gliclazide", "Antidiabetic", "tablet", "80mg", "tablets", 2.00),
    ("Insulin", "Human Insulin", "Antidiabetic", "injection", "100IU/ml", "vials", 18.00),
    ("Glibenclamide-Metformin", "Combination", "Antidiabetic", "tablet", "2.5mg/500mg", "tablets", 2.50),
    ("Pioglitazone", "Pioglitazone", "Antidiabetic", "tablet", "15mg", "tablets", 3.00),
    
    # Antacids & GI (8)
    ("Omeprazole", "Omeprazole", "Antacid", "capsule", "20mg", "capsules", 2.00),
    ("Ranitidine", "Ranitidine", "Antacid", "tablet", "150mg", "tablets", 1.50),
    ("Loperamide", "Imodium", "Antidiarrheal", "capsule", "2mg", "capsules", 1.80),
    ("Metoclopramide", "Metoclopramide", "Antiemetic", "tablet", "10mg", "tablets", 1.20),
    ("Domperidone", "Domperidone", "Antiemetic", "tablet", "10mg", "tablets", 1.50),
    ("Cimetidine", "Cimetidine", "Antacid", "tablet", "200mg", "tablets", 1.00),
    ("Famotidine", "Famotidine", "Antacid", "tablet", "20mg", "tablets", 1.80),
    ("Pantoprazole", "Pantoprazole", "Antacid", "tablet", "40mg", "tablets", 2.50),
    
    # Respiratory (8)
    ("Salbutamol", "Albuterol", "Bronchodilator", "inhaler", "100mcg", "inhalers", 12.00),
    ("Beclomethasone", "Beclomethasone", "Corticosteroid", "inhaler", "100mcg", "inhalers", 15.00),
    ("Ambroxol", "Ambroxol", "Expectorant", "syrup", "15mg/5ml", "bottles", 9.50),
    ("Guaifenesin", "Guaifenesin", "Expectorant", "syrup", "100mg/5ml", "bottles", 8.00),
    ("Theophylline", "Theophylline", "Bronchodilator", "tablet", "200mg", "tablets", 1.50),
    ("Aminophylline", "Aminophylline", "Bronchodilator", "injection", "250mg/10ml", "ampoules", 8.00),
    ("Budesonide", "Budesonide", "Corticosteroid", "inhaler", "200mcg", "inhalers", 18.00),
    ("Ipratropium", "Ipratropium", "Bronchodilator", "inhaler", "20mcg", "inhalers", 14.00),
    
    # Vitamins & Supplements (8)
    ("Folic Acid", "Folic Acid", "Vitamin", "tablet", "5mg", "tablets", 0.50),
    ("Iron Sulfate", "Ferrous Sulfate", "Supplement", "tablet", "200mg", "tablets", 1.00),
    ("Vitamin B Complex", "B Complex", "Vitamin", "tablet", "B1/B2/B6/B12", "tablets", 1.50),
    ("Calcium", "Calcium Carbonate", "Supplement", "tablet", "500mg", "tablets", 1.20),
    ("Vitamin C", "Ascorbic Acid", "Vitamin", "tablet", "1000mg", "tablets", 1.00),
    ("Vitamin D", "Cholecalciferol", "Vitamin", "tablet", "1000IU", "tablets", 1.50),
    ("Zinc", "Zinc Sulfate", "Supplement", "tablet", "20mg", "tablets", 1.20),
    ("Multivitamin", "Multivitamin", "Vitamin", "tablet", "Various", "tablets", 2.00),
    
    # Antifungals (4)
    ("Fluconazole", "Fluconazole", "Antifungal", "capsule", "150mg", "capsules", 4.00),
    ("Clotrimazole", "Clotrimazole", "Antifungal", "cream", "1%", "tubes", 6.50),
    ("Ketoconazole", "Ketoconazole", "Antifungal", "cream", "2%", "tubes", 7.00),
    ("Nystatin", "Nystatin", "Antifungal", "cream", "100000IU/g", "tubes", 5.50),
    
    # Antihistamines (4)
    ("Chlorpheniramine", "Chlorpheniramine", "Antihistamine", "tablet", "4mg", "tablets", 0.80),
    ("Cetirizine", "Cetirizine", "Antihistamine", "tablet", "10mg", "tablets", 1.50),
    ("Loratadine", "Loratadine", "Antihistamine", "tablet", "10mg", "tablets", 2.00),
    ("Fexofenadine", "Fexofenadine", "Antihistamine", "tablet", "120mg", "tablets", 2.50),
    
    # Eye & Ear (4)
    ("Chloramphenicol Eye Drops", "Chloramphenicol", "Antibiotic", "eye drops", "0.5%", "bottles", 8.00),
    ("Tobramycin Eye Drops", "Tobramycin", "Antibiotic", "eye drops", "0.3%", "bottles", 10.00),
    ("Gentamicin Eye Drops", "Gentamicin", "Antibiotic", "eye drops", "0.3%", "bottles", 9.00),
    ("Ciprofloxacin Eye Drops", "Ciprofloxacin", "Antibiotic", "eye drops", "0.3%", "bottles", 11.00),
    
    # Emergency & IV (6)
    ("Adrenaline", "Epinephrine", "Emergency", "injection", "1mg/ml", "ampoules", 20.00),
    ("Dexamethasone", "Dexamethasone", "Corticosteroid", "injection", "4mg/ml", "ampoules", 5.00),
    ("Normal Saline", "Sodium Chloride", "IV Fluid", "infusion", "0.9%", "bags", 3.50),
    ("Dextrose 5%", "Dextrose", "IV Fluid", "infusion", "5%", "bags", 4.00),
    ("Ringer's Lactate", "Ringer's Lactate", "IV Fluid", "infusion", "Various", "bags", 4.50),
    ("Morphine", "Morphine", "Analgesic", "injection", "10mg/ml", "ampoules", 25.00),
]

# Generate DRUG_STORE with random stock levels
DRUG_STORE: List[Dict[str, Any]] = [
    {
        "_id": str(uuid.uuid4()),
        "name": name,
        "genericName": generic,
        "category": category,
        "dosageForm": form,
        "strength": strength,
        "stock": _random_stock(),
        "unit": unit,
        "price": price,
        "createdAt": "2024-01-01T00:00:00Z"
    }
    for name, generic, category, form, strength, unit, price in _popular_ghana_drugs
]


# Removed all local model loading code (Whisper, MedGemma)
# Now using Web Speech API for transcription (client-side) and cloud APIs for extraction/diagnosis
print("[MediVoice] Backend ready - using cloud APIs (HF Inference + DxGPT)")


class VitalsModel(BaseModel):
    bp: Optional[str] = None
    temp: Optional[str] = None
    pulse: Optional[str] = None
    spo2: Optional[str] = None
    weight: Optional[str] = None


class VitalsRequest(BaseModel):
    transcription: str = Field(..., description="Transcription text from Web Speech API")

class VitalsResponse(BaseModel):
    transcription: str = Field(..., description="Transcription text")
    vitals: VitalsModel = Field(..., description="Extracted vital signs")


class DiagnosisRequest(BaseModel):
    symptoms: str
    vitals: Dict[str, Any]  # {bp, temp, pulse...}
    history: Optional[str] = None


class DiagnosisItem(BaseModel):
    condition: str
    probability: float
    reasoning: str  # Brief "why" explanation
    detailed_reasoning: Optional[str] = None  # Full detailed analysis


class DiagnosisResponse(BaseModel):
    diagnoses: List[DiagnosisItem]


class ConfirmDiagnosisRequest(BaseModel):
    initial_diagnosis: List[Dict[str, Any]]  # previous AI output
    symptoms: str
    lab_results: Dict[str, str]  # {"Malaria RDT": "Positive", "WBC": "12.5"}


class ConfirmDiagnosisResponse(BaseModel):
    final_diagnosis: List[Dict[str, Any]]
    analysis: str


class PrescriptionItem(BaseModel):
    medication: str
    dosage: str
    frequency: str
    duration: str
    instructions: Optional[str] = None
    warnings: Optional[str] = None


class PrescriptionRequest(BaseModel):
    condition: str
    diagnosis: str
    patient_weight: Optional[str] = None
    allergies: Optional[str] = None
    age: Optional[str] = None
    other_conditions: Optional[str] = None


class PrescriptionResponse(BaseModel):
    prescriptions: List[PrescriptionItem]
    warnings: Optional[List[str]] = None
    notes: Optional[str] = None


class DrugModel(BaseModel):
    _id: Optional[str] = None
    name: str
    genericName: Optional[str] = None
    category: str
    dosageForm: str
    strength: str
    stock: int
    unit: str
    expiryDate: Optional[str] = None
    supplier: Optional[str] = None
    price: Optional[float] = None
    createdAt: Optional[str] = None


class DrugListResponse(BaseModel):
    drugs: List[Dict[str, Any]]


class DrugCreateRequest(BaseModel):
    name: str
    genericName: Optional[str] = None
    category: str
    dosageForm: str
    strength: str
    stock: int
    unit: str
    expiryDate: Optional[str] = None
    supplier: Optional[str] = None
    price: Optional[float] = None


class PrescriptionItem(BaseModel):
    medication: str
    dosage: str
    frequency: str
    duration: str
    instructions: Optional[str] = None
    warnings: Optional[str] = None


class PrescriptionRequest(BaseModel):
    condition: str
    diagnosis: str
    patient_weight: Optional[str] = None
    allergies: Optional[str] = None
    age: Optional[str] = None
    other_conditions: Optional[str] = None


class PrescriptionResponse(BaseModel):
    prescriptions: List[PrescriptionItem]
    warnings: Optional[List[str]] = None
    notes: Optional[str] = None


class DrugModel(BaseModel):
    _id: Optional[str] = None
    name: str
    genericName: Optional[str] = None
    category: str
    dosageForm: str
    strength: str
    stock: int
    unit: str
    expiryDate: Optional[str] = None
    supplier: Optional[str] = None
    price: Optional[float] = None
    createdAt: Optional[str] = None


class DrugListResponse(BaseModel):
    drugs: List[Dict[str, Any]]


class DrugCreateRequest(BaseModel):
    name: str
    genericName: Optional[str] = None
    category: str
    dosageForm: str
    strength: str
    stock: int
    unit: str
    expiryDate: Optional[str] = None
    supplier: Optional[str] = None
    price: Optional[float] = None


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    # Allow all origins (needed for Vercel preview deployments and development)
    # In production, you should restrict this to specific domains.
    allow_origins=["*"],
    allow_credentials=False,  # Must be False when allow_origins=["*"]
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root() -> Dict[str, str]:
    return {
        "service": "MediVoice Backend",
        "status": "ok",
        "docs": "/docs",
        "process_audio": "POST /process-audio (JSON; field: transcription)",
    }


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/process-audio", response_model=VitalsResponse)
async def process_audio(req: VitalsRequest) -> VitalsResponse:
    """
    Process transcription text from Web Speech API and extract vitals.
    No audio processing needed - transcription happens in browser.
    """
    transcript = (req.transcription or "").strip()
    
    if not transcript:
        raise HTTPException(status_code=400, detail="Transcription text is required")

    print(f"[MediVoice] Transcription: {transcript}")

    # Use HYBRID for vitals extraction (regex + HF API)
    vitals_raw = extract_vitals_hybrid(transcript)
    vitals_norm = _normalize_vitals(vitals_raw)

    return VitalsResponse(
        transcription=transcript,
        vitals=VitalsModel(**vitals_norm),
    )


@app.post("/diagnose", response_model=DiagnosisResponse)
async def diagnose(req: DiagnosisRequest) -> DiagnosisResponse:
    symptoms = (req.symptoms or "").strip()
    if not symptoms:
        raise HTTPException(status_code=400, detail="symptoms is required")

    vitals = req.vitals or {}
    history = (req.history or "").strip()

    # Use Groq for diagnosis (primary and only method)
    print("[MediVoice] Getting diagnosis from Groq...")
    diagnoses_raw = _get_groq_diagnosis(symptoms, vitals)
    if not diagnoses_raw:
        print("[MediVoice] Groq failed to generate diagnoses")
        raise HTTPException(status_code=500, detail="Groq failed to generate diagnoses. Please try again.")
    
    print(f"[MediVoice] Groq generated {len(diagnoses_raw)} diagnosis(es)")
    
    # Convert to DiagnosisItem format
    items: List[DiagnosisItem] = []
    for raw in diagnoses_raw:
        # Handle both "condition" and "diagnosis" field names
        condition = raw.get("condition") or raw.get("diagnosis", "")
        if not condition:
            print(f"[MediVoice] Warning: Skipping diagnosis item missing condition/diagnosis field: {raw}")
            continue
        
        items.append(DiagnosisItem(
            condition=condition,
            probability=raw.get("probability", 0.5),
            reasoning=raw.get("reasoning", ""),
            detailed_reasoning=raw.get("detailed_reasoning")
        ))

    return DiagnosisResponse(diagnoses=items)


@app.post("/confirm-diagnosis", response_model=ConfirmDiagnosisResponse)
async def confirm_diagnosis(req: ConfirmDiagnosisRequest) -> ConfirmDiagnosisResponse:
    symptoms = (req.symptoms or "").strip()
    if not symptoms:
        raise HTTPException(status_code=400, detail="symptoms is required")

    initial = req.initial_diagnosis or []
    labs = req.lab_results or {}
    
    # Format lab results for description
    lab_str = ", ".join([f"{k}: {v}" for k, v in labs.items()])
    
    # Build description with initial diagnosis and lab results
    description = f"{symptoms}. Initial diagnosis: {json.dumps(initial)}. Lab results: {lab_str}."
    
    # Use Groq for diagnosis (primary and only method)
    print("[MediVoice] Getting updated diagnosis from Groq...")
    diagnoses_raw = _get_groq_diagnosis(description)
    if not diagnoses_raw:
        print("[MediVoice] Groq failed to generate diagnoses")
        raise HTTPException(status_code=500, detail="Groq failed to generate diagnoses. Please try again.")
    
    print(f"[MediVoice] Groq generated {len(diagnoses_raw)} diagnosis(es)")
    
    # Convert to final diagnosis format
    final_diagnosis = []
    for raw in diagnoses_raw:
        # Handle both "condition" and "diagnosis" field names
        condition = raw.get("condition") or raw.get("diagnosis", "")
        if not condition:
            print(f"[MediVoice] Warning: Skipping diagnosis item missing condition/diagnosis field: {raw}")
            continue
        
        final_diagnosis.append({
            "condition": condition,
            "probability": raw.get("probability", 0.5),
            "reasoning": raw.get("reasoning", ""),
            "detailed_reasoning": raw.get("detailed_reasoning")
        })
    
    # Generate analysis
    analysis = f"Based on lab results {lab_str}, the diagnosis has been updated."
    
    return ConfirmDiagnosisResponse(
        final_diagnosis=final_diagnosis,
        analysis=analysis
    )


@app.post("/prescription", response_model=PrescriptionResponse)
async def get_prescription(req: PrescriptionRequest) -> PrescriptionResponse:
    """
    Get prescription/treatment recommendations using Groq API with Llama 3 8B.
    """
    condition = (req.condition or "").strip()
    diagnosis = (req.diagnosis or "").strip()
    
    if not condition or not diagnosis:
        raise HTTPException(status_code=400, detail="condition and diagnosis are required")
    
    items: List[PrescriptionItem] = []
    warnings_list: List[str] = []
    
    # Use Groq for prescriptions (primary and only method)
    print(f"[MediVoice] Getting prescriptions from Groq for: {condition}")
    ai_prescriptions = _get_groq_prescription(
        condition=condition,
        diagnosis=diagnosis,
        patient_weight=req.patient_weight,
        allergies=req.allergies,
        age=req.age,
    )
    
    if ai_prescriptions:
        print(f"[MediVoice] Groq generated {len(ai_prescriptions)} prescription(s)")
        
        # Convert Groq prescriptions to PrescriptionItem format
        for ai_pres in ai_prescriptions:
            medication = ai_pres.get("medication", "").strip()
            if not medication:
                continue
            
            # Build warnings list
            combined_warnings = []
            if ai_pres.get("warnings"):
                combined_warnings.append(ai_pres.get("warnings"))
            if req.allergies:
                combined_warnings.append(f"Patient allergies: {req.allergies}")
            
            # Build instructions
            instructions_parts = []
            if ai_pres.get("instructions"):
                instructions_parts.append(ai_pres.get("instructions"))
            if diagnosis and diagnosis != condition:
                instructions_parts.append(f"Diagnosis details: {diagnosis}")
            
            items.append(PrescriptionItem(
                medication=medication,
                dosage=ai_pres.get("dosage", "As prescribed"),
                frequency=ai_pres.get("frequency", "As directed"),
                duration=ai_pres.get("duration", "As directed"),
                instructions=". ".join(instructions_parts) if instructions_parts else None,
                warnings=". ".join(combined_warnings) if combined_warnings else None
            ))
            
            if combined_warnings:
                warnings_list.extend(combined_warnings)
    else:
        print("[MediVoice] Groq failed to generate prescriptions")
        raise HTTPException(status_code=500, detail="No prescriptions generated. Groq failed to generate prescriptions.")
    
    # Build notes
    notes_parts = [f"Groq AI (Llama 3 8B) prescription recommendations for {condition}."]
    if ai_prescriptions:
        notes_parts.append(f"Generated {len(ai_prescriptions)} prescription(s) from Groq.")
    notes_parts.append("Please verify with clinical guidelines.")
    
    return PrescriptionResponse(
        prescriptions=items,
        warnings=warnings_list if warnings_list else None,
        notes=" ".join(notes_parts)
    )


@app.get("/drugs", response_model=DrugListResponse)
async def list_drugs() -> DrugListResponse:
    """
    List all drugs in the pharmacy inventory.
    """
    return DrugListResponse(drugs=DRUG_STORE)


@app.post("/drugs", response_model=Dict[str, Any])
async def create_drug(req: DrugCreateRequest) -> Dict[str, Any]:
    """
    Add a new drug to the pharmacy inventory.
    """
    new_drug = {
        "_id": str(uuid.uuid4()),
        "name": req.name,
        "genericName": req.genericName,
        "category": req.category,
        "dosageForm": req.dosageForm,
        "strength": req.strength,
        "stock": req.stock,
        "unit": req.unit,
        "expiryDate": req.expiryDate,
        "supplier": req.supplier,
        "price": req.price,
        "createdAt": (datetime.now(pytz.timezone("Africa/Accra"))).isoformat()
    }
    DRUG_STORE.append(new_drug)
    return new_drug


@app.put("/drugs/{drug_id}", response_model=Dict[str, Any])
async def update_drug(drug_id: str, req: DrugCreateRequest) -> Dict[str, Any]:
    """
    Update a drug in the pharmacy inventory.
    """
    for i, drug in enumerate(DRUG_STORE):
        if drug["_id"] == drug_id:
            updated_drug = {
                **drug,
                "name": req.name,
                "genericName": req.genericName,
                "category": req.category,
                "dosageForm": req.dosageForm,
                "strength": req.strength,
                "stock": req.stock,
                "unit": req.unit,
                "expiryDate": req.expiryDate,
                "supplier": req.supplier,
                "price": req.price,
            }
            DRUG_STORE[i] = updated_drug
            return updated_drug
    
    raise HTTPException(status_code=404, detail="Drug not found")


@app.delete("/drugs/{drug_id}")
async def delete_drug(drug_id: str) -> Dict[str, str]:
    """
    Delete a drug from the pharmacy inventory.
    """
    for i, drug in enumerate(DRUG_STORE):
        if drug["_id"] == drug_id:
            DRUG_STORE.pop(i)
            return {"message": "Drug deleted successfully"}
    
    raise HTTPException(status_code=404, detail="Drug not found")


@app.get("/drugs/search")
async def search_drugs(q: str = "") -> DrugListResponse:
    """
    Search drugs by name, generic name, or category.
    """
    if not q:
        return DrugListResponse(drugs=DRUG_STORE)
    
    q_lower = q.lower()
    filtered = [
        drug for drug in DRUG_STORE
        if q_lower in drug.get("name", "").lower()
        or q_lower in drug.get("genericName", "").lower()
        or q_lower in drug.get("category", "").lower()
    ]
    return DrugListResponse(drugs=filtered)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)


