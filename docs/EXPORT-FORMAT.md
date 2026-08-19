# The ikid export format

> Your data is yours. This document exists so that's a fact you can check, not a
> promise you have to take on trust.

Settings → **Your data — take it anywhere** → *Export everything as JSON*
downloads one file containing everything in the active profile. It is plain
JSON, indented, and meant to be opened in a text editor.

- **Endpoint:** `GET /api/settings/export.json`
- **Filename:** `ikid-<profile>-<YYYY-MM-DD>.json`
- **Format id:** `ikid-export`, currently version `1`

## Shape

```jsonc
{
  "format": "ikid-export",
  "version": 1,
  "exportedAt": "2026-08-17T19:40:00.000Z",
  "appVersion": "0.6.0",
  "profile": "eked1",
  "counts": { "transactions": 1211, "accounts": 4, "assets": 6, "...": 0 },
  "data": {
    "accounts":    [{ "name": "Chase", "type": "credit", "currency": "USD" }],
    "categories":  [{ "name": "Groceries", "type": "expense", "color": "#5b7d3f" }],
    "merchants":   [{ "name": "Kroger" }],
    "tags":        [{ "name": "reimbursable" }],
    "imports": [{
      "filename": "chase-june.csv",
      "importedAt": "2026-07-01T12:00:00.000Z",
      "fileType": "csv", "status": "completed",
      "transactionCount": 84, "duplicateCount": 3,
      "account": "Chase"
    }],
    "transactions": [{
      "date": "2026-06-03",
      "description": "KROGER #688",
      "amount": -52.10,              // signed: negative = money out
      "balance": 1234.50,
      "type": "debit",
      "refNumber": "REF-1",
      "notes": "split with Sam",
      "hash": "…",                   // dedupe key, see below
      "isTransfer": false,
      "category": "Groceries",       // by NAME, not id
      "merchant": "Kroger",
      "account": "Chase",
      "import": { "filename": "chase-june.csv", "importedAt": "2026-07-01T12:00:00.000Z" },
      "tags": ["reimbursable"]
    }],
    "rules":    [{ "keyword": "KROGER", "priority": 5, "source": "learned", "category": "Groceries" }],
    "budgets":  [{ "category": "Groceries", "monthlyLimit": 600 }],
    "goals":    [{ "name": "House", "icon": "🏠", "targetAmount": 60000,
                   "currentSaved": 12000, "monthlyContribution": 900,
                   "deadline": "2029-01-01" }],
    "assets":   [{ "name": "Brokerage", "kind": "investment", "isLiability": false,
                   "icon": "📈", "units": 13.7, "unitPrice": 145.23,
                   "ratePct": null, "monthlyPayment": null, "notes": "taxable",
                   "snapshots": [{ "date": "2026-06-30", "value": 1989.65 }] }],
    "settings": { "currency": "USD", "theme": "dark" },
    "savedCalculations": [{ "kind": "fire", "name": "FIRE at 4%",
                            "inputs": { "currentAge": 35, "ratePct": 5 } }],
    "conversations": [{ "title": "Buying a house", "messages": "[…]" }]
  }
}
```

## Design decisions, and why

**Natural keys, never database IDs.** A transaction says
`"category": "Groceries"`, not `"categoryId": 7`. An ID is only meaningful
inside the database it came from; a file full of IDs round-trips into *that*
database and nowhere else, which would make the export theatre. Names mean the
file can be read, diffed in git, hand-edited, and imported into a different
profile or a database rebuilt from scratch.

The one entity with no natural key is import history — two files can share a
name — so an import is identified by the pair `filename` + `importedAt`, which
is unique in practice and still readable.

**Dedupe hashes are preserved.** Re-importing an export is a no-op rather than
a way to double your transactions, and a later statement import still correctly
recognises what you already have.

**Import history is included.** Without it, "Undo import" and the per-account
"where did I leave off" tracking would quietly stop working after a restore.
That would make the export lossy while calling itself lossless.

**Nulls are kept as `null`, not dropped.** "This transaction has no merchant"
and "this file forgot to mention the merchant" are different statements.

## Importing

`POST /api/settings/import.json` (multipart, field name `file`), or the two
buttons in Settings.

| Mode | What it does |
| --- | --- |
| `merge` *(default)* | Creates accounts, categories, merchants and tags that don't exist yet; adds transactions whose hash isn't already present and skips the rest. Nothing is deleted. Safe to run twice. |
| `replace` | Deletes everything in the profile first, then loads the file. Destructive, and asked for explicitly (`?mode=replace` plus a confirmation in the UI). |

The response summarises what was **created** — re-importing the same file
reports zeros, not the whole file over again.

The file is treated as untrusted input. It's validated with zod before a single
row is written, and rejected with a readable message rather than a stack trace.
A file produced by a newer ikid gets a specific message telling you to update,
instead of silently importing half of it.

## Guarantees, honestly stated

What round-trips exactly: all of the above.

What doesn't travel, deliberately:

- **Passwords and sessions.** Credentials live outside the profile database
  (`auth.json`, `sessions.json`) and are never exported. An export is data, not
  an identity.
- **Database row IDs.** By design — see above. If you import into a fresh
  profile, rows get new IDs.
- **Analytics events** (`analytics.jsonl`), which are feature-usage counts and
  contain no financial data.

If you want a byte-exact copy of the profile including IDs, use
Settings → Database → *Export .db file* instead. The JSON export is the
portable one; the `.db` is the exact one.
