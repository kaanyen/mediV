import json
import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

os.environ.setdefault("BITSANDBYTES_NOWELCOME", "1")
if not (os.getenv("CUDA_VISIBLE_DEVICES") or "").strip():
    # Avoid bitsandbytes probing on non-CUDA platforms (e.g., Apple MPS) which can emit noisy errors.
    os.environ.setdefault("TRANSFORMERS_NO_BITSANDBYTES", "1")

import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from peft import PeftConfig, PeftModel
from transformers import (
    AutoModelForCausalLM,
    AutoModelForImageTextToText,
    AutoModelForSpeechSeq2Seq,
    AutoProcessor,
    AutoTokenizer,
)

BACKEND_DIR = Path(__file__).resolve().parent
TEMP_DIR = BACKEND_DIR / "temp"
ADAPTER_DIR = BACKEND_DIR / "models" / "whisper-adapter"
DEFAULT_WHISPER_LOCAL_DIR = BACKEND_DIR / "models" / "distil-large-v3"
DEFAULT_MEDGEMMA_LOCAL_DIR = BACKEND_DIR / "models" / "medgemma-4b-it"

HF_TOKEN = (
    os.getenv("HF_TOKEN")
    or os.getenv("HUGGINGFACE_HUB_TOKEN")
    or os.getenv("HF_ACCESS_TOKEN")
    or os.getenv("HUGGINGFACE_TOKEN")
)


def _hf_token_kwargs() -> Dict[str, Any]:
    return {"token": HF_TOKEN} if HF_TOKEN else {}


def _from_pretrained_with_token(loader_fn, *args, **kwargs):
    """
    Transformers versions vary: some accept `token=...`, older accept `use_auth_token=...`.
    This wrapper tries `token` first, then falls back to `use_auth_token`.
    """
    if not HF_TOKEN:
        return loader_fn(*args, **kwargs)
    try:
        return loader_fn(*args, **kwargs, token=HF_TOKEN)
    except TypeError:
        return loader_fn(*args, **kwargs, use_auth_token=HF_TOKEN)


def _select_device() -> torch.device:
    # Preference order: CUDA > MPS > CPU
    if torch.cuda.is_available():
        dev = torch.device("cuda")
    elif getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        dev = torch.device("mps")
    else:
        dev = torch.device("cpu")
    print(f"[MediVoice] Selected device: {dev.type}")
    return dev


DEVICE: torch.device = _select_device()


def _llm_dtype_for_device(device: torch.device) -> torch.dtype:
    # float16 is not supported for many CPU ops; keep CPU stable with float32
    if device.type == "cpu":
        print("[MediVoice] CPU detected; using float32 for MedGemma for compatibility.")
        return torch.float32
    # MedGemma (Gemma 3) checkpoints are typically BF16; MPS supports BF16 and it avoids
    # degenerate generations we can see with FP16 on Apple Silicon.
    if device.type == "mps":
        return torch.bfloat16
    return torch.float16


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


def _robust_json_extract_any(text: str) -> Union[Dict[str, Any], List[Any]]:
    """
    Extract the first JSON value (object or array) from model output.
    Handles fenced blocks (```json ... ```), and raw inline JSON.
    """
    if not text or not text.strip():
        raise ValueError("Empty LLM output")

    # Prefer fenced JSON blocks containing either an object or array
    fence = re.search(r"```(?:json)?\s*([\[{][\s\S]*?[\]}])\s*```", text, flags=re.IGNORECASE)
    candidate = fence.group(1) if fence else None

    if candidate is None:
        # Find whichever appears first: '{' or '['
        brace = text.find("{")
        bracket = text.find("[")
        if brace == -1 and bracket == -1:
            raise ValueError("No JSON value found in LLM output")
        if brace == -1:
            start = bracket
            end = text.rfind("]")
        elif bracket == -1:
            start = brace
            end = text.rfind("}")
        else:
            start = min(brace, bracket)
            end = text.rfind("]") if start == bracket else text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("No JSON value found in LLM output")
        candidate = text[start : end + 1]

    candidate = candidate.strip()
    candidate = candidate.replace("\u201c", '"').replace("\u201d", '"').replace("\u2018", "'").replace(
        "\u2019", "'"
    )

    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        candidate2 = re.sub(r",\s*([}\]])", r"\1", candidate)
        try:
            return json.loads(candidate2)
        except json.JSONDecodeError:
            # Salvage common truncation: array where last element is cut off.
            c = candidate2.strip()
            if c.startswith("["):
                last_obj_end = c.rfind("}")
                if last_obj_end != -1:
                    candidate3 = c[: last_obj_end + 1].rstrip()
                    # Close the array
                    if not candidate3.endswith("]"):
                        candidate3 = candidate3 + "]"
                    candidate3 = re.sub(r",\s*]", "]", candidate3)
                    return json.loads(candidate3)
            # Salvage common truncation: object where tail is cut off (best-effort)
            if c.startswith("{"):
                last_brace = c.rfind("}")
                if last_brace != -1:
                    candidate3 = c[: last_brace + 1]
                    return json.loads(candidate3)
            raise


def _get_pad_token_id_from_processor(processor: Any) -> Optional[int]:
    tok = getattr(processor, "tokenizer", None)
    if tok is None:
        return None
    # Prefer a real pad token if available (Gemma has <pad>=0). Only fall back to eos if missing.
    if tok.pad_token_id is None and tok.eos_token_id is not None:
        tok.pad_token = tok.eos_token
    return tok.pad_token_id


def _get_eos_token_id_from_processor(processor: Any) -> Optional[int]:
    tok = getattr(processor, "tokenizer", None)
    if tok is None:
        return None
    return tok.eos_token_id


def _get_eos_token_id_for_generation() -> Optional[Any]:
    """
    Gemma3 configs commonly define multiple eos tokens (e.g. [1, 106]).
    Return eos_token_id in a form suitable for `generate` (int or list[int]).
    """
    # Prefer generation_config if present (often contains the correct multi-eos list)
    eos = getattr(getattr(LLM_MODEL, "generation_config", None), "eos_token_id", None)
    if eos is not None:
        return eos
    eos = getattr(getattr(LLM_MODEL, "config", None), "eos_token_id", None)
    if eos is not None:
        return eos
    return _get_eos_token_id_from_processor(LLM_PROCESSOR)


def _medgemma_generate(prompt: str, *, max_new_tokens: int = 256, min_new_tokens: int = 24) -> str:
    """
    Generate text from MedGemma. Uses chat template when available and includes a computed attention_mask
    to avoid warnings/odd behavior when pad_token == eos_token.
    """
    messages = [{"role": "user", "content": [{"type": "text", "text": prompt}]}]

    if hasattr(LLM_PROCESSOR, "apply_chat_template"):
        inputs = LLM_PROCESSOR.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
        )
        inputs = inputs.to(LLM_MODEL.device)

        # Ensure attention_mask exists and is correct
        if "attention_mask" not in inputs or inputs["attention_mask"] is None:
            pad_id = _get_pad_token_id_from_processor(LLM_PROCESSOR)
            if pad_id is not None and "input_ids" in inputs:
                inputs["attention_mask"] = (inputs["input_ids"] != pad_id).long()

        input_len = int(inputs["input_ids"].shape[-1])
        pad_id = _get_pad_token_id_from_processor(LLM_PROCESSOR)
        eos_id = _get_eos_token_id_for_generation()

        gen_kwargs: Dict[str, Any] = {
            "max_new_tokens": int(max_new_tokens),
            "min_new_tokens": int(min_new_tokens),
            "do_sample": False,
        }
        if pad_id is not None:
            gen_kwargs["pad_token_id"] = pad_id
        if eos_id is not None:
            gen_kwargs["eos_token_id"] = eos_id

        with torch.inference_mode():
            generation = LLM_MODEL.generate(**inputs, **gen_kwargs)

        # Prefer decoding only newly generated tokens; if empty, fall back to full decode
        new_tokens = generation[0][input_len:]
        completion = LLM_PROCESSOR.decode(new_tokens, skip_special_tokens=True).strip()
        if completion:
            return completion
        # Helpful debug signal in server logs
        try:
            print(f"[MediVoice] MedGemma produced {int(new_tokens.shape[-1])} new tokens but decoded to empty.")
        except Exception:
            print("[MediVoice] MedGemma decoded to empty completion.")
        full_text = LLM_PROCESSOR.decode(generation[0], skip_special_tokens=True).strip()
        return full_text

    # Fallback: treat as a normal causal LM tokenizer
    tok = _from_pretrained_with_token(AutoTokenizer.from_pretrained, llm_source, use_fast=True)
    if tok.pad_token_id is None and tok.eos_token_id is not None:
        tok.pad_token = tok.eos_token
    inputs = tok(prompt, return_tensors="pt").to(LLM_MODEL.device)
    if "attention_mask" not in inputs and tok.pad_token_id is not None:
        inputs["attention_mask"] = (inputs["input_ids"] != tok.pad_token_id).long()
    with torch.inference_mode():
        output_ids = LLM_MODEL.generate(
            **inputs,
            max_new_tokens=int(max_new_tokens),
            min_new_tokens=max(1, int(min_new_tokens) - 8),
            do_sample=False,
            temperature=0.0,
            pad_token_id=tok.pad_token_id,
            eos_token_id=tok.eos_token_id,
        )
    decoded = tok.decode(output_ids[0], skip_special_tokens=True).strip()
    return decoded


def _normalize_vitals(obj: Dict[str, Any]) -> Dict[str, Optional[str]]:
    # Ensure required keys exist; coerce values to strings if present.
    out: Dict[str, Optional[str]] = {"bp": None, "temp": None, "pulse": None, "spo2": None}
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


def _load_audio_mono_16k(path: Path) -> np.ndarray:
    """
    Load audio into a mono float32 waveform at 16kHz.
    For webm/opus uploads (Chrome MediaRecorder), we convert with ffmpeg first.
    """
    tmp_converted: Optional[Path] = None
    try:
        if path.suffix.lower() == ".webm":
            if shutil.which("ffmpeg") is None:
                raise RuntimeError(
                    "ffmpeg is required to decode .webm audio. Install it (e.g. `brew install ffmpeg`) "
                    "or upload audio/wav."
                )
            tmp_converted = path.parent / f"{path.stem}-decoded-{uuid.uuid4().hex}.wav"
            cmd = [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(path),
                "-ac",
                "1",
                "-ar",
                "16000",
                "-f",
                "wav",
                str(tmp_converted),
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                raise RuntimeError(f"ffmpeg failed to decode webm: {proc.stderr.strip() or proc.stdout.strip()}")
            path = tmp_converted

        try:
            import librosa  # local import to keep startup errors clear

            audio, _sr = librosa.load(str(path), sr=16000, mono=True)
            audio = audio.astype(np.float32, copy=False)
            
            # Audio normalization and quality improvements
            # Remove silence at start/end (helps with transcription accuracy)
            if len(audio) > 0:
                # Normalize audio to prevent clipping while maintaining dynamic range
                max_val = np.abs(audio).max()
                if max_val > 0:
                    # Normalize to 0.95 peak to avoid clipping
                    audio = audio * (0.95 / max_val)
            
            # Validate audio length (too short = noise, too long = may cause issues)
            min_duration = 0.5  # 0.5 seconds minimum
            max_duration = 60.0  # 60 seconds maximum
            duration = len(audio) / 16000.0
            if duration < min_duration:
                raise ValueError(f"Audio too short ({duration:.2f}s). Minimum {min_duration}s required.")
            if duration > max_duration:
                print(f"[MediVoice] Warning: Audio is {duration:.2f}s, truncating to {max_duration}s")
                audio = audio[:int(max_duration * 16000)]
            
            return audio
        except Exception as e:
            # Fallback to soundfile for wav/flac/etc.
            try:
                import soundfile as sf

                audio, sr = sf.read(str(path), dtype="float32", always_2d=False)
                if sr != 16000:
                    from scipy.signal import resample_poly

                    audio = resample_poly(audio, 16000, sr).astype(np.float32, copy=False)
                if audio.ndim > 1:
                    audio = np.mean(audio, axis=1).astype(np.float32, copy=False)
                return audio
            except Exception as e2:
                raise RuntimeError(
                    f"Failed to decode audio. If uploading webm, ensure ffmpeg is installed. "
                    f"librosa error={type(e).__name__}: {e}; soundfile error={type(e2).__name__}: {e2}"
                )
    finally:
        if tmp_converted is not None:
            try:
                if tmp_converted.exists():
                    tmp_converted.unlink()
            except Exception:
                pass


print("[MediVoice] Loading ASR (Whisper + LoRA adapter)...")
if not ADAPTER_DIR.exists():
    raise RuntimeError(
        f"Missing Whisper adapter directory at {ADAPTER_DIR}. "
        "Place adapter_config.json and adapter_model.safetensors there."
    )

peft_cfg = PeftConfig.from_pretrained(str(ADAPTER_DIR))
base_asr_id = peft_cfg.base_model_name_or_path or "distil-whisper/distil-large-v3"

# Optional local Whisper base model support (preferred when available)
WHISPER_MODEL_PATH = os.getenv("WHISPER_MODEL_PATH")  # optional local folder path

def _has_whisper_weights(dir_path: Path) -> bool:
    if not (dir_path / "config.json").exists():
        return False
    # Accept common weight layouts: model.safetensors, sharded safetensors, or pytorch_model.bin
    if any(dir_path.glob("*.safetensors")):
        return True
    if any(dir_path.glob("pytorch_model*.bin")):
        return True
    return False

local_whisper_dir = Path(WHISPER_MODEL_PATH).expanduser() if WHISPER_MODEL_PATH else DEFAULT_WHISPER_LOCAL_DIR
use_local_whisper = _has_whisper_weights(local_whisper_dir)
if use_local_whisper:
    print(f"[MediVoice] Using local Whisper base from: {local_whisper_dir}")
    base_asr_source: str = str(local_whisper_dir)
    asr_local_only = True
else:
    base_asr_source = base_asr_id
    asr_local_only = False

asr_dtype = torch.float16 if DEVICE.type in ("cuda", "mps") else torch.float32
asr_base = AutoModelForSpeechSeq2Seq.from_pretrained(
    base_asr_source,
    torch_dtype=asr_dtype,
    low_cpu_mem_usage=True,
    use_safetensors=True,
    local_files_only=asr_local_only,
)
asr_model = PeftModel.from_pretrained(asr_base, str(ADAPTER_DIR))

try:
    # Merge LoRA weights for faster inference when possible
    asr_model = asr_model.merge_and_unload()
except Exception as merge_err:
    print(f"[MediVoice] Warning: could not merge LoRA adapter ({merge_err}). Continuing with PeftModel.")

asr_model.to(DEVICE)
asr_model.eval()
asr_processor = AutoProcessor.from_pretrained(base_asr_source, local_files_only=asr_local_only)


def _transcribe_with_whisper(audio: np.ndarray, sampling_rate: int = 16000) -> str:
    """
    Run Whisper directly (no Transformers pipeline) to avoid torchcodec/FFmpeg runtime issues
    on macOS. Input should be mono float waveform at 16kHz.
    
    Uses beam search with repetition penalty for better transcription quality.
    """
    inputs = asr_processor(audio, sampling_rate=sampling_rate, return_tensors="pt")
    input_features = inputs.get("input_features")
    if input_features is None:
        raise RuntimeError("Whisper processor did not produce input_features.")
    input_features = input_features.to(DEVICE, dtype=asr_dtype)

    # Improved generation parameters for better transcription quality
    gen_kwargs: Dict[str, Any] = {
        "max_new_tokens": 256,  # Increased from 128 for longer utterances
        "do_sample": False,  # Greedy decoding (deterministic)
        "num_beams": 5,  # Beam search for better quality
        "length_penalty": 1.0,  # Slight penalty for longer sequences
        "repetition_penalty": 1.2,  # Penalize repetition (fixes "one hundred and one hundred" issue)
        "no_repeat_ngram_size": 3,  # Prevent 3-gram repetition
        "early_stopping": True,  # Stop when EOS is generated
    }
    
    try:
        # Provide a transcribe task prompt when supported.
        forced = asr_processor.get_decoder_prompt_ids(task="transcribe")
        if forced:
            gen_kwargs["forced_decoder_ids"] = forced
    except Exception:
        pass

    with torch.inference_mode():
        predicted_ids = asr_model.generate(input_features, **gen_kwargs)

    text = asr_processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]
    return (text or "").strip()

print("[MediVoice] Loading LLM (MedGemma)...")
#
# MedGemma on Hugging Face is published as Gemma 3 variants (e.g. 4B, 27B).
# The 4B instruction-tuned checkpoint is `google/medgemma-4b-it`:
# https://huggingface.co/google/medgemma-4b-it
#
LLM_ID = os.getenv("MEDGEMMA_MODEL_ID", "google/medgemma-4b-it")
LLM_PATH = os.getenv("MEDGEMMA_MODEL_PATH")  # optional local folder path
if (
    not LLM_PATH
    and (DEFAULT_MEDGEMMA_LOCAL_DIR / "config.json").exists()
    and any(DEFAULT_MEDGEMMA_LOCAL_DIR.glob("*.safetensors"))
):
    LLM_PATH = str(DEFAULT_MEDGEMMA_LOCAL_DIR)
    print(f"[MediVoice] Using local MedGemma from: {LLM_PATH}")
llm_dtype = _llm_dtype_for_device(DEVICE)

llm_source = LLM_PATH if LLM_PATH else LLM_ID

try:
    # MedGemma 4B is published as an image-text-to-text model; for text-only, we can still use the
    # chat template and provide only text content.
    LLM_PROCESSOR = _from_pretrained_with_token(
        AutoProcessor.from_pretrained, llm_source, trust_remote_code=True
    )
except Exception as e:
    raise RuntimeError(
        "[MediVoice] Failed to load MedGemma processor. "
        "If using Hugging Face, ensure you're logged in AND you've accepted the model terms. "
        "See: https://huggingface.co/google/medgemma-4b-it"
    ) from e

try:
    LLM_MODEL = _from_pretrained_with_token(
        AutoModelForImageTextToText.from_pretrained,
        llm_source,
        torch_dtype=llm_dtype,
        low_cpu_mem_usage=True,
        trust_remote_code=True,
        device_map="auto" if DEVICE.type == "cuda" else None,
    )
except Exception as e:
    # Fallback for any text-only variants if user overrides MEDGEMMA_MODEL_ID to a causal LM
    LLM_MODEL = _from_pretrained_with_token(
        AutoModelForCausalLM.from_pretrained,
        llm_source,
        torch_dtype=llm_dtype,
        low_cpu_mem_usage=True,
        trust_remote_code=True,
        device_map="auto" if DEVICE.type == "cuda" else None,
    )

if DEVICE.type != "cuda":
    LLM_MODEL.to(DEVICE)
LLM_MODEL.eval()

print("[MediVoice] Models loaded successfully.")


class VitalsModel(BaseModel):
    bp: Optional[str] = None
    temp: Optional[str] = None
    pulse: Optional[str] = None
    spo2: Optional[str] = None


class VitalsResponse(BaseModel):
    transcription: str = Field(..., description="ASR transcription text")
    vitals: VitalsModel = Field(..., description="Extracted vital signs")


class ExtractVitalsRequest(BaseModel):
    transcription: str = Field(..., description="Transcription text from Web Speech API or other source")


class DiagnosisRequest(BaseModel):
    symptoms: str
    vitals: Dict[str, Any]  # {bp, temp, pulse...}
    history: Optional[str] = None


class DiagnosisItem(BaseModel):
    condition: str
    probability: float
    reasoning: str


class DiagnosisResponse(BaseModel):
    diagnoses: List[DiagnosisItem]


class ConfirmDiagnosisRequest(BaseModel):
    initial_diagnosis: List[Dict[str, Any]]  # previous AI output
    symptoms: str
    lab_results: Dict[str, str]  # {"Malaria RDT": "Positive", "WBC": "12.5"}


class ConfirmDiagnosisResponse(BaseModel):
    final_diagnosis: List[Dict[str, Any]]
    analysis: str


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    # Allow all origins (needed for ngrok which has changing URLs, and Vercel preview deployments)
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
        "process_audio": "POST /process-audio (multipart/form-data; field name: file)",
    }


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/extract-vitals", response_model=VitalsResponse)
async def extract_vitals(req: ExtractVitalsRequest) -> VitalsResponse:
    """
    Extract vital signs from a transcription text (no audio processing).
    Used when frontend provides transcription via Web Speech API.
    """
    transcript = (req.transcription or "").strip()
    if not transcript:
        raise HTTPException(status_code=400, detail="transcription is required")

    print(f"[MediVoice] Extracting vitals from transcription: {transcript}")

    prompt_primary = (
        "Extract vital signs from this transcript into STRICT JSON with keys: bp, temp, pulse, spo2.\n"
        "- Use bp format like \"140/90\" when possible.\n"
        "- temp should be a number in Celsius if present.\n"
        "- pulse should be a number (bpm) if present.\n"
        "- spo2 should be a number (percent) if present.\n"
        "Return ONLY the JSON object (no markdown, no extra text).\n"
        f"Transcript: {transcript}"
    )

    completion = _medgemma_generate(prompt_primary)
    if not completion or not completion.strip():
        # One retry with a shorter/less strict prompt in case the model is refusing/terminating early
        prompt_retry = f"Return a JSON object with bp,temp,pulse,spo2 extracted from: {transcript}"
        completion = _medgemma_generate(prompt_retry)

    try:
        vitals_raw = _robust_json_extract(completion)
    except Exception as e:
        print(f"[MediVoice] Warning: could not parse JSON from MedGemma output. output={completion!r}")
        # Return transcription but empty vitals rather than crashing the request.
        vitals_raw = {}

    vitals_norm = _normalize_vitals(vitals_raw)

    return VitalsResponse(
        transcription=transcript,
        vitals=VitalsModel(**vitals_norm),
    )


@app.post("/process-audio", response_model=VitalsResponse)
async def process_audio(file: UploadFile = File(...)) -> VitalsResponse:
    TEMP_DIR.mkdir(parents=True, exist_ok=True)

    content_type = (file.content_type or "").lower()
    if "audio" not in content_type:
        raise HTTPException(status_code=400, detail=f"Unsupported content-type: {file.content_type}")

    suffix = ".webm"
    if "wav" in content_type:
        suffix = ".wav"
    elif "webm" in content_type:
        suffix = ".webm"
    elif file.filename and "." in file.filename:
        suffix = "." + file.filename.split(".")[-1].lower()

    tmp_path = TEMP_DIR / f"{uuid.uuid4().hex}{suffix}"

    try:
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Empty upload")
        tmp_path.write_bytes(data)

        try:
            audio = _load_audio_mono_16k(tmp_path)
        except Exception as e:
            raise HTTPException(status_code=422, detail=str(e))

        # Log audio quality metrics for debugging
        duration = len(audio) / 16000.0
        rms = np.sqrt(np.mean(audio**2))
        peak = np.abs(audio).max()
        print(f"[MediVoice] Audio: {duration:.2f}s, RMS={rms:.4f}, Peak={peak:.4f}")

        transcript = _transcribe_with_whisper(audio, sampling_rate=16000)

        if not transcript:
            raise HTTPException(status_code=422, detail="Could not transcribe audio (empty transcript)")

        print(f"[MediVoice] Transcription: {transcript}")

        prompt_primary = (
            "Extract vital signs from this transcript into STRICT JSON with keys: bp, temp, pulse, spo2.\n"
            "- Use bp format like \"140/90\" when possible.\n"
            "- temp should be a number in Celsius if present.\n"
            "- pulse should be a number (bpm) if present.\n"
            "- spo2 should be a number (percent) if present.\n"
            "Return ONLY the JSON object (no markdown, no extra text).\n"
            f"Transcript: {transcript}"
        )

        completion = _medgemma_generate(prompt_primary)
        if not completion or not completion.strip():
            # One retry with a shorter/less strict prompt in case the model is refusing/terminating early
            prompt_retry = f"Return a JSON object with bp,temp,pulse,spo2 extracted from: {transcript}"
            completion = _medgemma_generate(prompt_retry)

        try:
            vitals_raw = _robust_json_extract(completion)
        except Exception as e:
            print(f"[MediVoice] Warning: could not parse JSON from MedGemma output. output={completion!r}")
            # Return transcription but empty vitals rather than crashing the request.
            vitals_raw = {}

        vitals_norm = _normalize_vitals(vitals_raw)

        return VitalsResponse(
            transcription=transcript,
            vitals=VitalsModel(**vitals_norm),
        )
    finally:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except Exception as cleanup_err:
            print(f"[MediVoice] Warning: temp cleanup failed for {tmp_path}: {cleanup_err}")


@app.post("/diagnose", response_model=DiagnosisResponse)
async def diagnose(req: DiagnosisRequest) -> DiagnosisResponse:
    symptoms = (req.symptoms or "").strip()
    if not symptoms:
        raise HTTPException(status_code=400, detail="symptoms is required")

    vitals = req.vitals or {}
    bp = str(vitals.get("bp") or "").strip()
    temp = str(vitals.get("temp") or "").strip()
    pulse = str(vitals.get("pulse") or "").strip()
    spo2 = str(vitals.get("spo2") or "").strip()

    history = (req.history or "").strip()

    prompt = (
        f"Patient presents with symptoms: {symptoms}\n"
        f"Vitals: BP {bp}, Temp {temp}, Pulse {pulse}, SpO2 {spo2}.\n"
        + (f"History: {history}\n" if history else "")
        + "Task: Provide a differential diagnosis of the top 3 most likely conditions based on standard tropical "
        "medicine guidelines (Ghana).\n"
        "Rules:\n"
        "- Return EXACTLY 3 items.\n"
        "- probability MUST be a number from 0.0 to 1.0.\n"
        "- reasoning MUST be ONE sentence, max 20 words.\n"
        "Return ONLY a raw JSON list: "
        "[{'condition': 'Name', 'probability': 0.0, 'reasoning': '...'}]"
    )

    # Diagnosis responses can be longer than vitals extraction; allow a bigger budget.
    completion = _medgemma_generate(prompt, max_new_tokens=512, min_new_tokens=48)
    try:
        parsed = _robust_json_extract_any(completion)
    except Exception:
        print(f"[MediVoice] Warning: could not parse JSON list from MedGemma output. output={completion!r}")
        parsed = []

    if not isinstance(parsed, list):
        parsed = []

    items: List[DiagnosisItem] = []
    for raw in parsed[:3]:
        if not isinstance(raw, dict):
            continue
        condition = str(raw.get("condition") or "").strip()
        reasoning = str(raw.get("reasoning") or "").strip()
        prob_raw = raw.get("probability")
        try:
            prob = float(prob_raw)
        except Exception:
            prob = 0.0
        # Accept percent-style outputs like 85 or "85%".
        if prob > 1.0 and prob <= 100.0:
            prob = prob / 100.0
        prob = max(0.0, min(1.0, prob))
        if not condition:
            continue
        if not reasoning:
            reasoning = "No reasoning provided."
        items.append(DiagnosisItem(condition=condition, probability=prob, reasoning=reasoning))

    return DiagnosisResponse(diagnoses=items)


@app.post("/confirm-diagnosis", response_model=ConfirmDiagnosisResponse)
async def confirm_diagnosis(req: ConfirmDiagnosisRequest) -> ConfirmDiagnosisResponse:
    symptoms = (req.symptoms or "").strip()
    if not symptoms:
        raise HTTPException(status_code=400, detail="symptoms is required")

    initial = req.initial_diagnosis or []
    labs = req.lab_results or {}

    prompt = (
        "Clinical Update:\n"
        f"Initial Hypothesis: {json.dumps(initial, ensure_ascii=False)}\n"
        f"New Lab Results: {json.dumps(labs, ensure_ascii=False)}\n"
        f"Symptoms: {symptoms}\n"
        "Task: Re-evaluate the diagnosis. Does the lab result confirm, refute, or suggest a new condition?\n"
        "Return JSON: {'final_diagnosis': [...], 'analysis': 'Brief explanation'}\n"
        "Rules:\n"
        "- final_diagnosis MUST be a JSON list of up to 3 items.\n"
        "- Each item should include condition, probability (0.0-1.0), reasoning.\n"
        "- analysis MUST be 1-2 sentences.\n"
        "Return ONLY the JSON object (no markdown, no extra text)."
    )

    completion = _medgemma_generate(prompt, max_new_tokens=512, min_new_tokens=48)
    try:
        parsed = _robust_json_extract_any(completion)
    except Exception:
        print(f"[MediVoice] Warning: could not parse JSON from MedGemma output. output={completion!r}")
        parsed = {}

    if not isinstance(parsed, dict):
        parsed = {}

    final_dx = parsed.get("final_diagnosis")
    analysis = parsed.get("analysis")
    if not isinstance(final_dx, list):
        final_dx = []
    if not isinstance(analysis, str) or not analysis.strip():
        analysis = "No analysis provided."

    # Light normalization: keep only dict items, coerce probability if present.
    cleaned: List[Dict[str, Any]] = []
    for item in final_dx[:3]:
        if not isinstance(item, dict):
            continue
        condition = str(item.get("condition") or "").strip()
        reasoning = str(item.get("reasoning") or "").strip()
        prob_raw = item.get("probability")
        try:
            prob = float(prob_raw)
        except Exception:
            prob = 0.0
        if prob > 1.0 and prob <= 100.0:
            prob = prob / 100.0
        prob = max(0.0, min(1.0, prob))
        if not condition:
            continue
        cleaned.append(
            {
                "condition": condition,
                "probability": prob,
                "reasoning": reasoning or "No reasoning provided.",
            }
        )

    return ConfirmDiagnosisResponse(final_diagnosis=cleaned, analysis=analysis.strip())

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)


