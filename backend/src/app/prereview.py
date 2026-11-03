"""Automated pre-review, layer 1: code checks (PRD F4, F7, F8). No AI.

When a version is submitted, the code rules that apply to it run on its content. Each problem becomes a
finding from the "Rule check" author, with the rule's severity (never computed). The checks are exact and
give the same result every time, so an auditor can follow them, and an injection cannot change them.

The checks are pure functions on plain data (RuleSpec, Library, the field texts), so the evaluation set
in tests/eval runs them without a database. `run` loads the library and stores the result.
"""

import html
import logging
import re
import unicodedata
import uuid
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from typing import Any

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api import conflict, not_found
from app.audit import OtherActor, record
from app.material_access import Db, Reviewer, now, visible
from app.models import Workspace
from app.models.library import CheckLayer, Disclosure, RateSheet, Rule
from app.models.materials import (
    Finding,
    FindingSource,
    FindingStatus,
    Material,
    MaterialStatus,
    MaterialVersion,
    Severity,
)

log = logging.getLogger(__name__)

AUTHOR = "Rule check"  # the author of code findings (PRD F4)


# ---- The library, as plain data ----


@dataclass(frozen=True)
class RuleSpec:
    """The current version of one rule (F7)."""

    id: str
    title: str
    text: str
    severity: str  # low, medium or high: copied to each finding as it is
    layer: str  # code or ai
    jurisdiction: str  # "federal", "all", or a state code
    products: Sequence[str] = ()  # empty: every product
    channels: Sequence[str] = ()  # empty: every channel
    check: dict[str, Any] = field(default_factory=dict)
    effective_date: date | None = None


@dataclass(frozen=True)
class DisclosureSpec:
    """The current approved wording of a disclosure, and its older wordings (F8)."""

    id: str
    title: str
    version: int
    text: str
    products: Sequence[str] = ()
    states: Sequence[str] | None = None  # None: every licensed state
    old: Sequence[tuple[int, str]] = ()  # (version, text) of older versions


@dataclass(frozen=True)
class RateRange:
    """One row of the current rate sheet. min and max are fractions: 0.0899 is 8.99%."""

    product: str
    rate: str  # apr or apy
    min: float
    max: float


@dataclass
class Library:
    rules: list[RuleSpec]
    disclosures: dict[str, DisclosureSpec]
    rates: list[RateRange] | None  # None when the workspace has no rate sheet
    licensed_states: list[str]


@dataclass
class Hit:
    """One finding from a code check. `field` and `start`/`end` locate the quote in the raw field text;
    `field` is None for something missing (a disclosure or phrase), which has no text to quote."""

    rule_id: str
    severity: str
    flagged_text: str
    explanation: str
    suggestion: str | None = None
    field: int | None = None
    start: int = 0
    end: int = 0


class ConfigError(Exception):
    """A rule that cannot run, for example one that names an unknown disclosure. It is logged and skipped."""


# ---- Normalising text ----

# Lookalike letters from other scripts, so "nо credit check" with a Cyrillic "о" still matches.
CONFUSABLES = str.maketrans({
    "а": "a", "в": "b", "е": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t",
    "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ɡ": "g", "α": "a", "ε": "e", "ι": "i",
    "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x",
    "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-",
    "‘": "'", "’": "'", "‚": "'", "‛": "'", "“": '"', "”": '"', "„": '"', "‟": '"',
})

MARKUP = re.compile(r"<!--|<\s*/?\s*[a-zA-Z][^<>]*>")
TAG = re.compile(r"<\s*(/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b[^<>]*>")
ENTITY = re.compile(r"&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});")
BLOCK_TAGS = {"br", "p", "div", "li", "ul", "ol", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article"}


def invisible(ch: str) -> bool:
    """Format characters (zero-width spaces and joiners, bidi controls, soft hyphens, tag characters),
    variation selectors, and fillers. A reader does not see them."""
    return unicodedata.category(ch) == "Cf" or "\ufe00" <= ch <= "\ufe0f" or ch in "\u034f\u115f\u1160\u3164\uffa0"


@dataclass
class Text:
    """A text for matching: NFKC, lower case, lookalikes and dashes mapped, invisible characters removed,
    whitespace as single spaces, and (for markup) tags and comments removed. `starts` and `ends` give
    the raw span of each character, so a match can quote the exact raw text."""

    raw: str
    norm: str
    starts: list[int]
    ends: list[int]

    def quote(self, start: int, end: int) -> tuple[int, int]:
        """The raw span of norm[start:end]."""
        return self.starts[start], self.ends[end - 1]


def normalise(raw: str) -> Text:
    markup = bool(MARKUP.search(raw))
    out: list[str] = []
    starts: list[int] = []
    ends: list[int] = []

    def emit(chars: str, s: int, e: int) -> None:
        for c in unicodedata.normalize("NFKC", chars).translate(CONFUSABLES).casefold():
            if c.isspace():
                if not out or out[-1] == " ":
                    continue
                c = " "
            elif invisible(c):
                continue
            out.append(c)
            starts.append(s)
            ends.append(e)

    i = 0
    while i < len(raw):
        if markup and raw.startswith("<!--", i):
            close = raw.find("-->", i + 4)
            i = len(raw) if close < 0 else close + 3
            continue
        if markup and raw[i] == "<" and (m := TAG.match(raw, i)):
            if m[2].lower() in BLOCK_TAGS:
                emit(" ", i, m.end())
            i = m.end()
            continue
        if markup and raw[i] == "&" and (m := ENTITY.match(raw, i)):
            emit(html.unescape(m[0]), i, m.end())
            i = m.end()
            continue
        if not invisible(raw[i]):
            emit(raw[i], i, i + 1)
        i += 1
    return Text(raw, "".join(out), starts, ends)


def norm(text: str) -> str:
    return normalise(text).norm.strip()


NUMBER = r"\d[\d,]*(?:\.\d+)?"
AMOUNT = r"\$ ?\d[\d,]*(?:\.\d+)?"
PLACEHOLDERS = {"{number}": NUMBER, "{amount}": AMOUNT}


@lru_cache(maxsize=2048)
def phrase_pattern(phrase: str) -> re.Pattern[str] | None:
    """A phrase from a rule as a pattern on normalised text. Case and spacing do not matter, a space or
    hyphen may also be missing ("risk free", "risk-free", "riskfree"), and a phrase that starts or ends
    with a letter or digit matches only whole words. {number} matches any number, {amount} a dollar amount."""
    p = norm(phrase)
    if not p:
        return None
    regex = []
    for part in re.split(r"(\{number\}|\{amount\})", p):
        if part in PLACEHOLDERS:
            regex.append(PLACEHOLDERS[part])
        elif part:
            regex.append("[ -]?".join(re.escape(t) for t in re.split(r"[ -]+", part)))
    body = "".join(regex)
    first, last = p[0], p[-1]
    before = r"(?<![\w.])" if p.startswith("{number}") else r"(?<!\w)" if first.isalnum() else ""
    after = r"(?![\w])" if (last.isalnum() and not p.endswith("}")) else ""
    return re.compile(before + body + after)


def literal_pattern(text: str) -> re.Pattern[str] | None:
    """An approved text (a disclosure) word for word, ignoring case, spacing and the final full stop."""
    p = norm(text).rstrip(" .")
    if not p:
        return None
    body = r"\s?".join(re.escape(t) for t in p.split(" "))
    return re.compile((r"(?<!\w)" if p[0].isalnum() else "") + body + (r"(?!\w)" if p[-1].isalnum() else ""))


# ---- Content ----


@dataclass
class Content:
    fields: list[tuple[str, str]]  # (label, raw text)
    texts: list[Text] = field(init=False)
    joined: str = field(init=False)  # all fields as one normalised text, for presence checks

    def __post_init__(self) -> None:
        self.texts = [normalise(t) for _, t in self.fields]
        self.joined = " ".join(t.norm for t in self.texts)

    def find(self, pattern: re.Pattern[str]) -> list[tuple[int, int, int]]:
        """Every match as (field, raw start, raw end), in content order."""
        found = []
        for i, t in enumerate(self.texts):
            for m in pattern.finditer(t.norm):
                if m.end() > m.start():
                    found.append((i, *t.quote(m.start(), m.end())))
        return found

    def contains(self, pattern: re.Pattern[str]) -> bool:
        return any(pattern.search(t.norm) for t in self.texts) or bool(pattern.search(self.joined))

    def hit(self, rule: RuleSpec, where: tuple[int, int, int], explanation: str, suggestion: str | None = None) -> Hit:
        i, s, e = where
        return Hit(rule.id, rule.severity, self.fields[i][1][s:e], explanation, suggestion, i, s, e)


# ---- Applicability (F7: the checklist) ----


def target_states(details: dict[str, Any], licensed: Sequence[str]) -> list[str]:
    """The version's target states. Nationwide content gets the rules of every licensed state (F7)."""
    value = str(details.get("targetStates") or "Nationwide")
    if value.strip().lower() == "nationwide":
        return list(licensed)
    return [s.strip().upper() for s in value.split(",") if s.strip()]


def applies(rule: RuleSpec, product: str, channel: str, states: Sequence[str], end_date: date | None = None) -> bool:
    """A code rule applies when its product, channel and jurisdiction match. A rule that takes effect
    only after the material's end date does not apply to it."""
    return rule.layer == CheckLayer.CODE.value and in_scope(rule, product, channel, states, end_date)


def in_scope(rule: RuleSpec, product: str, channel: str, states: Sequence[str], end_date: date | None = None) -> bool:
    """The checklist test of F7 for a rule of either layer: its product, channel and jurisdiction match.
    `applies` adds the layer for the code checks; flagging (app.flags) also needs the AI rules."""
    if rule.products and product not in rule.products:
        return False
    if rule.channels and channel not in rule.channels:
        return False
    if rule.jurisdiction not in ("federal", "all") and rule.jurisdiction not in states:
        return False
    return not (end_date and rule.effective_date and rule.effective_date > end_date)


# ---- The checks ----

Check = Callable[[RuleSpec, Content, Library, str, Sequence[str]], list[Hit]]


def strings(check: dict[str, Any], key: str) -> list[str]:
    value = check.get(key)
    if not isinstance(value, list) or not value or not all(isinstance(v, str) for v in value):
        raise ConfigError(f"check.{key} must be a list of text")
    return value


def disclosure_of(rule: RuleSpec, lib: Library, product: str, states: Sequence[str]) -> DisclosureSpec:
    d = lib.disclosures.get(str(rule.check.get("disclosure")))
    if d is None:
        raise ConfigError(f"unknown disclosure {rule.check.get('disclosure')}")
    if d.products and product not in d.products:
        # For example a trigger rule for mortgages that names the personal loan disclosure.
        raise ConfigError(f"disclosure {d.id} is not for {product}")
    if d.states is not None and not set(d.states) & set(states):
        raise ConfigError(f"disclosure {d.id} is not for these states")
    return d


def add_text(d: DisclosureSpec) -> str:
    return f'Add disclosure {d.id} v{d.version}: "{d.text}"'


def missing_disclosure(rule: RuleSpec, content: Content, d: DisclosureSpec) -> Hit | None:
    """None when the current wording is present. An older wording is quoted, so the fix is clear."""
    pattern = literal_pattern(d.text)
    if pattern is None or content.contains(pattern):
        return None
    for version, text in sorted(d.old, reverse=True):
        old = literal_pattern(text)
        found = content.find(old) if old else []
        if found:
            i, s, e = found[0]
            if content.fields[i][1][e : e + 1] == ".":  # the pattern leaves out the final full stop
                e += 1
            return content.hit(
                rule,
                (i, s, e),
                f"is an old wording of disclosure {d.id} (version {version}). Use the current version {d.version}.",
                f'Replace it with disclosure {d.id} v{d.version}: "{d.text}"',
            )
    return Hit(rule.id, rule.severity, "", f'Disclosure {d.id} "{d.title}" is missing. {rule.text}', add_text(d))


def check_phrase_banned(rule: RuleSpec, content: Content, lib: Library, product: str, states: Sequence[str]) -> list[Hit]:
    found: list[tuple[int, int, int]] = []
    for phrase in strings(rule.check, "phrases"):
        if pattern := phrase_pattern(phrase):
            found += content.find(pattern)
    # The longest match wins where two phrases overlap; the same text is reported once.
    found.sort(key=lambda f: (f[0], f[1], -f[2]))
    hits: list[Hit] = []
    seen: set[str] = set()
    last = (-1, -1)
    for i, s, e in found:
        if (i, s) < last:
            continue
        last = (i, e)
        h = content.hit(rule, (i, s, e), f"is a banned phrase. {rule.text}", "Remove it, or say it in a way that does not promise a result.")
        if h.flagged_text.casefold() not in seen:
            seen.add(h.flagged_text.casefold())
            hits.append(h)
    return hits


def check_phrase_required(rule: RuleSpec, content: Content, lib: Library, product: str, states: Sequence[str]) -> list[Hit]:
    """The content must contain at least one of the phrases."""
    phrases = strings(rule.check, "phrases")
    if any((p := phrase_pattern(x)) and content.contains(p) for x in phrases):
        return []
    listed = ", ".join(f'"{p}"' for p in phrases)
    return [Hit(rule.id, rule.severity, "", f"The content must contain one of these: {listed}. {rule.text}")]


def check_required_disclosure(rule: RuleSpec, content: Content, lib: Library, product: str, states: Sequence[str]) -> list[Hit]:
    hit = missing_disclosure(rule, content, disclosure_of(rule, lib, product, states))
    return [hit] if hit else []


def check_trigger_terms(rule: RuleSpec, content: Content, lib: Library, product: str, states: Sequence[str]) -> list[Hit]:
    """Reg Z: a trigger term needs its disclosure. One finding, at the first trigger term in the content."""
    found: list[tuple[int, int, int]] = []
    for term in strings(rule.check, "terms"):
        if pattern := phrase_pattern(term):
            found += content.find(pattern)
    if not found:
        return []
    d = disclosure_of(rule, lib, product, states)
    hit = missing_disclosure(rule, content, d)
    if hit is None or hit.field is not None:  # present, or an old wording (quoted)
        return [hit] if hit else []
    first = min(found)
    return [content.hit(rule, first, f'is a trigger term. The content must also include disclosure {d.id} "{d.title}". {rule.text}', add_text(d))]


# Rates in normalised text. A percent counts as a rate only when it is labeled: "8.99% APR", "0% intro APR",
# "APR as low as 8.99%", "rates from 8.99% to 24.99%". Other percents (a 3% fee, 80% loan-to-value) are not rates.
_NUM = r"\d{1,3}(?:\.\d+)?"
_RANGE = rf"(?P<a>{_NUM}) ?%(?: ?(?:to|-) ?(?P<b>{_NUM}) ?%)?"
_KIND = r"(?P<k>apr|apy|annual percentage rate|annual percentage yield)"
_LEAD = r"(?: (?:of|as low as|from|starting at|is|at|up to|for|only))* ?[:=]? ?"
RATE_PATTERNS = [
    re.compile(rf"(?<![\w.]){_RANGE}(?: [a-z]+){{0,2}} ?{_KIND}(?!\w)"),
    re.compile(rf"(?<!\w){_KIND}s?{_LEAD}{_RANGE}"),
    re.compile(rf"(?<!\w)(?:interest )?rates?{_LEAD}{_RANGE}"),
]
KINDS = {"apr": "apr", "annual percentage rate": "apr", "apy": "apy", "annual percentage yield": "apy"}
PRODUCT_NAMES = {
    "personal_loan": "personal loans",
    "credit_card": "credit cards",
    "mortgage": "mortgages",
    "heloc": "home equity lines",
    "auto_loan": "auto loans",
    "savings": "savings",
}


def rates_in(content: Content, default_kind: str) -> list[tuple[int, int, int, Decimal, str]]:
    """Each labeled rate as (field, raw start, raw end, percent, kind). The quote is the number and its % sign."""
    result = []
    for i, t in enumerate(content.texts):
        spans: dict[tuple[int, int], str] = {}
        for pattern in RATE_PATTERNS:  # earlier patterns know the kind, so they win
            for m in pattern.finditer(t.norm):
                kind = KINDS[m["k"]] if "k" in m.groupdict() and m["k"] else default_kind
                for g in ("a", "b"):
                    if m[g] is not None:
                        end = t.norm.index("%", m.end(g)) + 1
                        spans.setdefault((m.start(g), end), kind)
        for (s, e), kind in sorted(spans.items()):
            rs, re_ = t.quote(s, e)
            try:
                result.append((i, rs, re_, Decimal(t.norm[s:e].rstrip("% ")), kind))
            except InvalidOperation:
                continue
    return result


def pct(fraction: float) -> Decimal:
    return Decimal(f"{fraction * 100:.4f}")


def fmt(p: Decimal) -> str:
    return f"{p.normalize():f}%"


def check_rate_sheet(rule: RuleSpec, content: Content, lib: Library, product: str, states: Sequence[str]) -> list[Hit]:
    """Every rate is inside a range on the current rate sheet for the product (F8). Edges count as inside."""
    if lib.rates is None:
        raise ConfigError("the workspace has no rate sheet")
    hits: list[Hit] = []
    seen: set[str] = set()
    for i, s, e, value, kind in rates_in(content, "apy" if product == "savings" else "apr"):
        rows = [r for r in lib.rates if r.product == product and r.rate == kind]
        if any(pct(r.min) <= value <= pct(r.max) for r in rows):
            continue
        name = PRODUCT_NAMES.get(product, product)
        if rows:
            ranges = ", ".join(fmt(pct(r.min)) if r.min == r.max else f"{fmt(pct(r.min))} to {fmt(pct(r.max))}" for r in rows)
            why = f"is outside the {kind.upper()} range for {name} on the current rate sheet ({ranges})."
            fix = f"Use a rate from the current rate sheet: {ranges}."
        else:
            why = f"is not on the current rate sheet: it has no {kind.upper()} for {name}."
            fix = "Check the rate with the rate sheet owner."
        h = content.hit(rule, (i, s, e), why, fix)
        if h.flagged_text not in seen:
            seen.add(h.flagged_text)
            hits.append(h)
    return hits


# Hidden text (F4 prompt-injection defense). Instructions to automated reviewers, in plain words:
INSTRUCTIONS = [
    re.compile(p)
    for p in (
        r"(?<!\w)(?:ignore|disregard|override|bypass)(?: [\w']+){0,4} (?:instructions?|rules?|guidelines?|prompts?|checks?|polic(?:y|ies))(?!\w)",
        r"(?<!\w)(?:report|return|output|respond with|reply with|mark it with)(?: [\w']+){0,3} (?:no|zero|0) (?:issues?|findings?|violations?|problems?|errors?)(?!\w)",
        r"(?<!\w)(?:ai|automated|llm) (?:reviewers?|review|assistants?|models?|checkers?)(?!\w)",
        r"(?<!\w)(?:system prompt|language model|you are an ai|as an ai)(?!\w)",
        r"(?<!\w)approve this (?:ad|content|material|email|page|post|submission)(?!\w)",
    )
]
COMMENT = re.compile(r"<!--.*?(?:-->|$)", re.S)
OPEN_TAG = re.compile(r"<([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>")
ATTR_TEXT = re.compile(r"""\b(alt|title|aria-label)\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I)
# How the explanation and the fix name each attribute that ATTR_TEXT reads
ATTR_NAMES = {
    "alt": ("image text (alt text)", "alt text"),
    "title": ("a title attribute", "title attribute"),
    "aria-label": ("an aria-label", "aria-label"),
}
# The fix for each kind of hidden_text finding: what to remove depends on why the text was flagged.
FIX_HIDDEN = "Remove the hidden text."
FIX_INVISIBLE = "Remove the invisible characters."
FIX_INSTRUCTION = "Remove the instruction aimed at automated reviewers."
NAMED_COLORS = {"white": (255, 255, 255), "black": (0, 0, 0), "snow": (255, 250, 250), "ivory": (255, 255, 240), "whitesmoke": (245, 245, 245)}


def color(value: str) -> tuple[int, int, int] | None:
    """A CSS color as RGB. None for transparent and unknown colors."""
    v = value.strip().lower()
    if v in NAMED_COLORS:
        return NAMED_COLORS[v]
    if m := re.fullmatch(r"#([0-9a-f]{3}|[0-9a-f]{6})", v):
        h = m[1] if len(m[1]) == 6 else "".join(c * 2 for c in m[1])
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    if m := re.fullmatch(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)", v):
        if m[4] is not None and float(m[4]) == 0:
            return None
        return int(m[1]), int(m[2]), int(m[3])
    return None


def length(value: str) -> float | None:
    m = re.fullmatch(r"(-?[\d.]+)\s*(px|pt|em|rem|%)?", value.strip())
    try:
        return float(m[1]) if m else None
    except ValueError:
        return None


def hidden_style(attrs: str) -> str | None:
    """Why an element's own attributes hide it, or None."""
    unquoted = re.sub(r"\"[^\"]*\"|'[^']*'", '""', attrs)
    if re.search(r"(?:^|\s)hidden(?=[\s=/]|$)", unquoted, re.I):
        return "has the hidden attribute"
    style = re.search(r"""\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')""", attrs, re.I)
    css: dict[str, str] = {}
    for decl in (style[1] or style[2] or "").split(";") if style else []:
        prop, _, value = decl.partition(":")
        css[prop.strip().lower()] = value.replace("!important", "").strip().lower()
    if m := re.search(r"""(?<![\w-])color\s*=\s*["']?([^"'\s>]+)""", attrs, re.I):  # <font color="white">
        css.setdefault("color", m[1].lower())
    if css.get("display") == "none" or css.get("visibility") in ("hidden", "collapse"):
        return "is hidden with CSS"
    opacity = length(css.get("opacity", "1"))
    if opacity is not None and opacity <= 0.05:
        return "is transparent"
    size = length(css.get("font-size", "")) if "font-size" in css else None
    if size is not None and size <= 1:
        return "has a zero font size"
    for prop in ("text-indent", "left", "top", "margin-left"):
        offset = length(css.get(prop, "")) if prop in css else None
        if offset is not None and offset <= -999:
            return "is moved off the screen"
    if "color" in css:
        if css["color"] == "transparent" or (css["color"].startswith("rgba") and color(css["color"]) is None):
            return "is transparent"
        fg = color(css["color"])
        background = css.get("background-color") or css.get("background", "").split(" ")[0] or "white"
        bg = color(background)
        if fg and bg and max(abs(a - b) for a, b in zip(fg, bg, strict=True)) <= 24:
            return "is the same color as its background"
    return None


def word_span(raw: str, s: int, e: int) -> tuple[int, int]:
    """Widen a span to the whole words around it."""
    while s > 0 and not raw[s - 1].isspace():
        s -= 1
    while e < len(raw) and not raw[e].isspace():
        e += 1
    return s, e


def sentence_span(raw: str, s: int, e: int) -> tuple[int, int]:
    """Widen a span to the sentence around it."""
    while s > 0 and raw[s - 1] not in ".!?\n>":
        s -= 1
    while s < e and raw[s].isspace():
        s += 1
    while e < len(raw) and raw[e - 1] not in ".!?\n" and raw[e] != "<":
        e += 1
    return s, e


def codes(text: str) -> str:
    return ", ".join(sorted({f"U+{ord(c):04X}" for c in text if invisible(c)}))


def check_hidden_text(rule: RuleSpec, content: Content, lib: Library, product: str, states: Sequence[str]) -> list[Hit]:
    """Invisible characters, HTML comments, hidden elements (white on white, zero size, display none),
    alt text with instructions, and plain instructions to automated reviewers."""
    hits: list[Hit] = []
    for i, (_, raw) in enumerate(content.fields):
        spans: list[tuple[int, int, str, str]] = []  # (start, end, explanation, suggestion)
        markup = bool(MARKUP.search(raw))
        if markup:
            spans += [
                (m.start(), m.end(), "is an HTML comment. Readers do not see it, but automated tools read it.", FIX_HIDDEN)
                for m in COMMENT.finditer(raw)
            ]
            for m in OPEN_TAG.finditer(raw):
                # Only a tag that hides its text looks for its closing tag, so long markup stays fast.
                if not (why := hidden_style(m[2])):
                    continue
                close = re.compile(rf"</{m[1]}\s*>", re.I).search(raw, m.end())
                if close and raw[m.end() : close.start()].strip():
                    spans.append((m.start(), close.end(), f"is hidden text: it {why}. Readers do not see it, but automated tools read it.", FIX_HIDDEN))
            for m in ATTR_TEXT.finditer(raw):
                g = 2 if m[2] is not None else 3
                if any(p.search(norm(m[g])) for p in INSTRUCTIONS):
                    what, where = ATTR_NAMES[m[1].lower()]
                    why = f"is {what} that gives instructions to automated reviewers."
                    spans.append((m.start(g), m.end(g), why, f"Remove the instruction from the {where}."))
        # Invisible characters, as whole words. Words next to each other become one quote.
        words: list[tuple[int, int]] = []
        for m in re.finditer(r"\S+", raw):
            if any(suspicious(raw, m.start() + k) for k in range(len(m[0]))):
                if words and raw[words[-1][1] : m.start()].isspace():
                    words[-1] = (words[-1][0], m.end())
                else:
                    words.append((m.start(), m.end()))
        for s, e in words:
            spans.append((s, e, f"has invisible characters ({codes(raw[s:e])}). They can hide words from readers and from checks.", FIX_INVISIBLE))
        # Plain instructions to automated reviewers, quoted as the whole sentence.
        t = content.texts[i]
        why = "gives instructions to automated reviewers. Marketing content must not do this."
        for p in INSTRUCTIONS:
            for m in p.finditer(t.norm):
                spans.append((*sentence_span(raw, *t.quote(m.start(), m.end())), why, FIX_INSTRUCTION))
        # The first span wins where two overlap, in the order above.
        kept: list[tuple[int, int, str, str]] = []
        for s, e, why, fix in spans:
            if e > s and all(e <= ks or s >= ke for ks, ke, _, _ in kept):
                kept.append((s, e, why, fix))
        hits += [content.hit(rule, (i, s, e), why, fix) for s, e, why, fix in sorted(kept)]
    return hits


def suspicious(raw: str, k: int) -> bool:
    """An invisible character that can hide something. Emoji use a zero-width joiner and variation
    selectors, so those count only next to a letter or digit."""
    c = raw[k]
    if not invisible(c):
        return False
    if c == "\u200d":
        return 0 < k < len(raw) - 1 and raw[k - 1].isalnum() and raw[k + 1].isalnum()
    if "\ufe00" <= c <= "\ufe0f":
        return k > 0 and raw[k - 1].isalnum()
    return True


CHECKS: dict[str, Check] = {
    "phrase_banned": check_phrase_banned,
    "phrase_required": check_phrase_required,
    "required_disclosure": check_required_disclosure,
    "trigger_terms": check_trigger_terms,
    "rate_sheet": check_rate_sheet,
    "hidden_text": check_hidden_text,
}


@dataclass
class RuleResult:
    rule: RuleSpec
    hits: list[Hit]


def check_content(
    lib: Library,
    product: str,
    channel: str,
    states: Sequence[str],
    fields: list[tuple[str, str]],
    end_date: date | None = None,
) -> list[RuleResult]:
    """Runs every applicable code rule on the fields. A rule that cannot run is logged and skipped,
    so a bad rule never fails a submission."""
    content = Content(fields)
    results = []
    for rule in lib.rules:
        if not applies(rule, product, channel, states, end_date):
            continue
        check = CHECKS.get(str(rule.check.get("type")))
        try:
            if check is None:
                raise ConfigError(f"unknown code check {rule.check.get('type')!r}")
            results.append(RuleResult(rule, check(rule, content, lib, product, states)))
        except ConfigError as e:
            log.warning("Pre-review skipped rule %s: %s", rule.id, e)
        except Exception:
            log.exception("Pre-review skipped rule %s", rule.id)
    return results


# ---- Running on a version (database) ----


async def load_library(db: AsyncSession, workspace_id: uuid.UUID, on: date) -> Library:
    """The code rules, the disclosures with their older wordings, and the rate sheet in effect on `on`
    (the launch date, or today): the newest sheet that takes effect by then, else the newest sheet."""
    rules = await db.scalars(
        select(Rule).where(Rule.workspace_id == workspace_id, Rule.layer == CheckLayer.CODE).order_by(Rule.id)
    )
    disclosures = await db.scalars(
        select(Disclosure).where(Disclosure.workspace_id == workspace_id).options(selectinload(Disclosure.versions))
    )
    sheets = list(
        await db.scalars(
            select(RateSheet)
            .where(RateSheet.workspace_id == workspace_id)
            .options(selectinload(RateSheet.rows))
            .order_by(RateSheet.effective_date.desc(), RateSheet.uploaded_at.desc())
        )
    )
    sheet = sheet_on(sheets, on)
    workspace = await db.get_one(Workspace, workspace_id)
    return Library(
        rules=[rule_spec(r) for r in rules],
        disclosures={d.id: disclosure_spec(d) for d in disclosures},
        rates=rate_ranges(sheet) if sheet else None,
        licensed_states=list(workspace.licensed_states),
    )


def sheet_on(sheets: Sequence[RateSheet], on: date) -> RateSheet | None:
    """The sheet in effect on a day, from sheets newest first: the newest that takes effect by then, else the newest."""
    return next((s for s in sheets if s.effective_date <= on), sheets[0] if sheets else None)


def rate_ranges(sheet: RateSheet) -> list[RateRange]:
    """Needs sheet.rows loaded."""
    return [RateRange(r.product, r.rate.value, r.min, r.max) for r in sheet.rows]


def rule_spec(r: Rule) -> RuleSpec:
    return RuleSpec(
        id=r.id,
        title=r.title,
        text=r.text,
        severity=r.severity.value,
        layer=r.layer.value,
        jurisdiction=r.jurisdiction,
        products=r.products,
        channels=r.channels,
        check=r.check if isinstance(r.check, dict) else {},
        effective_date=r.effective_date,
    )


def disclosure_spec(d: Disclosure) -> DisclosureSpec:
    """Needs d.versions loaded."""
    return DisclosureSpec(
        id=d.id,
        title=d.title,
        version=d.version,
        text=d.text,
        products=d.products,
        states=d.states,
        old=[(v.version, v.text) for v in d.versions if v.version != d.version],
    )


def plain_text(f: dict[str, Any]) -> str:
    return "".join(s if isinstance(s, str) else s["text"] for s in f.get("segments", []))


def iso_date(value: Any) -> date | None:
    try:
        return date.fromisoformat(value) if value else None
    except (TypeError, ValueError):
        return None


def locate(texts: list[str], quote: str) -> tuple[int, int, int] | None:
    """Where an existing finding's quote is in the new content: exactly, or else after normalising."""
    if not quote:
        return None
    for i, t in enumerate(texts):
        if (s := t.find(quote)) >= 0:
            return i, s, s + len(quote)
    pattern = literal_pattern(quote)
    if pattern is None:
        return None
    for i, t in enumerate(texts):
        n = normalise(t)
        if m := pattern.search(n.norm):
            return i, *n.quote(m.start(), m.end())
    return None


def marked(fields: list[dict[str, Any]], marks: list[tuple[int, int, int, str]]) -> list[dict[str, Any]]:
    """The fields with segments that point to findings: {text, finding}. Overlapping marks keep the first."""
    out = []
    for i, f in enumerate(fields):
        text = plain_text(f)
        segments: list[Any] = []
        pos = 0
        for _, s, e, fid in sorted(m for m in marks if m[0] == i):
            if s < pos or e <= s:
                continue
            if s > pos:
                segments.append(text[pos:s])
            segments.append({"text": text[s:e], "finding": fid})
            pos = e
        if pos < len(text) or not segments:
            segments.append(text[pos:])
        out.append({**f, "segments": segments})
    return out


async def run(db: AsyncSession, m: Material, version: MaterialVersion) -> None:
    """Runs the code checks on a newly stored version (PRD F4 layer 1), in the caller's transaction.

    - New findings: source code, the rule's severity, status open, on this version, in content order.
    - The material's earlier open findings: a code finding that the checks find again moves to this version
      (same id); one they no longer find is Outdated. An AI finding moves to this version while its quote
      is still in the content, and is Outdated when the quote is gone (PRD F4: a finding becomes Outdated
      when its flagged text changes).
    - Fills the version's checklist and finding marks, and adds a "Rule check" entry to the history.
    TODO (F4 layer 2): the AI review runs after this, for the AI rules on the checklist.
    TODO (F6): a High code finding should move the item to Changes requested automatically.
    """
    texts = [plain_text(f) for f in version.fields]
    today = now().date()
    launch = iso_date(version.details.get("launchDate"))
    lib = await load_library(db, m.workspace_id, max(launch, today) if launch else today)
    states = target_states(version.details, lib.licensed_states)
    results = check_content(
        lib,
        m.product.value,
        m.channel.value,
        states,
        [(str(f.get("label", "")), t) for f, t in zip(version.fields, texts, strict=True)],
        iso_date(version.details.get("endDate")),
    )

    earlier = list(
        await db.scalars(select(Finding).where(Finding.material_id == m.id, Finding.status == FindingStatus.OPEN))
    )
    old_code: dict[tuple[str, str], Finding] = {}
    for f in earlier:
        if f.source is FindingSource.CODE:
            old_code.setdefault((f.rule_id, f.flagged_text), f)
    reused: set[uuid.UUID] = set()
    current: list[tuple[tuple[int, int], Finding, tuple[int, int, int] | None]] = []  # (order, finding, mark)
    checklist = []
    for r in results:
        first: str | None = None
        for h in r.hits:
            f = old_code.pop((h.rule_id, h.flagged_text), None) or Finding(
                id=uuid.uuid7(),
                workspace_id=m.workspace_id,
                material_id=m.id,
                source=FindingSource.CODE,
                rule_id=h.rule_id,
                flagged_text=h.flagged_text,
            )
            reused.add(f.id)
            f.version_id = version.id
            f.status = FindingStatus.OPEN
            f.severity = Severity(h.severity)  # from the rule, never computed (PRD F4)
            f.explanation = h.explanation
            f.suggestion = h.suggestion
            db.add(f)
            where = (h.field, h.start, h.end) if h.field is not None else None
            current.append(((h.field, h.start) if h.field is not None else (len(texts), 0), f, where))
            first = first or str(f.id)
        row: dict[str, Any] = {"ruleId": r.rule.id, "title": r.rule.title, "layer": "code", "result": "fail" if r.hits else "pass"}
        if first:
            row["finding"] = first
        checklist.append(row)

    outdated = [f for f in earlier if f.source is FindingSource.CODE and f.id not in reused]
    for f in earlier:
        if f.source is FindingSource.CODE:
            continue
        found = locate(texts, f.flagged_text)
        if f.flagged_text and found is None:
            outdated.append(f)
            continue
        f.version_id = version.id
        current.append(((found[0], found[1]) if found else (len(texts), 0), f, found))
    for f in outdated:
        f.status = FindingStatus.OUTDATED

    current.sort(key=lambda c: c[0])
    for position, (_, f, _) in enumerate(current):
        f.position = position
    version.fields = marked(version.fields, [(*w, str(f.id)) for _, f, w in current if w])
    # TODO (F4 layer 2): the AI rules join the checklist when the AI review exists.
    version.checklist = checklist

    problems = [f for _, f, _ in current if f.source is FindingSource.CODE]
    per_rule = Counter(f.rule_id for f in problems)  # in the order of the findings
    ids = list(per_rule)
    # Each rule once, with its count when it has more than one finding, so the list adds up to the number.
    listed = ", ".join(rule_id if n == 1 else f"{rule_id} ×{n}" for rule_id, n in per_rule.items())
    text = f"Code checks found {len(problems)} problem{'s' if len(problems) != 1 else ''}: {listed}." if problems else "Code checks passed."
    if outdated:
        text += f" Marked {len(outdated)} finding{'s' if len(outdated) != 1 else ''} outdated."
    data = {"version": version.number, "problems": len(problems), "rules": ids, "outdated": len(outdated), "text": text}
    record(db, OtherActor(m.workspace_id, AUTHOR), "material", m.id, "prereviewed", data)  # PRD F2, F4


# ---- Re-run after a library change ----

router = APIRouter(prefix="/api/materials", tags=["materials"])


@router.post("/{material_id}/prereview")
async def rerun(material_id: uuid.UUID, viewer: Reviewer, db: Db) -> dict[str, Any]:
    """Runs the code checks again on the current version, for example after a rule or the rate sheet changed.
    Only while the version waits for review: approved materials get a flag for re-review instead (app.flags, F7).
    Returns the material detail."""
    from app.materials import saved_detail  # here, because materials.py imports this module

    m = await db.scalar(
        select(Material).where(Material.id == material_id, *visible(viewer)).options(selectinload(Material.versions))
    )
    if m is None:
        raise not_found("Material not found")
    if not m.versions:
        raise conflict("This material has no version to check")
    if m.status not in (MaterialStatus.SUBMITTED, MaterialStatus.IN_REVIEW):
        raise conflict("Only a version that waits for review can be checked again")
    await run(db, m, m.versions[-1])
    detail = await saved_detail(db, viewer, m.id)
    return detail.model_dump(mode="json", by_alias=True, exclude_none=True) if detail else {}
