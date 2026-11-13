# Suggestion box

Status: awaiting approval · 2026-11-13 · size: small change

## Intent

Signed-in people (family, friends) tell the admin about **ideas** or **problems with the website**, without needing
another channel. The admin keeps track of what has been handled.

## Goals / non-goals / anti-goals

- Goals: a simple form for signed-in users; an admin page listing suggestions, newest first, with Done / reopen; an
  email to the admin for each new suggestion when mail works.
- Non-goals: replies or threads, attachments, anonymous submissions, public listing, voting.
- Anti-goals: a suggestion getting lost because mail is broken (the database is the source of truth); non-admins
  seeing other people's suggestions.

## Approaches

- **A. Database + admin page + optional email (chosen by the owner).** Nothing is lost, status can be tracked; costs
  a migration.
- B. Email only: least work, but lost when mail is down, no overview. Rejected.
- GitHub issue: needs a token on the server and makes family messages public. Dropped.

## Design

- **Data:** new Prisma model `Suggestion { id cuid, userId → User (cascade delete), kind "idea" | "problem",
  message String (1–2000 chars, trimmed), page String? (path the user came from, max 200), status "open" | "done"
  (default open), createdAt, doneAt? }`, index on `(status, createdAt)`. One migration.
- **Submit:** page `/suggestions` (signed-in, `requireUser`), linked as "Suggestions" in the header for everyone.
  Form: kind (Idea / Problem, radio), message (textarea), hidden `page` taken from the `?from=` query (header link
  passes the current path; only same-site paths starting with `/` are kept). Server action validates, saves, then
  tries to email every admin; mail failure never fails the submit. Success message: "Thanks! The admin will read
  this." Limit: at most 10 suggestions per user per hour (counted in the database), else "You've sent a lot of
  suggestions in the last hour. Try again later."
- **Email to admins:** subject `New idea from <name>` / `New problem from <name>`; body: message, page, link to
  `/admin/suggestions`. Sent to each admin with a real (non-placeholder) email, via `sendMail`; skipped when mail
  isn't configured.
- **Admin page:** `/admin/suggestions` (`requireAdmin`, 404 otherwise), linked next to Settings and Users on admin
  pages, with an open-count badge on the header's Admin link. Two sections: Open (newest first) and Done (latest
  50). Each shows kind, message, who (name or email), page, date, and a Done / Reopen button (server action,
  `requireAdmin`).
- **Tests:** create (validation, trimming, length, kind), the hourly limit, admin-only listing and status change,
  mail sent to admins only and failures swallowed, `?from=` sanitising (external URLs dropped).

## Left to the builder

Exact layout and copy beyond the strings above; where the badge sits visually.
