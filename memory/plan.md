# Implementation Plan --- SIH FDR Portal

**Goal:** a reliable local end-to-end demo by the deadline.\
**Product source of truth:** `PDR.md`\
**Working mode:** solo developer + coding agent; one small, testable
vertical slice at a time.

## Operating rules

-   Inspect the repository before editing. Do not replace an existing
    viable stack.
-   Work in the milestone order below. Keep the app runnable after each
    milestone.
-   Implement P0 only until the end-to-end demo works.
-   Use synthetic fixtures and mock adapters. Never wait for live
    bank/OCR/AICTE access.
-   Every task ends with targeted tests and a concise report: changed
    files, commands actually run, results, blockers, next step.
-   Do not claim a test, lint, typecheck or build passed unless it was
    actually run.
-   If time becomes critical, cut optional polish/features before
    security boundaries, audit, simulation labels, or core flow.

## Milestones

### M0 --- Inspect and boot the project

-   [ ] Inspect repository, package manager, framework, existing routes,
    data layer, auth, tests and run scripts.
-   [ ] Report current architecture and any conflicts with
    `architecture.md`.
-   [ ] Create/verify environment example and local setup instructions.
-   [ ] App starts locally; baseline lint/typecheck/test/build commands
    are known.
-   [ ] Record stack decision in `DECISIONS.md`.

**Gate:** clean local startup and no unnecessary rewrite.

### M1 --- Demo foundation, roles and tenant isolation

-   [ ] Minimal schema and migrations for users, institutions and
    instruments.
-   [ ] Seed deterministic synthetic institutions and role-specific demo
    accounts.
-   [ ] Login/session and server-side role authorization.
-   [ ] Institution Admin only sees and mutates their own institution's
    data.
-   [ ] Admin/Officer/Reviewer/Authority/Auditor permissions are
    enforced server-side.
-   [ ] Shared audit helper for state-changing transactions.
-   [ ] Tests for cross-institution access and unauthorized decisions.

**Gate:** critical authorization tests pass.

### M2 --- Instrument records and documents

-   [ ] Create/list/view/edit draft instruments with validated fields.
-   [ ] Upload PDF/JPG/PNG up to 10 MB with content validation.
-   [ ] Private storage, SHA-256, uploader/time and document version.
-   [ ] Document access checks; no public file URLs.
-   [ ] Instrument detail page and history/timeline.
-   [ ] Invalid and oversized upload tests.

**Gate:** synthetic FDR can be created and securely attached.

### M3 --- Extraction, findings and correction loop

-   [ ] Mock OCR returns deterministic field values and confidence.
-   [ ] Store field-level provenance (`OCR`, `USER`, `OFFICER`,
    `BANK_SIMULATED`).
-   [ ] User reviews/corrects extracted values before submission.
-   [ ] Deterministic checks produce explainable findings.
-   [ ] Officer requests correction; institution submits a new version.
-   [ ] Preserve prior values and documents.
-   [ ] OCR failure falls back to manual entry.

**Gate:** one discrepancy can be found, corrected and re-reviewed
end-to-end.

### M4 --- Verification and audit

-   [ ] Manual-review and simulated-bank paths are separate.
-   [ ] Simulator always persists `simulated=true` and
    simulation-specific status.
-   [ ] UI says "Simulation only" or "Not independently confirmed" as
    appropriate.
-   [ ] No OCR/check result can imply bank confirmation.
-   [ ] State mutation and audit event are atomic.
-   [ ] Tests for simulator normalization, audit rollback and
    verification labels.

**Gate:** no silent or false "verified" state.

### M5 --- Maturity and in-app alerts

-   [ ] Maturity buckets are derived from dates, not confused with
    instrument lifecycle.
-   [ ] Configurable alert thresholds, default 90/60/30 days per PDR
    assumption.
-   [ ] Idempotent alert creation and visible alert history.
-   [ ] Inject/freeze clock in tests; add safe demo-only trigger if
    needed.
-   [ ] Show expiring and matured instruments on dashboards.

**Gate:** deterministic test proves a due alert is generated once.

### M6 --- Release case and decision

-   [ ] Institution opens a release/extension case against an
    instrument.
-   [ ] Create a versioned checklist snapshot; label unapproved
    templates illustrative.
-   [ ] Reviewers complete assigned tasks with notes/evidence.
-   [ ] Authority can approve/reject/return/escalate only with
    permission and reason.
-   [ ] Block approval when required checklist items are incomplete.
-   [ ] Block self-approval/separation-of-duties violations.
-   [ ] Case changes do not silently mutate instrument lifecycle.
-   [ ] Approval UI clearly says it is not a bank instruction or proof
    of funds transfer.

**Gate:** one complete case is decided with an auditable history; no
legal rule is invented.

### M7 --- Judge-ready demo

-   [ ] Role-specific dashboard and clear empty/loading/error states.
-   [ ] Persistent synthetic-data banner on all relevant screens.
-   [ ] Seeded scenario pack: valid instrument, discrepancy, maturity
    soon, overdue maturity, pending verification, open release case.
-   [ ] Demo reset is deterministic and does not delete user data
    outside the intended demo database.
-   [ ] Responsive pass for laptop/tablet.
-   [ ] README: setup, demo accounts, reset, environment, limitations.
-   [ ] Run critical acceptance tests, lint, typecheck and production
    build.
-   [ ] Rehearse the demo script from a clean database.

**Gate:** fresh setup → login → submit → review/correct → verify
simulation → alert → release case → decision → audit history.

## Time-pressure cut line

If the deadline is close, prioritize in this order: 1. App boots locally
and demo accounts work. 2. Secure role/institution isolation. 3. Create
instrument and upload synthetic document. 4. Mock extraction +
correction loop. 5. Clearly simulated verification + audit history. 6.
One maturity alert and one release-case decision. 7. Dashboard,
seed/reset, README and visual polish.

Defer P1/P2 items in `PDR.md`: live integrations, production OCR, email,
exports, interest ledger, advanced fuzzy matching, workflow-editor UI,
production rule publishing, e-sign and fund movement.

Do not remove tenant isolation, truthful simulation labels, auditability
or the human decision boundary to save time.

## Demo acceptance checklist

-   [ ] Clean local setup instructions work.
-   [ ] Synthetic-data banner is visible.
-   [ ] Institution user cannot access another institution's records.
-   [ ] Instrument can be created and a valid document uploaded.
-   [ ] OCR output is reviewable and correctable.
-   [ ] Discrepancy produces an understandable finding.
-   [ ] Simulated response is never shown as real bank confirmation.
-   [ ] Maturity alert can be demonstrated reproducibly.
-   [ ] Release case checklist and authorized decision work.
-   [ ] Decision/audit history is visible to permitted roles.
-   [ ] All reported test/build results are real.

## Progress log

Keep this section short. Update only the current milestone, next
concrete task, and blockers.

-   **Current milestone:** M7 (judge-ready demo) — COMPLETE. All
    slices A–G plus the UI close-out are implemented.
-   **Done in this pass (UI close-out):** responsive/tablet pass at
    768px and phone widths (grid collapse, table overflow, login
    split) verified in the browser; route-level `loading.tsx` /
    `error.tsx` / `not-found.tsx` added with consistent empty states;
    accessibility pass (skip link, `:focus-visible`, reduced-motion,
    `role=alert`/`role=status` on all form feedback, labelled controls,
    single `h1` per page, no heading jumps, no duplicate ids — audited
    live on login, dashboard, record detail, queue and audit, plus
    server HTML for the rest); 13 screenshots refreshed in
    `screenshots/` and re-referenced in README.
-   **Verification (after last edit):** `npm run lint` 0, `npm run
    typecheck` 0, `npm test` 33/33, `npm run build` 0.
-   **Next task:** none open in P0/M0–M7. P1/P2 items in `PDR.md`
    (live integrations, production OCR, exports, e-sign) remain
    deferred by design.
-   **Blockers:** regulatory sign-off is outside the prototype.
