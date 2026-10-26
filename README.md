# Life Game

An open-source, deadline-driven productivity game for one player. A daily 24-hour window gives you a few small tasks and consequences. Sensors track your time, so you don't have to report it honestly. Game time is earned and capped.

Status: **Phase 0 built** (server, Postgres, auth, Compose, backups). License: MIT.

## Docs (read in this order)
1. [docs/DECISIONS.md](docs/DECISIONS.md): settled choices
2. [docs/ONBOARDING.md](docs/ONBOARDING.md): how the app learns your goals and builds daily tasks
3. [docs/PLAN.md](docs/PLAN.md): why, what we build, game design, integrity rules
4. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): diagrams (Mermaid)
5. [docs/ROADMAP.md](docs/ROADMAP.md): phases 0 to 5 and every task with acceptance criteria
6. [docs/CONFIGURATION.md](docs/CONFIGURATION.md): how personal data is kept out of the repo
7. [docs/DOUBTS-AND-ISSUES.md](docs/DOUBTS-AND-ISSUES.md): open questions and risks
8. [docs/DEPLOY.md](docs/DEPLOY.md): run it on your server

## Your own data
This repo ships formats and fake examples only (`config/*.example.*`, `.env.example`). Copy them to `*.local.*` / `.env` and fill in your values; those files and the `private/` folder are gitignored.

Mermaid diagrams render on GitHub and in VS Code with a Mermaid preview extension.
