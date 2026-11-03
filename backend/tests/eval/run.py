"""Evaluation of pre-review against the golden dataset (PRD F4).

Run from backend/: `uv run python -m tests.eval.run`. It needs no database: the checks run on the seeded
demo library (src/app/seed/data). It reports precision and recall for code checks alone. The AI reviewer
(layer 2) does not exist yet, so the cases that need judgment are listed as expected misses.

A finding matches an answer-key entry when the rule ID is the same and the texts overlap (one contains
the other). An entry with empty text (something missing) matches a finding with empty text.
"""

import json
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import app
from app.prereview import DisclosureSpec, Hit, Library, RateRange, RuleSpec, check_content, target_states

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


def main() -> None:
    cases = load(HERE / "materials.json")["cases"]
    r = evaluate()
    clean = sum(1 for c in cases if not load(HERE / "answer-key.json")["cases"][c["id"]])
    print(f"Evaluation set: {len(cases)} materials ({clean} clean), answer key in {HERE / 'answer-key.json'}")
    print()
    print(f"{'':28}{'precision':>10}{'recall':>10}")
    print(f"{'Code checks (their cases)':28}{r.precision:>10.0%}{r.recall:>10.0%}")
    print(f"{'Code checks (all cases)':28}{r.precision:>10.0%}{r.recall_all:>10.0%}")
    print(f"{'Code checks + AI':28}not built yet (F4 layer 2)")
    for name, rows in (("False alarms", r.false_positives), ("Missed by code checks", r.missed)):
        if rows:
            print(f"\n{name}:")
            for case_id, x in rows:
                print(f"  {case_id}: {x}")
    print("\nExpected misses (AI-only, layer 2):")
    for case_id, e in r.ai_only:
        print(f"  {case_id}: {e['ruleId']} {e['text']!r}")


if __name__ == "__main__":
    main()
