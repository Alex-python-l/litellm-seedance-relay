from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
from dataclasses import dataclass

_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_DUMMY_PASSWORD_HASH = "scrypt:ABEiM0RVZneImaq7zN3u/1ddIix/gvCpQL2TcGTGI1FJFm5vWJ5gUuQRE7Ar2Tso"


@dataclass(frozen=True, slots=True)
class SessionCredentials:
    token: str
    csrf_token: str


def normalize_email(email: str) -> str:
    normalized = email.strip().lower()
    if len(normalized) > 320 or _EMAIL_PATTERN.fullmatch(normalized) is None:
        raise ValueError("invalid email address")
    return normalized


def validate_password(password: str) -> str:
    if len(password) < 12 or len(password) > 128:
        raise ValueError("password must contain between 12 and 128 characters")
    if (
        password.lower() == password
        or password.upper() == password
        or not any(character.isdigit() for character in password)
    ):
        raise ValueError("password must contain upper-case, lower-case, and numeric characters")
    return password


def hash_password(password: str) -> str:
    validated = validate_password(password)
    salt = os.urandom(16)
    derived_key = hashlib.scrypt(validated.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
    return "scrypt:" + base64.b64encode(salt + derived_key).decode()


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash.startswith("scrypt:"):
        return False
    try:
        raw = base64.b64decode(password_hash[7:], validate=True)
        if len(raw) != 48:
            return False
        salt, expected = raw[:16], raw[16:]
        actual = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
        return secrets.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def verify_account_password(password: str, password_hash: str | None) -> bool:
    matches = verify_password(password, password_hash or _DUMMY_PASSWORD_HASH)
    return password_hash is not None and matches


def new_auth_token() -> str:
    return secrets.token_urlsafe(48)


def new_session_credentials() -> SessionCredentials:
    return SessionCredentials(token=secrets.token_urlsafe(48), csrf_token=secrets.token_urlsafe(32))


def hash_session_token(secret: bytes, token: str) -> str:
    return hmac.new(secret, token.encode(), hashlib.sha256).hexdigest()


def hash_auth_token(secret: bytes, token: str) -> str:
    return hmac.new(secret, f"auth:{token}".encode(), hashlib.sha256).hexdigest()


def hash_rate_limit_key(secret: bytes, key: str) -> str:
    return hmac.new(secret, f"limit:{key}".encode(), hashlib.sha256).hexdigest()
