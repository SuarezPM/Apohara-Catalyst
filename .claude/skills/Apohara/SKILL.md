```markdown
# Apohara Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches the core development patterns, coding conventions, and operational workflows used in the Apohara repository. Apohara is a Rust-based project (with some TypeScript for testing and orchestration), emphasizing clear commit conventions, modular crate structure, and rigorous test auditing. The repository is workflow-driven, with documented processes for test audits, documentation updates, parallel agent coordination, crate scaffolding, and CI maintenance.

## Coding Conventions

### File Naming

- Use **camelCase** for file names.
  - Example: `myModule.rs`, `testUtils.ts`

### Imports

- Use **relative imports** for modules.
  - Example (Rust):
    ```rust
    mod utils;
    use crate::utils::some_function;
    ```
  - Example (TypeScript):
    ```typescript
    import { helper } from './helper';
    ```

### Exports

- Use **named exports**.
  - Example (Rust):
    ```rust
    pub fn my_function() { ... }
    ```
  - Example (TypeScript):
    ```typescript
    export function myFunction() { ... }
    ```

### Commit Messages

- Follow **conventional commit** format.
- Prefixes: `docs`, `feat`, `fix`, `chore`
- Example:  
  ```
  feat: add user authentication to API layer
  fix: correct off-by-one error in pagination
  docs: update README with usage instructions
  ```

## Workflows

### Test Audit and Classification

**Trigger:** When reviewing, classifying, and validating the health of all test files (e.g., after major refactors or before a release).  
**Command:** `/test-audit`

1. Run a static audit on batches of test files, classifying each as `KEEP_GREEN`, `KEEP_REFACTOR`, `INVESTIGATE`, or `KILL`.
2. Write per-batch audit results to `.claude/specs/tests/PHASE_5_2_AUDIT_BATCH{N}.md`.
3. Update or create `.claude/specs/tests/PHASE_5_2_AUDIT_SUMMARY.md` with overall tallies and recommendations.
4. Empirically run the `KEEP_GREEN` and `KEEP_REFACTOR` cohorts, updating the summary with pass/fail counts.
5. Repeat for additional batches until all test files are covered.

**Example Classification Table:**
```markdown
| File                  | Status         | Notes                  |
|-----------------------|---------------|------------------------|
| utils.test.ts         | KEEP_GREEN    | Passes, well-written   |
| legacyApi.test.ts     | INVESTIGATE   | Flaky, needs review    |
```

---

### Roadmap and Docs Update

**Trigger:** When documenting completed phases, updating project direction, or reconciling naming and stack changes.  
**Command:** `/update-roadmap`

1. Edit `ROADMAP.md` to mark phases as complete, add new milestones, or clarify direction.
2. Edit `CLAUDE.md` and `AGENTS.md` to reconcile naming, stack, or protocol changes.
3. Remove or retire superseded documentation files.
4. Commit with a message referencing the relevant phase or milestone.

---

### Parallel Work Coordination

**Trigger:** When maximizing throughput by having multiple agents (e.g., Claude and MiniMax) work in parallel on different but related tasks.  
**Command:** `/parallel-work`

1. Assign distinct but related tasks to different agents (e.g., one audits tests, one scaffolds code, one runs code indexer).
2. Document the parallel work protocol and bridge scripts (e.g., `tmux-minimax.sh`) in `CLAUDE.md`.
3. Reference parallel work in commit messages and documentation.
4. Aggregate results from all agents into summary docs or audit batches.

---

### Scaffold New Rust Crate

**Trigger:** When adding a new Rust subsystem or binary to the project.  
**Command:** `/scaffold-crate`

1. Create `crates/new-crate-name/` with `Cargo.toml` and `src/` directory.
2. Add initial dependencies and set up `main.rs` or `lib.rs` with public API skeleton.
3. Implement minimal structs/enums and error handling.
4. Write initial unit tests for core types or functions.
5. Verify build and test pass.
6. Integrate with orchestrator or TypeScript wrapper as needed.

**Example Directory Structure:**
```
crates/
  myNewCrate/
    Cargo.toml
    src/
      lib.rs
      main.rs
      myModule.rs
```

---

### CI Unblock and Package Lock Maintenance

**Trigger:** When CI fails on multiple OSes due to invalid paths, missing packages, or lockfile issues.  
**Command:** `/ci-fix`

1. Identify and remove invalid or platform-incompatible files (e.g., `file:/...` artifacts).
2. Edit `package.json` to remove or fix problematic dependencies.
3. Regenerate `bun.lock` or other lockfiles.
4. Verify that CI passes on all platforms.
5. Document the fix in commit message.

## Testing Patterns

- Use **Vitest** for TypeScript/JavaScript testing.
- Test files follow the pattern: `*.test.ts`
- Place tests alongside source files or in a dedicated `tests/` directory.

**Example Test File:**
```typescript
// mathUtils.test.ts
import { add } from './mathUtils';

test('adds numbers', () => {
  expect(add(2, 3)).toBe(5);
});
```

- Run tests with:
  ```
  npx vitest run
  ```

## Commands

| Command         | Purpose                                                                 |
|-----------------|-------------------------------------------------------------------------|
| /test-audit     | Audit, classify, and empirically validate all test files                |
| /update-roadmap | Update project roadmap and documentation for new phases or changes       |
| /parallel-work  | Coordinate and document parallel work between multiple agents           |
| /scaffold-crate | Scaffold and initialize a new Rust crate                                |
| /ci-fix         | Fix CI failures and maintain package lockfiles                          |
```
