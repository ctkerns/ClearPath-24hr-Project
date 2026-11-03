"""Password hashing with Argon2id, the algorithm that OWASP recommends for passwords."""

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

# Library defaults (RFC 9106 "low memory" profile). Each hash has its own random salt.
_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """True when the password matches. Never raises for a wrong password or a damaged hash."""
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    """True when the hash uses older settings. Sign-in then saves a new hash."""
    return _hasher.check_needs_rehash(password_hash)
