import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadInstrumentPage } from "@/lib/rbac";
import { ROLE } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { replacementEligible } from "@/lib/services/replacements";
import { ApiForm } from "@/components/ApiForm";
import { InstrumentFields } from "@/components/InstrumentForm";
import { Card, CardBody, CardHead, DefinitionList, Notice, PageHead, StatusBadge } from "@/components/ui";
import { LIFECYCLE_LABEL } from "@/lib/instrument-meta";

export default async function ReplaceInstrumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  if (user.role !== ROLE.INSTITUTION_ADMIN) notFound();
  const instrument = await loadInstrumentPage(user, id);

  if (!replacementEligible(instrument.lifecycleStatus, instrument.replacedBy.length)) {
    notFound();
  }

  return (
    <>
      <PageHead
        eyebrow={`Renewal / replacement of ${instrument.fdrNumber}`}
        title="Replace this FDR with a new record."
        description="A replacement is a NEW record linked to its predecessor. The original record, its documents, findings, verification history and audit trail are preserved unchanged."
        actions={<Link href={`/instruments/${instrument.id}`} className="btn btn--ghost">Back to record</Link>}
      />

      <div className="split">
        <div className="stack">
          <Card>
            <CardHead
              title="Predecessor (will be marked Replaced)"
              description="Marked REPLACED only if the replacement commits successfully."
            />
            <CardBody>
              <DefinitionList
                items={[
                  { label: "FDR number", value: <span className="mono">{instrument.fdrNumber}</span> },
                  { label: "Bank", value: instrument.bankName },
                  { label: "Amount", value: formatMoney(instrument.amount) },
                  { label: "Maturity", value: formatDate(instrument.maturityDate) },
                  { label: "Status", value: <StatusBadge value={instrument.lifecycleStatus} label={LIFECYCLE_LABEL[instrument.lifecycleStatus]} /> },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHead
              title="New replacement record"
              description="Created as a draft. Upload its document and run the normal submission flow afterwards."
            />
            <CardBody>
              <ApiForm
                action={`/api/instruments/${instrument.id}/replace`}
                submitLabel="Create replacement record"
                successMessage="Replacement created. The predecessor is now marked Replaced."
                confirmText="Create a new replacement record and mark this one as replaced?"
                redirectFromResponse={{ path: "instrument.id", base: "/instruments" }}
                note="Nothing is deleted; both records stay linked."
              >
                <div className="field">
                  <label htmlFor="reason">Replacement / renewal reason (required)</label>
                  <textarea
                    id="reason"
                    name="reason"
                    required
                    minLength={10}
                    maxLength={1000}
                    placeholder="e.g. Deposit renewed at maturity for a fresh 5-year term under the same sanction."
                  />
                  <span className="field__hint">
                    Stored on the successor and written to the audit trail with your user ID.
                  </span>
                </div>
                <InstrumentFields
                  defaults={{
                    bankName: instrument.bankName,
                    branch: instrument.branch,
                    fdrNumber: "",
                    amount: instrument.amount.toString(),
                    issueDate: "",
                    maturityDate: "",
                    holderName: instrument.holderName,
                    declaredLienStatus: instrument.declaredLienStatus,
                  }}
                />
              </ApiForm>
            </CardBody>
          </Card>
        </div>

        <aside className="stack">
          <Notice tone="warn" title="What replacement does and does not do">
            It creates a linked successor record and sets the predecessor lifecycle to REPLACED in
            the same database transaction. It does not touch the bank, does not verify the new
            instrument, and does not release or close the old one — those remain separate,
            individually audited actions.
          </Notice>
          <Notice tone="quiet" title="Eligibility rules">
            Draft, archived and already-replaced records cannot be replaced. A record can have at
            most one successor, so duplicate replacements are rejected by a guarded,
            concurrency-safe database update.
          </Notice>
        </aside>
      </div>
    </>
  );
}
