# ClearPath backend

FastAPI app. Run it with `docker compose up` from the repo root.

## Tests

`docker compose up -d postgres`, then `uv run pytest`. Tests use their own database, `clearpath_test`.

Pre-review evaluation (PRD F4): `uv run python -m tests.eval.run` prints precision and recall of the code checks
on the golden dataset in `tests/eval/` (no database needed). `tests/eval/test_eval.py` runs it in pytest.

## Invites and email

An invite (PRD F16) emails a link to `{APP_URL}/accept-invite?token=...`. With the default `MAIL_BACKEND=console`,
nothing is sent: the backend log shows the email, so copy the link from there. TODO: the `smtp` backend in `app/mail.py`.

Failed sign-ins are limited per email and per client IP (`sign_in_*` in `config.py`); then sign-in returns 429.

## Adding an area (for example the policy library)

Each area keeps its code in its own files, so work on two areas at once seldom conflicts.

1. **Tables:** `src/app/models/<area>.py`. Import from `app.models.base` and `app.models.core`. The package finds the module itself.
   Every table has a `workspace_id`, and every query filters by the viewer's workspace.
2. **Migration:** `uv run alembic revision --autogenerate -m "<area>"`, then read it. Then run `uv run alembic check`.
3. **Endpoints:** `src/app/<area>.py` with one `APIRouter` under `/api/<area>`. Use the role checks in `app.api`
   (`SignedIn`, `InternalUser`, `Manager`, `Admin`) and the camelCase `APIModel`. Add the router to `ROUTERS` in `main.py`.
4. **Demo data:** JSON files in `src/app/seed/data/`, and `src/app/seed/<area>.py` with `create(ctx)` and
   `delete_all(db, workspace)`. Add the module to `AREAS` in `src/app/seed/__init__.py`, after the areas it uses.
   Keep the IDs of the frontend demo files, so links between areas stay the same.
5. **Tests:** `tests/test_<area>.py`. `tests/helpers.py` has the demo accounts and `as_user`. Each test starts with a fresh demo workspace.
6. **Frontend:** the API keeps the shape of the TypeScript types the frontend already has. Replace the
   `/demo/*.json` fetch with `api()` from `src/lib/api.ts`, save with `useSave`, and delete the demo file.
