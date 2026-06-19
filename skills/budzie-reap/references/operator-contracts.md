# Reaper Operator Contracts

These contracts keep Reaper work read-only by default, scoped to one cut per
worktree, and easy to verify. They are documentation only. Do not build an
operator framework around them.

## Shared Contract

Reaper work has three roles: locate, cut, review. Each role has a narrow output
and hands off to the next role through written evidence.

- Work in an isolated worktree and branch for every cut.
- Keep one cut per worktree. If a candidate needs unrelated edits, split it.
- Treat writes as opt-in. Locate and review are read-only.
- Never auto-merge, push, or bypass project checks.
- Never remove security, trust-boundary validation, data-loss handling, or
  accessibility basics.
- Stop when the cut cannot be explained with local evidence.

## Locate Contract

Locate is read-only discovery. Its job is to find cut candidates and produce
evidence that another operator can verify without redoing the search.

Locator must:

- Use read-only local inputs: files, package metadata, test output, command
  output.
- Leave the working tree unchanged.
- Return candidates ranked by expected savings and risk.
- Include file and line evidence for each candidate: `path:line` plus the
  observed line or a short local excerpt.
- Name the proposed cut type: `delete`, `stdlib`, `native`, `yagni`, or
  `shrink`.
- Name the verification command that should prove the cut is safe.
- Mark uncertain candidates as suggest-only.

Locator must refuse:

- Evidence-free guesses about unused code.
- Repo-wide rewrites.
- Cuts that need more than one isolated worktree to verify.

Locator output shape:

```md
### Candidate: remove duplicate parser helper

- Type: delete
- Risk: low
- Evidence: `src/example.mjs:42` repeats `src/lib/example.mjs:18`
- Cut: remove the local helper and call the shared helper
- Verify: `npm test`
```

## Cut Contract

Cut applies exactly one approved candidate in one isolated worktree. Its job is
to make the smallest edit that tests the locator's claim.

Cutter must:

- Confirm the worktree is on the intended branch before editing.
- Apply one cut only.
- Preserve public behavior unless the candidate explicitly removes dead surface.
- Keep the diff focused on the cited evidence and the smallest supporting edits.
- Run the named verification command after the cut.
- Report kept cuts with measured savings, changed files, verification output.
- Report failed cuts with the failing command and the reason to discard.

Cutter must refuse broad or destructive edits, including:

- Recursive deletes outside the cited target.
- Bulk formatting, generated rewrites, or unrelated cleanup.
- Dependency or script removal without a local callsite and verification path.
- Deleting security checks, data-loss guards, trust-boundary validation, or
  accessibility support.
- Any change that requires merging multiple cuts to pass tests.

If a cut uncovers a second required edit, stop and record it as a new candidate.
That keeps the workflow compatible with one cut per worktree.

## Review Contract

Review is read-only diff review. Its job is to decide whether the cut is safe to
keep, discard, or revise in a later worktree.

Reviewer must:

- Inspect the diff, the locator evidence, and verification output.
- Report findings only.
- Include file and line references for every finding when the diff provides a
  stable location.
- Classify each finding as blocking, caution, or informational.
- Say whether the cut should be kept, discarded, or split into a new candidate.

Reviewer must not:

- Apply fixes.
- Rewrite the cut.
- Stage files, amend commits, merge, push, or run destructive cleanup.
- Approve a cut when verification is missing or unrelated to the changed files.

Reviewer output shape:

```md
Blocking
- `src/example.mjs:42` still imports the removed helper, so the cut is not
  green.

Decision: discard this cut.
```
