import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ExtractedField } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { loadInstrumentPage } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { DOC_STATUS, LIFECYCLE, ROLE } from "@/lib/constants";
import { formatDate, formatDateTime, toIsoDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { ALL_CONFIRMATION_FIELDS, fieldLabel } from "@/lib/instrument-meta";
import { ApiForm } from "@/components/ApiForm";
import {
  Badge,
  Card,
  CardBody,
  CardHead,
  EmptyState,
  Notice,
  PageHead,
  StatusBadge,
} from "@/components/ui";

const EDITABLE = [LIFECYCLE.DRAFT, LIFECYCLE.CORRECTION_REQUESTED];

function valueFor(
  name: string,
  field: ExtractedField | undefined,
  instrument: {
    bankName: string;
    branch: string | null;
    fdrNumber: string;
    amount: { toString(): string };
    issueDate: Date;
    maturityDate: Date;
    holderName: string;
    declaredLienStatus: string;
  },
): string {
  if (field?.confirmedValue) return field.confirmedValue;
  if (field?.value) return field.value;
  switch (name) {
    case "bankName":
      return instrument.bankName;
    case "branch":
      return instrument.branch ?? "";
    case "fdrNumber":
      return instrument.fdrNumber;
    case "amount":
      return Number(instrument.amount.toString()).toFixed(2);
    case "issueDate":
      return toIsoDate(instrument.issueDate);
    case "maturityDate":
      return toIsoDate(instrument.maturityDate);
    case "holderName":
      return instrument.holderName;
    case "declaredLienStatus":
      return instrument.declaredLienStatus;
    default:
      return "";
  }
}

function FieldInput({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue: string;
}) {
  const id = `field-${name}`;
  if (name === "declaredLienStatus") {
    return (
      <select id={id} name={name} defaultValue={defaultValue || "UNKNOWN"}>
        <option value="UNKNOWN">Unknown</option>
        <option value="YES">Yes — declared</option>
        <option value="NO">No</option>
      </select>
    );
  }
  if (name === "issueDate" || name === "maturityDate") {
    return <input id={id} name={name} type="date" defaultValue={defaultValue} required />;
  }
  if (name === "amount") {
    return <input id={id} name={name} type="text" inputMode="decimal" defaultValue={defaultValue} required />;
  }
  return (
    <input
      id={id}
      name={name}
      type="text"
      defaultValue={defaultValue}
      required={name !== "branch"}
      maxLength={200}
    />
  );
}

export default async function InstrumentReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const instrument = await loadInstrumentPage(user, id);

  if (user.role !== ROLE.INSTITUTION_ADMIN || user.institutionId !== instrument.institutionId) {
    redirect(`/instruments/${id}`);
  }
  if (!EDITABLE.includes(instrument.lifecycleStatus as never)) {
    redirect(`/instruments/${id}`);
  }

  const document = instrument.documents[0];
  if (!document) notFound();
  const run = await prisma.extractionRun.findFirst({
    where: { documentId: document.id },
    orderBy: { startedAt: "desc" },
    include: { fields: { orderBy: { name: "asc" } } },
  });
  const fieldsByName = new Map((run?.fields ?? []).map((field) => [field.name, field]));
  const isExtracted = run?.status === "EXTRACTED";
  const isPdf = document.mime === "application/pdf";

  return (
    <>
      <PageHead
        eyebrow={`${instrument.fdrNumber} · field review`}
        title={isExtracted ? "Confirm what the register should hold." : "Enter the record manually."}
        description="OCR output and institution-confirmed values are stored separately with field-level provenance. Confirmation does not make the document genuine."
        actions={
          <>
            <Link href={`/instruments/${id}`} className="btn btn--ghost">Back to record</Link>
            {run && isExtracted ? (
              <Badge tone="attention">Mock extraction · simulated</Badge>
            ) : (
              <Badge tone="muted">{run?.status ?? "NO EXTRACTION"}</Badge>
            )}
          </>
        }
      />

      <div className="split">
        <div className="stack">
          <Card>
            <CardHead
              title="Document"
              description={`v${document.versionNo} · ${document.originalName} · ${(document.size / 1024).toFixed(1)} KB · SHA-256 ${document.sha256.slice(0, 16)}…`}
              action={<StatusBadge value={document.docStatus} />}
            />
            <CardBody flush>
              {isPdf ? (
                <iframe
                  className="document-preview"
                  src={`/api/documents/${document.id}/file`}
                  title={`Synthetic document ${document.originalName}`}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/documents/${document.id}/file`}
                  alt={`Synthetic document ${document.originalName}`}
                  style={{ width: "100%", border: "1px solid var(--line)", background: "#fff" }}
                />
              )}
            </CardBody>
            <div className="card__foot">
              <span>Private document. Access is checked on every request.</span>
              <Link href={`/api/documents/${document.id}/file`} target="_blank" className="tiny mono">
                Open in tab ↗
              </Link>
            </div>
          </Card>

          <Notice tone="warn" title="Simulation notice">
            The extractor is a deterministic mock for the demo. It does not read the document for
            real and its confidence values are not an authenticity or fraud score. A hash proves
            the stored bytes are unchanged, not that the FDR is genuine.
          </Notice>

          {run ? (
            <Card>
              <CardHead
                title="Extraction run"
                description={`${run.adapter} · ${formatDateTime(run.startedAt)} · simulated ${run.simulated ? "yes" : "no"}`}
                action={<StatusBadge value={run.status} />}
              />
              <CardBody>
                {run.error ? <Notice tone="danger" title="Extraction failed">{run.error}</Notice> : null}
                <div className="small muted" style={{ marginTop: run.error ? 12 : 0 }}>
                  Extraction output is retained even if values are corrected. A new document
                  version creates a new run; earlier evidence is not overwritten.
                </div>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHead title="No extraction yet" description="Run the mock extractor or enter values manually." />
              <CardBody>
                <ApiForm
                  action={`/api/documents/${document.id}/extract`}
                  submitLabel="Run mock extraction"
                  successMessage="Extraction run recorded. Refresh to review the fields."
                  redirectTo={`/instruments/${id}/review`}
                  note="The extractor is simulated and will not mark anything verified."
                />
              </CardBody>
            </Card>
          )}
        </div>

        <div className="stack">
          {isExtracted && run ? (
            <Card>
              <CardHead
                title="Extracted fields"
                description="Correct anything that differs from the document. Each confirmed field records whether it came from OCR or a user."
              />
              <CardBody>
                <ApiForm
                  action={`/api/extractions/${run.id}/fields`}
                  method="PUT"
                  submitLabel="Confirm all fields"
                  successMessage="Fields confirmed. You can now submit the record for scrutiny."
                  confirmText="Confirm these values as the record of truth for scrutiny?"
                  redirectTo={`/instruments/${id}`}
                  note="All mandatory fields are required."
                >
                  <div className="form-grid">
                    {ALL_CONFIRMATION_FIELDS.map((name) => {
                      const field = fieldsByName.get(name);
                      const confirmed = !!field?.confirmedAt;
                      return (
                        <div className="field" key={name}>
                          <label htmlFor={`field-${name}`}>{fieldLabel(name)}</label>
                          {field ? (
                            <div className="row-between tiny muted" style={{ marginBottom: 2 }}>
                              <span title="Raw mock extraction output">
                                OCR: {field.value || "—"}
                              </span>
                              <span>{Math.round(field.confidence * 100)}% conf.</span>
                            </div>
                          ) : null}
                          <FieldInput name={name} defaultValue={valueFor(name, field, instrument)} />
                          <div className="badge-row" style={{ marginTop: 2 }}>
                            {confirmed ? (
                              <Badge tone={field?.provenance === "USER" ? "attention" : "good"}>
                                {field?.provenance === "USER" ? "User-confirmed" : "OCR-confirmed"}
                              </Badge>
                            ) : (
                              <Badge tone="muted">Unconfirmed</Badge>
                            )}
                            {field && field.confirmedValue !== null && field.confirmedValue !== field.value ? (
                              <Badge tone="neutral">Differs from OCR</Badge>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Notice tone="quiet" title="What confirmation means">
                    You are confirming the values the register will use. This is not an independent
                    bank verification, and it does not override a later finding.
                  </Notice>
                </ApiForm>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHead
                title="Manual entry"
                description="Use this when extraction failed or is unavailable. OCR is never treated as verification."
              />
              <CardBody>
                {run?.status === "EXTRACTED" ? (
                  <EmptyState title="Use field review" description="Values were extracted; correct them in the review form." />
                ) : (
                  <ApiForm
                    action={`/api/instruments/${id}/manual-values`}
                    submitLabel="Save manual values"
                    successMessage="Manual values saved and marked as user-entered."
                    confirmText="Save these manually entered values?"
                    redirectTo={`/instruments/${id}`}
                    note="Provenance will be USER; no OCR output is implied."
                  >
                    <div className="form-grid">
                      {ALL_CONFIRMATION_FIELDS.map((name) => (
                        <div className="field" key={name}>
                          <label htmlFor={`field-${name}`}>{fieldLabel(name)}</label>
                          <FieldInput
                            name={name}
                            defaultValue={valueFor(name, fieldsByName.get(name), instrument)}
                          />
                        </div>
                      ))}
                    </div>
                    <Notice tone="quiet" title="Evidence limit">
                      Manual entry records what the institution says. It does not verify the
                      document or the FDR with a bank.
                    </Notice>
                  </ApiForm>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHead title="Document integrity" description="Digest recorded at upload." />
            <CardBody>
              <div className="mono tiny" style={{ overflowWrap: "anywhere", color: "var(--muted)" }}>
                {document.sha256}
              </div>
              <div className="tiny muted" style={{ marginTop: 8 }}>
                Uploaded {formatDate(document.createdAt)} · {document.mime} · version{" "}
                {document.versionNo}
              </div>
              <div className="tiny muted" style={{ marginTop: 8 }}>
                Status: {DOC_STATUS.CONFIRMED} only after this review is saved. The digest proves
                byte integrity, not authenticity.
              </div>
              <div className="small" style={{ marginTop: 10 }}>
                Record amount: {formatMoney(instrument.amount)}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
