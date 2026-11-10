import logging
import smtplib
from email.message import EmailMessage

from app.core.config import get_settings

log = logging.getLogger("tectha.email")


def send(to: str, subject: str, body: str) -> bool:
    """Send via SMTP when configured. Without SMTP, development logs the message; production logs only a warning."""
    s = get_settings()
    if not s.SMTP_HOST:
        if s.is_production:
            log.warning("SMTP not configured — email to %s not sent", to)
        else:
            log.warning("[dev email] to=%s subject=%s\n%s", to, subject, body)
        return False
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = s.SMTP_FROM, to, subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(s.SMTP_HOST, s.SMTP_PORT, timeout=15) as smtp:
            if s.SMTP_STARTTLS:
                smtp.starttls()
            if s.SMTP_USERNAME:
                smtp.login(s.SMTP_USERNAME, s.SMTP_PASSWORD)
            smtp.send_message(msg)
        return True
    except (OSError, smtplib.SMTPException) as exc:
        log.error("email to %s failed: %s", to, exc)
        return False
