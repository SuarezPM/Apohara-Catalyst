# Sample Plan — fix login bug

## Goal
Repair JWT signing in the login route.

## Tasks
- Update `packages/api/src/routes/auth.ts::handleAuth` to sign with HS256
- Add regression test in `packages/api/src/routes/auth.test.ts`

## Out of Scope
- no authentication for `users` endpoint
- no password reset flow
- no admin console
