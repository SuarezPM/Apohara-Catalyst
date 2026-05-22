---
title: Sample Plan — fix login bug
status: active
planType: bug
priority: high
---

## Objective
Repair JWT signing in the login route.

## Acceptance Criteria
- [ ] Update `packages/api/src/routes/auth.ts::handleAuth` to sign with HS256
- [ ] Add regression test in `packages/api/src/routes/auth.test.ts`

## Out of Scope
- no authentication for `users` endpoint
- no password reset flow
- no admin console
