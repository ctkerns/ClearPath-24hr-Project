"""Outgoing email, for invites (PRD F16) and later notifications (F13).

The setting `mail_backend` chooses how mail goes out. "console" (the default) only writes the message to the
log, so a developer can copy the link from the backend output. Tests replace `send` to read the messages.
"""

import logging

from app.config import settings

log = logging.getLogger(__name__)


def send(to: str, subject: str, text: str) -> None:
    if settings.mail_backend == "smtp":
        # TODO: send over SMTP, with the server, user and password from settings.
        raise NotImplementedError("The smtp mail backend is not built yet")
    # Warning level, so it shows with the default log setup, and nobody thinks the mail really went out.
    log.warning("Email not sent (console mail backend)\nTo: %s\nSubject: %s\n\n%s", to, subject, text)
