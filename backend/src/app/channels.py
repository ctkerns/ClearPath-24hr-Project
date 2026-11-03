"""Channels and their content fields (PRD section 7, F3).

Each channel's connector gives its content as these fields, in the order the platform shows them.
The submit form shows the same fields, and a submission may only use them (`check_fields`).
Every signed-in user reads them, affiliates too, because they all use the submit form.
"""

from typing import Literal, Protocol

from fastapi import APIRouter

from app.api import APIModel, SignedIn
from app.models.materials import Channel

router = APIRouter(prefix="/api/channels", tags=["channels"])


class ChannelField(APIModel):
    label: str
    multiline: bool = False
    kind: Literal["image"] | None = None  # the ad image; its text is the text in the image


def _f(label: str, *, multiline: bool = False, kind: Literal["image"] | None = None) -> ChannelField:
    return ChannelField(label=label, multiline=multiline, kind=kind)


# In platform order. The pre-review reads fields by label, so a rename here changes what it quotes.
CHANNEL_FIELDS: dict[Channel, tuple[ChannelField, ...]] = {
    Channel.META: (
        _f("Primary text", multiline=True),
        _f("Headline"),
        _f("Description"),
        _f("Call to action"),
        _f("Image", kind="image"),
    ),
    Channel.GOOGLE: (_f("Headline 1"), _f("Headline 2"), _f("Headline 3"), _f("Description", multiline=True)),
    Channel.MAILCHIMP: (_f("Subject line"), _f("Preview text"), _f("Body", multiline=True)),
    Channel.WORDPRESS: (_f("Page title"), _f("Body", multiline=True)),
    Channel.AFFILIATE: (_f("Page text", multiline=True),),
    Channel.OTHER: (_f("Body", multiline=True),),
}
assert set(CHANNEL_FIELDS) == set(Channel), "every channel has its fields"

# Content given as uploaded files or as a URL is one field with one of these labels, on any channel.
SOURCE_LABELS = ("Files", "URL")


class SubmittedField(Protocol):
    label: str
    kind: Literal["image"] | None


def check_fields[F: SubmittedField](channel: Channel, fields: list[F]) -> list[F]:
    """The submitted fields in platform order, each with the kind of its definition. Raises ValueError for
    an unknown or repeated label. No single field is required: the content needs only one field with text,
    which the caller checks after it drops the empty ones (the same rules as the submit form)."""
    labels = [f.label for f in fields]
    if len(set(labels)) != len(labels):
        raise ValueError("Each content field can be given only once")
    if any(label in SOURCE_LABELS for label in labels):
        if len(fields) != 1:
            raise ValueError("Content from files or a URL is the only content field")
        return fields
    known = {d.label: (i, d) for i, d in enumerate(CHANNEL_FIELDS[channel])}
    unknown = [label for label in labels if label not in known]
    if unknown:
        raise ValueError(f"Unknown content fields for this channel: {', '.join(unknown)}")
    for f in fields:
        kind = known[f.label][1].kind
        if f.kind is not None and f.kind != kind:
            raise ValueError(f"{f.label} is not an image field")
        f.kind = kind
    return sorted(fields, key=lambda f: known[f.label][0])


class ChannelOut(APIModel):
    channel: Channel
    fields: list[ChannelField]


@router.get("", response_model_exclude_none=True)
async def list_channels(viewer: SignedIn) -> list[ChannelOut]:
    """Every channel with its content fields, in the order of the Channel enum."""
    return [ChannelOut(channel=c, fields=list(CHANNEL_FIELDS[c])) for c in Channel]
