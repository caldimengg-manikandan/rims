import os
import logging
import re
import time
import httpx
from typing import Optional
from groq import AsyncGroq, APIConnectionError, APITimeoutError, RateLimitError, APIStatusError
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type, before_sleep_log
import nh3

logger = logging.getLogger(__name__)

# Active models on Groq
GROQ_DEFAULT_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
GROQ_FALLBACK_MODELS = ["qwen/qwen3.8-27b", "openai/gpt-oss-20b"]

# Defunct models to rewrite
DEFUNCT_MODELS = {"llama-3.1-8b-instant", "llama-3.3-70b-versatile"}

# OpenRouter configuration
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
OPENROUTER_DEFAULT_MODEL = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct")


def is_ai_unavailable_response(content: str | None) -> bool:
    """
    True when the chat layer did not return usable model text (disabled API, error, or empty).
    """
    if content is None:
        return True
    c = str(content).strip()
    return c == "" or c == "AI_DISABLED"


def sanitize_content(text: str) -> str:
    """Removes potential scripts or malicious HTML from AI responses."""
    if not text:
        return ""
    return nh3.clean(text)


class AIClient:
    def __init__(self):
        self.provider = (os.getenv("AI_PROVIDER") or "groq").lower().strip()
        self.timeout_s = float(os.getenv("AI_TIMEOUT_SECONDS", "45") or "45")

        # 1. Resolve Groq Key
        self.groq_key = ""
        try:
            from app.core.config import get_settings
            settings = get_settings()
            keys = settings.groq_keys
            if keys:
                self.groq_key = keys[0]
            self.provider = (getattr(settings, "ai_provider", None) or self.provider).lower().strip()
            self.openrouter_key = (getattr(settings, "openrouter_api_key", None) or os.getenv("OPENROUTER_API_KEY", "")).strip()
        except Exception:
            self.openrouter_key = (os.getenv("OPENROUTER_API_KEY", "") or "").strip()

        if not self.groq_key:
            self.groq_key = (os.getenv("GROQ_API_KEY", "") or "").strip()

        # Groq client instance
        self.groq_client: Optional[AsyncGroq] = None
        if self.groq_key:
            try:
                self.groq_client = AsyncGroq(api_key=self.groq_key, timeout=self.timeout_s)
            except Exception as e:
                logger.warning(f"Failed to initialize Groq client: {e}")

        # Legacy alias for backward compatibility with interview_process
        self.client = self.groq_client

        # OpenRouter client via httpx
        self.openrouter_client: Optional[httpx.AsyncClient] = None
        if self.openrouter_key:
            self.openrouter_client = httpx.AsyncClient(
                base_url=OPENROUTER_BASE_URL.rstrip("/"),
                headers={
                    "Authorization": f"Bearer {self.openrouter_key}",
                    "HTTP-Referer": "http://localhost:3000",
                    "X-Title": "CALRIMS",
                    "Content-Type": "application/json",
                },
                timeout=self.timeout_s,
            )

        # Overall status
        self.disabled = not (self.groq_client or self.openrouter_client)
        if self.disabled:
            logger.warning("AI features disabled - neither GROQ_API_KEY nor OPENROUTER_API_KEY is available.")
        else:
            logger.info(f"AIClient initialized. Primary provider: {self.provider} (Groq available: {bool(self.groq_client)}, OpenRouter available: {bool(self.openrouter_client)})")

    def _resolve_model(self, model: Optional[str], provider: str) -> str:
        """Map defunct or empty models to current active models for the chosen provider."""
        if provider == "openrouter":
            if not model or model in DEFUNCT_MODELS:
                return OPENROUTER_DEFAULT_MODEL
            return model
        else:
            if not model or model in DEFUNCT_MODELS:
                return GROQ_DEFAULT_MODEL
            return model

    @retry(
        retry=retry_if_exception_type((APIConnectionError, APITimeoutError, RateLimitError)),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        before_sleep=before_sleep_log(logger, logging.INFO),
        reraise=True
    )
    async def _call_groq(self, prompt: str, system_instr: str, model: str) -> str:
        if not self.groq_client:
            raise RuntimeError("Groq client not initialized")
        response = await self.groq_client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_instr},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=4096,
        )
        return response.choices[0].message.content or ""

    async def _call_openrouter(self, prompt: str, system_instr: str, model: str) -> str:
        if not self.openrouter_key:
            raise RuntimeError("OpenRouter API key not configured")
        
        url = f"{OPENROUTER_BASE_URL.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.openrouter_key}",
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "CALRIMS",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_instr},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.7,
            "max_tokens": 2000,
        }

        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"] or ""

    async def generate(
        self,
        prompt: str,
        system_instr: str = "You are a helpful assistant",
        model: Optional[str] = None,
        provider: Optional[str] = None
    ) -> str:
        """Centralized AI generator with multi-provider failover and active model routing."""
        if self.disabled:
            logger.warning("AI Disabled - Returning graceful fallback response.")
            return "AI_DISABLED"

        target_provider = (provider or self.provider).lower().strip()
        # If requested provider has no client, fallback to other available provider
        if target_provider == "openrouter" and not self.openrouter_key:
            if self.groq_client:
                logger.info("OpenRouter key not configured, switching to Groq.")
                target_provider = "groq"
            else:
                return "AI_DISABLED"
        elif target_provider == "groq" and not self.groq_client:
            if self.openrouter_key:
                logger.info("Groq key not configured, switching to OpenRouter.")
                target_provider = "openrouter"
            else:
                return "AI_DISABLED"

        resolved_model = self._resolve_model(model, target_provider)
        t0 = time.perf_counter()

        # Primary attempt
        try:
            if target_provider == "openrouter":
                raw = await self._call_openrouter(prompt, system_instr, resolved_model)
            else:
                raw = await self._call_groq(prompt, system_instr, resolved_model)

            if raw and str(raw).strip():
                content = sanitize_content(str(raw).strip())
                elapsed_ms = (time.perf_counter() - t0) * 1000.0
                logger.debug(f"AI generate ok via {target_provider} ({resolved_model}) in {elapsed_ms:.1f}ms")
                return content

        except Exception as primary_err:
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            logger.warning(f"AI primary provider {target_provider} ({resolved_model}) failed in {elapsed_ms:.1f}ms: {primary_err}")

            # 1. Try secondary provider if available
            secondary_provider = "groq" if target_provider == "openrouter" else "openrouter"
            can_try_secondary = (secondary_provider == "groq" and self.groq_client) or (secondary_provider == "openrouter" and self.openrouter_key)

            if can_try_secondary:
                sec_model = self._resolve_model(None, secondary_provider)
                logger.info(f"Failing over to secondary AI provider: {secondary_provider} ({sec_model})")
                try:
                    if secondary_provider == "openrouter":
                        raw = await self._call_openrouter(prompt, system_instr, sec_model)
                    else:
                        raw = await self._call_groq(prompt, system_instr, sec_model)

                    if raw and str(raw).strip():
                        return sanitize_content(str(raw).strip())
                except Exception as sec_err:
                    logger.error(f"Secondary provider {secondary_provider} also failed: {sec_err}")

            # 2. Try in-provider fallback models (for Groq)
            if target_provider == "groq" and self.groq_client:
                for fb_model in GROQ_FALLBACK_MODELS:
                    if fb_model != resolved_model:
                        try:
                            logger.info(f"Attempting Groq in-provider fallback to model: {fb_model}")
                            raw = await self._call_groq(prompt, system_instr, fb_model)
                            if raw and str(raw).strip():
                                return sanitize_content(str(raw).strip())
                        except Exception as fb_err:
                            logger.warning(f"Groq fallback model {fb_model} failed: {fb_err}")

        return "AI_DISABLED"


# Singleton instance
ai_client = AIClient()


def clean_json(text: str) -> str:
    """Clean markdown code blocks from JSON string and extract first JSON object"""
    if not text:
        return "{}"
    text = text.replace("```json", "").replace("```", "").strip()
    match = re.search(r'(\{.*\})', text, re.DOTALL)
    if match:
        return match.group(1)
    match_list = re.search(r'(\[.*\])', text, re.DOTALL)
    if match_list:
        return match_list.group(1)
    if text.startswith("{") and not text.endswith("}"):
        return text + '"}'
    return text
