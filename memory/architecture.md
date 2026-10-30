# Architecture --- AICTE Security Deposit / FDR Management Portal

**Status:** Draft for implementation\
**Product source of truth:** [`PDR.md`](./PDR.md)\
**Current stage:** Not started; repository/stack inspection required\
**Target:** Local, end-to-end SIH demo for a solo developer

## 1. Decision summary

-   **Default direction:** modular monolith; one deployable application,
    clear internal modules.
-   **Preferred stack from PDR ASM-005:** Next.js + TypeScript +
    PostgreSQL + Prisma.
-   **Important:** this stack is provisional. First inspect the
    repository and existing tooling. Reuse a viable existing stack; do
    not rewrite an existing project merely to match this draft.
-   **Prototype integrations:** synthetic data, mock OCR, simulated bank
    responses, mock/in-app notifications. No live AICTE, bank, identity,
    or payment integration.
-   **Deployment:** local-first. No cloud deployment is required for the
    current demo target.
-   **No microservices or Kubernetes.**

## 2. System shape

``` mermaid
flowchart TD
  UI[Portal UI: institution and AICTE roles]
  APP[Application/API layer]
  AUTH[Authentication and server-side authorization]
  DOMAIN[Domain modules and state transitions]
  DB[(PostgreSQL)]
  FILES[Private local document storage]
  OCR[OCR adapter: mock first]
  BANK[Bank verification adapter: simulated/manual]
  NOTIFY[In-app notification adapter]
  JOB[Scheduled maturity-alert task]
  AUDIT[Audit events]

  UI --> APP
  APP --> AUTH
  AUTH --> DOMAIN
  DOMAIN --> DB
  DOMAIN --> FILES
  DOMAIN --> OCR
  DOMAIN --> BANK
  DOMAIN --> NOTIFY
  JOB --> DOMAIN
  DOMAIN --> AUDIT
  AUDIT --> DB
```

## 3. Internal modules

Keep modules in one repository and deployable unit. Names are logical
boundaries, not a demand for a specific folder layout.

  -----------------------------------------------------------------------
  Module                              Owns
  ----------------------------------- -----------------------------------
  Auth and access                     Login/session, role checks,
                                      institution scope

  Institutions and users              Institution profiles, programmes,
                                      demo accounts

  Instruments                         FDR metadata, lifecycle,
                                      replacement links when implemented

  Documents                           Private upload, validation,
                                      versions, SHA-256, access control

  Extraction                          Mock OCR first; field-level values,
                                      confidence and provenance

  Findings                            Deterministic checks, discrepancy
                                      records, correction/resubmission

  Verification                        Manual-review records and simulated
                                      bank responses, explicitly distinct

  Rules                               Versioned source-backed rules;
                                      unconfirmed rules return
                                      `REVIEW_REQUIRED`

  Maturity and alerts                 Date-derived maturity buckets,
                                      deduplicated in-app alerts

  Cases and decisions                 Release/extension workflows,
                                      checklist snapshots, role
                                      separation

  Audit                               Append-only business history and
                                      security-relevant events

  Demo/reporting                      Role-specific dashboards, synthetic
                                      fixtures, demo reset
  -----------------------------------------------------------------------

Use plain domain/service functions for business rules; UI components
must not be the only place where permissions or state-transition rules
are enforced.

## 4. Data and persistence

Follow PDR Section 20 as the initial data-model reference. Expected
concepts include `user`, `institution`, `programme`, `instrument`,
`document_version`, `extraction_run`, `extracted_field`, `finding`,
`verification_attempt`, `maturity_alert`, `release_case`, `review_task`,
`clearance_noc`, `decision`, `interest_record`, `rule_set`,
`rule_version`, and `audit_event`.

Conventions from PDR: - UUID primary keys. - Money uses fixed precision
(`NUMERIC(14,2)`), never floating point. - Maturity dates use date
semantics; event timestamps use timezone-aware timestamps. - Avoid hard
deletion of evidence and decisions; corrections create new versions. -
Add foreign keys, unique constraints and indexes for actual query
patterns. - Tenant scoping must be applied in server-side database
queries, not trusted from client-supplied institution IDs. - A state
mutation and its audit event commit in the same transaction.

Do not implement every PDR table before the first vertical slice. Add
the minimum coherent schema needed for each milestone, while preserving
these invariants.

## 5. Trust boundaries and invariants

1.  **Extraction is not verification.** OCR output never marks a bank
    instrument as bank-confirmed.
2.  **Simulation is visibly separate.** Persist `simulated=true` and a
    simulation-specific status; show a persistent demo banner.
3.  **Manual review is not bank confirmation.** Record who reviewed what
    evidence and its limitations.
4.  **No automatic legal/financial decisions.** Release, extension,
    exemption and forfeiture require an authorized human decision and
    reason.
5.  **Unknown rule means review.** No approved, applicable rule version
    means `REVIEW_REQUIRED`; never guess a required amount or legal
    outcome.
6.  **Institution isolation.** Resolve institution scope from the
    authenticated session and enforce it on every server-side
    read/write.
7.  **Audit is atomic.** If audit persistence fails, roll back the
    associated business mutation.
8.  **Evidence is versioned.** Never silently overwrite submitted
    documents, extracted values, or decision history.
9.  **A duplicate is a finding.** Link possible duplicates for human
    review; do not silently overwrite or auto-reject.
10. **Portal approval is not execution.** The prototype does not send
    bank instructions or move funds.
11. **Synthetic data only.** Never commit real FDRs, personal data,
    credentials, or bank responses.

## 6. Document upload

-   Accept only PDF/JPG/PNG, up to 10 MB, per PDR.
-   Validate declared MIME type and file signature/magic bytes; filename
    extension alone is insufficient.
-   Store outside public web-accessible paths; serve only after
    authorization.
-   Record SHA-256 for byte-integrity tracking, document version,
    uploader and timestamp.
-   A hash does **not** establish that a document is genuine.
-   Reject invalid/oversized files without leaving partial records or
    objects.
-   Never log document contents, secrets or unnecessary personal data.

## 7. Adapters

Define small interfaces so demo implementations can be swapped later
without rewriting domain logic.

-   `OcrAdapter`: default mock returns deterministic fields and
    confidence; failures preserve a manual-entry path.
-   `BankVerificationAdapter`: default simulator returns clearly
    synthetic responses. It must never return a production
    `BANK_CONFIRMED` state.
-   `NotificationAdapter`: default in-app notifications; email is
    optional P1.
-   Live provider implementations are out of scope unless authorized and
    separately approved.

## 8. Local development and environment

If repository inspection confirms the proposed stack, the PDR suggests a
local setup such as PostgreSQL via Docker Compose, package installation,
Prisma migrations, seed data, and the development server. Use the actual
package manager and scripts discovered in the repository.

Document required environment variables in `.env.example`; commit no
real secrets. Never put a production secret in frontend-prefixed
variables. Test-only clock controls must be disabled outside demo/test
mode.

## 9. Testing strategy

Prioritize the PDR acceptance tests that protect trust boundaries: -
Institution A cannot access Institution B records. - Unauthorized roles
cannot make authority decisions. - Invalid uploads are rejected and
leave no partial data. - OCR failure permits manual entry but never
implies verification. - Missing/unapproved rules produce review-required
outcomes. - Incomplete checklist and self-approval are blocked. -
Maturity alerts are deterministic and idempotent under a frozen clock. -
Audit failure rolls back state changes. - Simulated responses remain
labelled simulated. - Seed data and dashboards clearly state that data
is synthetic.

Run the repository's actual lint, typecheck, test and build commands.
Report only commands actually run and their results.

## 10. Explicit open decisions

  -----------------------------------------------------------------------
  ID                      Question                Default until confirmed
  ----------------------- ----------------------- -----------------------
  ASM-005                 Is the repository       Inspect and preserve
                          already using a stack?  viable existing stack

  AUTH-01                 Auth library/session    Choose the simplest
                          mechanism?              secure option supported
                                                  by the discovered stack

  STORE-01                Local document storage  Private local path
                          implementation?         outside public assets

  OCR-01                  OCR engine?             Deterministic mock
                                                  first

  JOB-01                  Scheduler?              Simplest
                                                  local-compatible
                                                  scheduled task; also
                                                  provide a deterministic
                                                  manual trigger for
                                                  demo/test

  RULE-01                 Are regulatory          No; pending rules are
                          interpretations         not authoritative
                          approved?               

  DEMO-01                 Real external           No; simulated/manual
                          integrations?           only
  -----------------------------------------------------------------------

Update this file only when a meaningful architectural decision changes.
Put the reason and date in `DECISIONS.md`.
