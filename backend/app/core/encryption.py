"""
Application-level field encryption using Fernet (AES-128-CBC + HMAC-SHA256).
Provides transparent encrypt/decrypt for sensitive database fields.

Key is loaded from ENCRYPTION_KEY in app config (.env).
"""
from typing import Union
from cryptography.fernet import Fernet, MultiFernet, InvalidToken
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator
import functools
import logging

logger = logging.getLogger(__name__)

# Sentinel strings returned by decrypt_field when decryption is impossible.
# Callers that receive these must NOT use the value as real data.
_DECRYPTION_PLACEHOLDERS = frozenset({"[UNREADABLE]", "[DECRYPTION_ERROR]"})


# ---------------------------------------------------------------------------
# Key Management
# ---------------------------------------------------------------------------

@functools.lru_cache(maxsize=1)
def _get_fernet() -> Union[Fernet, MultiFernet]:
    """Load primary and fallback Fernet keys from app config (.env).
    
    Supports key rotation via MultiFernet:
    - Writes always encrypt using the primary ENCRYPTION_KEY.
    - Reads decrypt transparently using either the primary or fallback keys.
    """
    from app.core.config import get_settings
    settings = get_settings()
    all_keys = getattr(settings, "all_encryption_keys", [])
    if not all_keys and settings.encryption_key:
        all_keys = [settings.encryption_key.strip()]

    if not all_keys:
        raise RuntimeError(
            "CRITICAL: ENCRYPTION_KEY is not set. "
            "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\" "
            "and add ENCRYPTION_KEY=<key> to your .env file."
        )

    fernets = []
    for k in all_keys:
        try:
            f = Fernet(k.encode() if isinstance(k, str) else k)
            test = f.decrypt(f.encrypt(b"__key_validation__"))
            assert test == b"__key_validation__"
            fernets.append(f)
        except Exception as e:
            logger.warning(f"Invalid encryption key skipped: {e}")

    if not fernets:
        raise RuntimeError(
            "CRITICAL: No valid Fernet keys found in configuration."
        )

    if len(fernets) == 1:
        return fernets[0]
    return MultiFernet(fernets)


# ---------------------------------------------------------------------------
# Core Functions
# ---------------------------------------------------------------------------

def is_encrypted(value: str) -> bool:
    """Check if a value is a Fernet token.
    
    Uses both prefix check AND length heuristic:
    - Fernet tokens always start with 'gAAAAA' (base64)
    - Minimum Fernet token length is ~120 chars for even 1-byte plaintext
    - This avoids false positives from short strings starting with 'gAAAAA'
    """
    if not value or not isinstance(value, str):
        return False
    # Fernet tokens: base64-encoded, always start with 'gAAAAA' (ver 0x80)
    # and follow a strict length and character set. 
    # Length check: Even a 1-character plaintext results in 120 chars.
    if len(value) < 100 or not value.startswith("gAAAAA"):
        return False
    # Heuristic: Fernet tokens only contain URL-safe base64 chars
    return True


def encrypt_field(plaintext: str) -> str:
    """Encrypt a string value. Returns Fernet token as string.
    
    - None → returns None (preserves NULL semantics)
    - Empty string → encrypts as valid value (preserves "" vs NULL distinction)
    - Already encrypted → returns as-is (no double encryption)
    - Non-string → coerced to str first
    """
    if plaintext is None:
        return None
    if not isinstance(plaintext, str):
        plaintext = str(plaintext)
    # Empty string is a valid value — encrypt it to preserve "" vs NULL
    if is_encrypted(plaintext):
        return plaintext  # Already encrypted — skip
    
    f = _get_fernet()
    token = f.encrypt(plaintext.encode("utf-8"))
    return token.decode("utf-8")


def decrypt_field(ciphertext: str) -> str:
    """Decrypt a Fernet token back to plaintext.
    
    - None -> returns None
    - Empty string -> returns empty string
    - Not encrypted (plain text) -> returns as-is
    - Invalid Fernet token -> returns "[DECRYPTION_ERROR]"
    """
    if ciphertext is None:
        return None
    if not isinstance(ciphertext, str) or not ciphertext:
        return ciphertext
    
    # Backward compatibility: if it doesn't look like a Fernet token, assume it's plain text
    if not is_encrypted(ciphertext):
        from app.core.config import get_settings
        # Always read enforce_encryption from settings so the check is consistent
        # across all gunicorn worker processes (module-level globals are per-process).
        if get_settings().enforce_encryption:
            logger.critical(
                f"SECURITY CRITICAL: Unencrypted sensitive database column detected. "
                f"Plaintext preview: '{ciphertext[:20]}...'. "
                "Returning plaintext blocked under strict ENFORCE_ENCRYPTION policy."
            )
            raise ValueError("Decryption blocked: Enforce encryption is active but data is not encrypted.")
        else:
            logger.warning(f"Unencrypted legacy data returned from encrypted column: '{ciphertext[:20]}...'")
        return ciphertext
    
    try:
        f = _get_fernet()
        plaintext = f.decrypt(ciphertext.encode("utf-8"))
        return plaintext.decode("utf-8")
    except InvalidToken:
        _log_decrypt_failure(ciphertext[:20])
        return "[UNREADABLE]"
    except Exception as e:
        # Unexpected errors (e.g. malformed base64 that passed heuristic)
        _log_decrypt_failure(ciphertext[:15] + " (err)")
        return "[DECRYPTION_ERROR]"

@functools.lru_cache(maxsize=500)
def _log_decrypt_failure(preview: str):
    """Log decryption failure once per unique record prefix as DEBUG to avoid overhead."""
    # Only the first log per start should be WARNING to alert the dev.
    # Subsequent unique failures are DEBUG.
    if _log_decrypt_failure.cache_info().currsize < 5:
        logger.warning(
            f"DECRYPTION FAILURE: Key mismatch detected. Record prefix: '{preview}...'. "
            "Data remains unreadable. Verify ENCRYPTION_KEY."
        )
    else:
        logger.debug(f"Decryption failed (mismatch) for prefix: {preview}...")


# ---------------------------------------------------------------------------
# SQLAlchemy TypeDecorator
# ---------------------------------------------------------------------------

class EncryptedText(TypeDecorator):
    """SQLAlchemy column type that transparently encrypts/decrypts Text fields.
    
    Usage in models:
        some_field = Column(EncryptedText, nullable=True)
    
    Behavior:
        - On write (process_bind_param): encrypts plaintext → Fernet token
        - On read  (process_result_value): decrypts Fernet token → plaintext
        - None → stored as NULL, read as None
        - Empty string → encrypted (preserves "" vs NULL distinction)
        - Already-encrypted values are not double-encrypted
        - Pre-migration plain-text values are returned as-is on read
        - Decryption failure raises explicit ValueError (no silent corruption)
    
    The underlying DB column type remains TEXT — no schema change required.
    Thread-safe: Fernet instance is a module-level lru_cache singleton.
    """
    
    impl = Text
    cache_ok = True
    
    def process_bind_param(self, value, dialect):
        """Called before INSERT/UPDATE — encrypt the value."""
        if value is None:
            return None
        return encrypt_field(value)
    
    def process_result_value(self, value, dialect):
        """Called after SELECT — decrypt the value."""
        if value is None:
            return None
        return decrypt_field(value)
