# Known Limitations

Update this file when a limitation changes; keep entries concise.

## Current prototype boundaries

-   Synthetic demo data only. No real institution, personal, FDR or bank
    data.
-   No live AICTE, bank, identity, e-sign, SMS/WhatsApp or payment
    integration.
-   Bank responses are simulated or manually recorded; neither is
    automatically equivalent to bank confirmation.
-   OCR begins as a deterministic mock. Production OCR is optional and
    must not change verification semantics.
-   Notifications are in-app/mock; delivery is not guaranteed by an
    external provider.
-   Regulatory source mapping in `PDR.md` is not legal sign-off.
    Applicability, current edition, later circulars and interpretations
    require authorized validation.
-   Unconfirmed rules/checklists remain pending or illustrative and must
    not silently block or approve a real case.
-   Local private file storage is for the prototype; production storage,
    backup, retention and operational security need separate design.
-   Local demo authentication and seeded accounts are not a production
    identity architecture.
-   Portal approval is an administrative record only; it does not send a
    bank instruction or prove funds moved.
-   Metrics in `PDR.md` require real stakeholder baselines; do not claim
    unmeasured improvements.

## Environment quirks

-   The project lives inside a OneDrive-synced folder. `next build` can
    fail once with `EINVAL: ... readlink '.next/app-build-manifest.json'`
    while OneDrive has the files open; `rm -rf .next` and rebuild.

## Before any real-world use

-   Obtain authorized regulatory/process sign-off and approved rule
    versions.
-   Complete security, privacy, retention, backup, access-review and
    deployment assessments.
-   Establish authorized bank verification interfaces and evidence
    standards.
-   Define production authentication, operational monitoring, incident
    response and support.
-   Replace demo credentials and synthetic adapters with approved
    production equivalents only after review.
