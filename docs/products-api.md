# Products: backend hand-off (PRD F8, US-66)

The frontend for Products is done on this branch. This file says what the backend must supply. Until the
endpoints below exist, the Products tab and every product picker show a load error or an empty list.

Preview the screens with sample data at `/design-system#products`.

## What the frontend already does

- **Library > Products** (`_app.library.products.tsx`): the list of products. Active products come first, then by name. Managers see "Add product".
- **Product page** (`_app.library.products_.$productId.tsx`): the name, the description, usage counts with links, a setup checklist, and Edit, Deactivate and Reactivate.
- **Dialogs** (`components/library/product-dialogs.tsx`): add or edit (name and description only), and confirm a deactivation.
- **Data** (`components/library/product-data.ts`): `useProducts()` and `useProductUpdate()`. This file holds the frontend types, which are the contract below.
- **Every picker and filter** now reads products from `useProducts()`. No product list is hard-coded. The `materials.product.*` labels are gone, so the server's `name` is the only label.
  - A picker shows active products, plus inactive ones that the record already has (`pickableProducts`).
  - Filters show all products, inactive included (`filterableProducts`).

## API contract

All paths are under `/api`. Use camelCase JSON, the same as the other library endpoints.

### `GET /library/products`

Every product in the workspace, active and inactive. All roles can read it. The frontend caches it for 5 minutes and
refetches after each change.

```json
[
  {
    "id": "personal_loan",
    "name": "Personal loan",
    "description": "Unsecured fixed-rate loans from $1,000 to $50,000.",
    "active": true,
    "createdAt": "2026-01-12T15:04:00Z",
    "createdBy": "Dana Whitfield",
    "usage": {
      "materials": 42,
      "materialsInReview": 3,
      "rules": 9,
      "disclosures": 4,
      "blocks": 6,
      "rateSheetRows": 5,
      "routingRules": 2
    }
  }
]
```

`usage` counts records that name the product **explicitly**. Records with an empty `products` array ("every
product") do not count. The page says this in its footnote.

| Field | Counts |
|---|---|
| `materials` | Materials whose `product` is this ID, in any state |
| `materialsInReview` | Of those, the ones in Submitted or In review |
| `rules`, `disclosures`, `blocks` | Library records whose `products` contains this ID |
| `rateSheetRows` | Rows of the **current** rate sheet with this product |
| `routingRules` | Routing rules whose `products` contains this ID |

### `POST /library/products`

Body: `{ "name": string, "description": string }`. Returns the new product, in the same shape as above, with all usage counts at 0.

- Only a Manager or an Admin can do this (`canEditLibrary`). Other roles get 403.
- **The server makes the ID**: a slug of the name (`Auto loan` → `auto_loan`), with a suffix if that slug exists. The ID never changes after this, so a rename breaks no reference.
- Names are unique per workspace, ignoring case and spaces at the ends. A duplicate gets 409. The form also checks this before it sends.
- Both fields are required and are trimmed.
- Write an audit log entry.

### `PATCH /library/products/{id}`

Body: any of `{ "name", "description", "active" }`. Returns the updated product.

- It uses the same role check, uniqueness check and audit log entry as POST.
- Deactivation (`active: false`) changes no other record. Materials in review keep their review, library records keep the ID, and the rate sheet keeps its rows.
- There is no DELETE. Deactivation takes its place.

## Inactive products

- When the server creates or edits a material, rule, disclosure, block, routing rule or rate sheet row, it must **reject an inactive product that the record did not already have**. Return 422.
- The submit form disables the product select when no product is active, and shows "No products yet. Ask a Manager to add one in the Library."

## Backend changes

### 1. Replace the `Product` StrEnum with a table

`class Product(enum.StrEnum)` is in `models/materials.py:59`. These files use it:

- `routing_eval.py`, `routing.py`, `flags.py`, `ai_review.py`, `library.py`, `material_list.py`, `materials.py`, `export.py`, `metrics.py`
- `seed/materials.py`, `seed/history.py`, `seed/data/material-details.json`
- tests: `test_materials.py`, `test_ai_review.py`, `test_ai_review_context.py`, `test_flags.py`, `eval/run.py`

Make a `products` table with these columns: `id` (String(32), PK, the slug), `workspace_id`, `name`, `description`, `active`,
`created_at` and `created_by`. `Material.product` is a Postgres enum column today (`str_enum(Product, "product")`). Change it to
`String(32)` with a foreign key to `products.id`. The library `products` arrays (`models/library.py`, `models/routing.py`) and
`RateRow.product` are plain strings already. Check them against the table on write.

**Migration:** insert one row for each current enum value, with the **same ID strings**. Then no existing record changes.
Drop the enum type after the column changes.

### 2. Seed data

The PRD seeds 3 products: personal loans, credit cards and mortgage prequalification. The enum has 6 today
(`personal_loan`, `credit_card`, `mortgage`, `heloc`, `auto_loan`, `savings`), and the seed materials use some of the other 3.
Choose one:

- Seed all 6, and set `heloc`, `auto_loan` and `savings` to inactive if no seed material uses them. This is easy and shows the inactive state in the demo.
- Seed 3, and move the seed materials onto them.

### 3. `prereview.PRODUCT_NAMES`

`prereview.py:420` maps IDs to plural names for check messages ("not on the rate sheet for personal loans"). Remove the
map and use the product's `name` from the table. Pass it into the check, because prereview does not query the database.

### 4. Rate sheet CSV

`CSV_COLUMNS` in `library.py:694` has a `product` column. Accept the product ID. If you can, also accept the name, ignoring case.
Reject unknown or inactive IDs with a row error, the same way the other bad values are rejected.

### 5. `Integration.defaultProductId`

The PRD data model gives `Integration` an optional `defaultProductId`. It is the product that imported materials get. Add it as a
nullable foreign key. The frontend does not show it yet.

### 6. Filters that accept any ID

`?product=` on `/materials` and `/metrics` is no longer checked against a fixed list in the frontend. The server must
treat an unknown ID as "no match", not as an error.

## Left in the frontend

`components/library/disclosure-filters.ts` has 3 quick views (`lending`, `cards`, `deposits`) with fixed product IDs. They need
a product category before they can come from data. The PRD does not define one, so they stay as they are for now.
