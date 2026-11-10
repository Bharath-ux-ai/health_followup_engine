import phonenumbers

from app.services.errors import InvalidInput


def normalize_phone(raw: str, region: str = "IN") -> str:
    """Return E.164 (+919876543210). Raises InvalidInput for anything that is not a valid mobile number."""
    try:
        parsed = phonenumbers.parse(raw.strip(), region)
    except phonenumbers.NumberParseException:
        raise InvalidInput("Enter a valid mobile number")
    if not phonenumbers.is_valid_number(parsed):
        raise InvalidInput("Enter a valid mobile number")
    if phonenumbers.number_type(parsed) not in (
        phonenumbers.PhoneNumberType.MOBILE, phonenumbers.PhoneNumberType.FIXED_LINE_OR_MOBILE
    ):
        raise InvalidInput("Enter a mobile number that uses WhatsApp")
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


def digits(e164: str) -> str:
    return "".join(c for c in e164 if c.isdigit())


def mask(e164: str) -> str:
    return e164[:-6] + "••" + e164[-4:] if len(e164) > 8 else "••••"
