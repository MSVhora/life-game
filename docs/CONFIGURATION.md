# Configuration and personal data

The repo is public. **Personal data never goes in tracked files.** Each config has a committed `*.example.*` file that documents the format with fake data. You copy it to a `*.local.*` name (gitignored) and fill in your own values.

| Real file (gitignored) | Example (committed) | Holds |
|---|---|---|
| `config/player.local.yml` | `config/player.example.yml` | day end time, gaming cap, wake goal and ramp, pressure level, timezone |
| `config/quests.local.yml` | `config/quests.example.yml` | task templates, XP, minutes earned, evidence rules |
| `config/clients.local.yml` | `config/clients.example.yml` | freelance clients, hourly rate, monthly caps |
| `config/categories.local.json` | `config/categories.example.json` | app/site to Productive/Neutral/Waste rules |
| `config/sources.local.yml` | `config/sources.example.yml` | watched folders, CSV paths, e-reader mount path |
| `.env` | `.env.example` | domain, DB URL, API tokens, backup key location |
| `private/` | (none) | your notes, answers, context: whole folder ignored |

Rules:
- Loader reads `*.local.*` first and falls back to `*.example.*` so the app runs out of the box with demo data.
- Secrets (tokens, backup keys) only in `.env`/secret store, never in YAML.
- A pre-commit check (task P0-7) blocks commits containing `.env`, `*.local.*`, `private/`, or token-like strings.
- Don't put real names of clients, employers or hosts in docs, issues, commit messages or tests.
