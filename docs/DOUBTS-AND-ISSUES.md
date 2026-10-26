# Open questions and risks

Earlier questions are answered; see [DECISIONS.md](DECISIONS.md). Your personal answers live in `private/DOUBTS-ANSWERS.md` (gitignored).

## A. Still open
| # | Question | Suggestion |
|---|---|---|
| Q1 | Onboarding as a step-by-step web form, a chat-style flow, or both? | Web form first; chat later. |
| Q2 | Goal breakdown: rule-based only, or optional LLM planning (player's own API key)? | Rules for v1, LLM later. |
| Q3 | Fitbit wake-up source: which API fits the player's device, and is it worth it for v1? | Skip in v1; manual/phone-unlock first. |
| Q4 | Friction blocking on Android: what level of friction (confirm delay, overlay, uninstall-guard)? | Overlay with a 30-second wait; no device-admin tricks. |
| Q5 | Baseline week: required, or skippable? | Skippable, but recommended. |
| Q6 | Copyright line in LICENSE: "Life Game contributors" or your name? | Your choice. |
| Q7 | Mood question in the weekly review: keep, or drop? | Keep (optional). |

## B. Risks that remain
1. **Android background limits** (Samsung One UI). Mitigations: keep-alive restarts on events, battery-optimisation exemption, heartbeat to the server. Needs real-device testing.
2. **Friction blocking is bypassable.** Accepted by design; friction is the barrier.
3. **ActivityWatch permissions on macOS** (Accessibility, sometimes Screen Recording). One-time setup.
4. **Wake-time ramp is user-specific.** Very irregular sleepers need a very slow ramp; the app asks and adapts weekly.
5. **Scope.** The owner expects about a week. A realistic first milestone is Phases 0-1 plus the Mac tracker and reports; Android and polish follow from real use.
6. **Public-repo hygiene.** No secrets, tokens, personal data or real hostnames in commits; real values in gitignored files; pre-commit scan (P0-7).
7. **Sensitive data on the server.** Detailed habit and browsing record; keep behind login and HTTPS.
8. **Wellbeing.** Persistent oversleeping and severe procrastination can have causes software can't fix. This tool supports, but doesn't replace, professional help.
9. **Harsh penalties** can cause quitting; the pressure level is a player choice and can be lowered at any time.
10. **Server downtime** is accepted; devices queue and sync later.
