"""Evaluation of pre-review against the golden dataset (PRD F4).

Run from backend/: `uv run python -m tests.eval.run`. It needs no database: the checks run on the seeded
demo library (src/app/seed/data). It reports precision and recall for code checks alone, and, when
ANTHROPIC_API_KEY is set, for code checks plus the AI reviewer (layer 2, app.ai_review) side by side.
Without a key the AI part is skipped and the cases that need judgment are listed as expected misses.
The AI part calls the real API once per material. Targets (PRD F4): recall >= 90%, precision >= 80%.
The AI gets the same other inputs as in the app (app.ai_review.Context): the rate sheet rows for the product
and the disclosures that apply, from the seed, and the case's earlier version with its reviewer comments.

A finding matches an answer-key entry when the rule ID is the same and the texts overlap (one contains
the other). An entry with empty text (something missing) matches a finding with empty text.
"""

import asyncio
import json
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import app
from app import ai_review
from app.ai_review import AIHit, Client, Context, Earlier, Offer, ReviewerComment, disclosures_for, offers_for, review_content
from app.config import settings
from app.prereview import DisclosureSpec, Hit, Library, RateRange, RuleSpec, check_content, in_scope, target_states

HERE = Path(__file__).parent
SEED = Path(app.__file__).parent / "seed" / "data"


def load(path: Path) -> dict:
    return json.loads(path.read_text())


def seed_library() -> Library:
    """The demo library as the seed creates it: current rule and disclosure versions, the newest rate sheet."""
    rules = [
        RuleSpec(
            id=r["id"],
            title=r["title"],
            text=r["text"],
            severity=r["severity"],
            layer=r["layer"],
            jurisdiction=r["jurisdiction"],
            products=r["products"],
            channels=r["channels"],
            check=r["check"],
            effective_date=date.fromisoformat(r["effectiveDate"]),
        )
        for r in load(SEED / "rules.json")["rules"]
    ]
    disclosures = {
        d["id"]: DisclosureSpec(
            id=d["id"],
            title=d["title"],
            version=d["version"],
            text=d["text"],
            products=d["products"],
            states=None if d["states"] == "all" else d["states"],
            old=[(v["version"], v["text"]) for v in d["versions"] if v["version"] != d["version"]],
        )
        for d in load(SEED / "disclosures.json")["disclosures"]
    }
    sheet = load(SEED / "rate-sheet.json")["sheets"][0]  # newest first
    rates = [RateRange(r["product"], r["rate"], r["min"], r["max"]) for r in sheet["rows"]]
    licensed = load(SEED / "workspace.json")["workspace"]["licensedStates"]
    return Library(rules, disclosures, rates, licensed)


def seed_sheet() -> tuple[date, list[Offer]]:
    """The newest seeded rate sheet, with every row (offer text and fees too)."""
    sheet = load(SEED / "rate-sheet.json")["sheets"][0]
    rows = [Offer(r["key"], r["product"], r["offer"], r["rate"], r["min"], r["max"], r["fees"]) for r in sheet["rows"]]
    return date.fromisoformat(sheet["effectiveDate"]), rows


def context_of(case: dict, lib: Library, states: list[str]) -> Context:
    """The other AI inputs for a case, as app.ai_review.load_context builds them for a version."""
    sheet_date, rows = seed_sheet()
    e = case.get("earlier")
    earlier = (
        Earlier(
            number=e["number"],
            fields=[(f["label"], f["text"]) for f in e["fields"]],
            comments=[ReviewerComment(c["role"], c["body"], c.get("decision")) for c in e.get("comments", [])],
        )
        if e
        else None
    )
    return Context(
        sheet_date=sheet_date,
        offers=offers_for(rows, case["product"]),
        disclosures=disclosures_for(lib.disclosures.values(), case["product"], states),
        earlier=earlier,
    )


def overlaps(a: str, b: str) -> bool:
    if not a or not b:
        return a == b
    return a in b or b in a


@dataclass
class Report:
    true_positives: int = 0  # findings that match an entry
    true_positives_code: int = 0  # code-layer entries that a finding matches
    false_positives: list[tuple[str, Hit]] = field(default_factory=list)
    missed: list[tuple[str, dict]] = field(default_factory=list)  # code-layer entries the checks missed
    ai_only: list[tuple[str, dict]] = field(default_factory=list)  # expected misses for code checks
    ai_caught: list[tuple[str, dict]] = field(default_factory=list)  # AI entries the code checks found anyway

    @property
    def found(self) -> int:
        return self.true_positives + len(self.false_positives)

    @property
    def precision(self) -> float:
        return self.true_positives / self.found if self.found else 1.0

    @property
    def code_entries(self) -> int:
        return self.true_positives_code + len(self.missed)

    @property
    def recall(self) -> float:
        """Recall on the entries that code checks are responsible for."""
        return self.true_positives_code / self.code_entries if self.code_entries else 1.0

    @property
    def recall_all(self) -> float:
        """Recall on every entry, AI ones too: what code checks alone reach today."""
        total = self.code_entries + len(self.ai_only) + len(self.ai_caught)
        return (self.true_positives_code + len(self.ai_caught)) / total if total else 1.0


def evaluate() -> Report:
    lib = seed_library()
    key = load(HERE / "answer-key.json")["cases"]
    report = Report()
    for case in load(HERE / "materials.json")["cases"]:
        states = target_states({"targetStates": case["targetStates"]}, lib.licensed_states)
        fields = [(f["label"], f["text"]) for f in case["fields"]]
        hits = [h for r in check_content(lib, case["product"], case["channel"], states, fields) for h in r.hits]
        entries = key[case["id"]]
        matched: set[int] = set()
        for h in hits:
            i = next(
                (i for i, e in enumerate(entries) if i not in matched and e["ruleId"] == h.rule_id and overlaps(e["text"], h.flagged_text)),
                None,
            )
            if i is None:
                report.false_positives.append((case["id"], h))
            else:
                matched.add(i)
                report.true_positives += 1
        for i, e in enumerate(entries):
            if e["layer"] == "code":
                if i in matched:
                    report.true_positives_code += 1
                else:
                    report.missed.append((case["id"], e))
            elif i in matched:
                report.ai_caught.append((case["id"], e))
            else:
                report.ai_only.append((case["id"], e))
    return report


@dataclass
class AIReport:
    """Code checks plus the AI reviewer, on every entry. An AI finding counts as correct when it matches an
    entry (same rule ID, overlapping text) that the code checks did not already match (PRD F4)."""

    true_positives: int = 0  # all findings, code and AI, that match an entry
    findings: int = 0  # all findings, code and AI
    entries: int = 0
    matched: int = 0  # entries that a finding matches
    ai_true_positives: int = 0
    ai_findings: int = 0
    ai_entries: int = 0  # entries for layer "ai"
    ai_entries_matched: int = 0
    false_positives: list[tuple[str, AIHit]] = field(default_factory=list)  # AI findings with no entry
    missed: list[tuple[str, dict]] = field(default_factory=list)  # entries nothing matched
    not_run: list[tuple[str, str]] = field(default_factory=list)  # (case, reason)
    rejected: int = 0  # AI findings dropped by the guardrails

    @property
    def precision(self) -> float:
        return self.true_positives / self.findings if self.findings else 1.0

    @property
    def recall(self) -> float:
        return self.matched / self.entries if self.entries else 1.0

    @property
    def ai_precision(self) -> float:
        return self.ai_true_positives / self.ai_findings if self.ai_findings else 1.0

    @property
    def ai_recall(self) -> float:
        """Recall on the entries that only the AI is responsible for."""
        return self.ai_entries_matched / self.ai_entries if self.ai_entries else 1.0


def match(entries: list[dict], matched: set[int], rule_id: str, text: str) -> int | None:
    """The first entry not yet matched with the same rule and overlapping text."""
    return next(
        (i for i, e in enumerate(entries) if i not in matched and e["ruleId"] == rule_id and overlaps(e["text"], text)),
        None,
    )


async def evaluate_ai(client: Client, concurrency: int = 5) -> AIReport:
    """Runs the code checks and the AI review on every case, as app.ai_review does on a submitted version."""
    lib = seed_library()
    ai_rules = [r for r in lib.rules if r.layer == "ai"]
    key = load(HERE / "answer-key.json")["cases"]
    cases = load(HERE / "materials.json")["cases"]
    gate = asyncio.Semaphore(concurrency)

    async def one(case: dict):
        states = target_states({"targetStates": case["targetStates"]}, lib.licensed_states)
        fields = [(f["label"], f["text"]) for f in case["fields"]]
        hits = [h for r in check_content(lib, case["product"], case["channel"], states, fields) for h in r.hits]
        checklist = [r for r in ai_rules if in_scope(r, case["product"], case["channel"], states)]
        metadata = {"Product": case["product"], "Channel": case["channel"], "Target states": case["targetStates"]}
        async with gate:
            outcome = await review_content(
                client,
                ai_rules,
                checklist,
                fields,
                metadata,
                [(h.rule_id, h.field, h.start, h.end) for h in hits],
                context_of(case, lib, states),
            )
        return case, hits, outcome

    report = AIReport()
    for case, hits, outcome in await asyncio.gather(*(one(c) for c in cases)):
        entries = key[case["id"]]
        report.entries += len(entries)
        report.ai_entries += sum(1 for e in entries if e["layer"] == "ai")
        if not outcome.ran:
            report.not_run.append((case["id"], outcome.reason or ""))
        report.rejected += outcome.rejected
        matched: set[int] = set()
        for h in hits:
            report.findings += 1
            if (i := match(entries, matched, h.rule_id, h.flagged_text)) is not None:
                matched.add(i)
                report.true_positives += 1
        for a in outcome.hits:
            report.findings += 1
            report.ai_findings += 1
            if (i := match(entries, matched, a.rule_id, a.flagged_text)) is not None:
                matched.add(i)
                report.true_positives += 1
                report.ai_true_positives += 1
                report.ai_entries_matched += entries[i]["layer"] == "ai"
            else:
                report.false_positives.append((case["id"], a))
        report.matched += len(matched)
        report.missed += [(case["id"], e) for i, e in enumerate(entries) if i not in matched]
    return report


def main() -> None:
    cases = load(HERE / "materials.json")["cases"]
    r = evaluate()
    clean = sum(1 for c in cases if not load(HERE / "answer-key.json")["cases"][c["id"]])
    print(f"Evaluation set: {len(cases)} materials ({clean} clean), answer key in {HERE / 'answer-key.json'}")
    print()
    print(f"{'':28}{'precision':>10}{'recall':>10}")
    print(f"{'Code checks (their cases)':28}{r.precision:>10.0%}{r.recall:>10.0%}")
    print(f"{'Code checks (all cases)':28}{r.precision:>10.0%}{r.recall_all:>10.0%}")
    client = ai_review.get_client()
    ai = asyncio.run(evaluate_ai(client)) if client is not None else None
    if ai is not None:
        print(f"{'Code checks + AI (all)':28}{ai.precision:>10.0%}{ai.recall:>10.0%}")
        print(f"{'AI reviewer alone':28}{ai.ai_precision:>10.0%}{ai.ai_recall:>10.0%}   (its findings; recall on AI-only cases)")
    else:
        print(f"{'Code checks + AI':28}skipped: set ANTHROPIC_API_KEY to run the AI reviewer")
    for name, rows in (("False alarms", r.false_positives), ("Missed by code checks", r.missed)):
        if rows:
            print(f"\n{name}:")
            for case_id, x in rows:
                print(f"  {case_id}: {x}")
    if ai is None:
        print("\nExpected misses (AI-only, layer 2):")
        for case_id, e in r.ai_only:
            print(f"  {case_id}: {e['ruleId']} {e['text']!r}")
        return
    print(f"\nAI model {settings.ai_review_model}; findings dropped by the guardrails: {ai.rejected}")
    for name, rows in (
        ("AI did not run", ai.not_run),
        ("AI false alarms", [(c, f"{h.rule_id} {h.flagged_text!r}") for c, h in ai.false_positives]),
        ("Missed by code checks + AI", [(c, f"{e['ruleId']} {e['text']!r}") for c, e in ai.missed]),
    ):
        if rows:
            print(f"\n{name}:")
            for case_id, x in rows:
                print(f"  {case_id}: {x}")
    passed = ai.recall >= 0.9 and ai.precision >= 0.8 and not ai.not_run
    print(f"\nTargets (recall >= 90%, precision >= 80%): {'met' if passed else 'NOT met'}")
    if not passed:
        sys.exit(1)


if __name__ == "__main__":
    main()
