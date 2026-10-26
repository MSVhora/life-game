# Life Game

An open-source, deadline-driven productivity game for one player. A daily "war" gives you a 24-hour clock, a few tiny attacks, and consequences. Sensors track your time, so you don't have to report it honestly. Game time is earned and capped.

Status: **planning only, no code yet.**

## Docs (read in this order)
1. [docs/PLAN.md](docs/PLAN.md): why, what we build, game design, integrity rules
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): diagrams (Mermaid)
3. [docs/ROADMAP.md](docs/ROADMAP.md): phases 0 to 5 and every task with acceptance criteria
4. [docs/CONFIGURATION.md](docs/CONFIGURATION.md): how personal data is kept out of the repo
5. [docs/DOUBTS-AND-ISSUES.md](docs/DOUBTS-AND-ISSUES.md): open questions and risks

## Your own data
This repo ships formats and fake examples only (`config/*.example.*`, `.env.example`). Copy them to `*.local.*` / `.env` and fill in your values; those files and the `private/` folder are gitignored.

Mermaid diagrams render on GitHub and in VS Code with a Mermaid preview extension.
