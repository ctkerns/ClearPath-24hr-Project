"""The golden dataset (PRD F4) as a test: code checks find every violation they are responsible for,
with no false alarms. The AI-only cases are expected misses for the code checks; the AI reviewer (layer 2)
is measured with a real key by `python -m tests.eval.run`."""

from tests.eval.run import HERE, evaluate, load

AI_ONLY = {
    ("ai-implied-approval", "UDAAP-03"),
    ("ai-fair-lending", "FAIR-01"),
    ("ai-credit-score", "FCRA-02"),
    ("ai-california-lowest-rate", "CA-FIN-22161"),
    ("ai-subtle-injection", "INJ-00"),
    ("offer-cash-bonus-card", "OFFER-01"),
    ("offer-term-not-on-sheet-loan", "OFFER-01"),
    ("earlier-change-not-made", "UDAAP-03"),
}


def test_code_checks_on_the_evaluation_set():
    r = evaluate()
    assert r.false_positives == []
    assert r.missed == []
    assert (r.precision, r.recall) == (1.0, 1.0)
    assert r.true_positives_code >= 25


def test_ai_only_cases_are_expected_misses():
    r = evaluate()
    assert {(case, e["ruleId"]) for case, e in r.ai_only} == AI_ONLY


def test_key_quotes_text_that_exists():
    """Every non-empty key entry quotes text of its material, so a match is about real text."""
    key = load(HERE / "answer-key.json")["cases"]
    cases = load(HERE / "materials.json")["cases"]
    assert {c["id"] for c in cases} == set(key)
    assert sum(1 for c in cases if not key[c["id"]]) >= 8  # clean materials, so false alarms show
    for c in cases:
        for e in key[c["id"]]:
            assert e["layer"] in ("code", "ai")
            assert e["text"] == "" or any(e["text"] in f["text"] for f in c["fields"]), (c["id"], e)


async def test_ai_part_runs_with_a_fake_client():
    """The AI part of the evaluation, with a fake model that finds nothing: it runs on every case and makes
    no call to the real API. With a key, `python -m tests.eval.run` reports the real numbers."""
    from types import SimpleNamespace

    from tests.eval.run import evaluate_ai

    calls = []

    async def create(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text='{"findings": []}')])

    r = await evaluate_ai(SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create))))
    assert len(calls) == len(load(HERE / "materials.json")["cases"]) and r.not_run == []
    assert (r.ai_findings, r.ai_recall) == (0, 0.0)
    assert {(c, e["ruleId"]) for c, e in r.missed} == {(c, rule) for c, rule in AI_ONLY}
