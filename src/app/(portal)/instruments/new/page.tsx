import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ROLE } from "@/lib/constants";
import { InstrumentForm } from "@/components/InstrumentForm";
import { Card, CardBody, CardHead, Notice, PageHead } from "@/components/ui";

export default async function NewInstrumentPage() {
  const user = await requireUser();
  if (user.role !== ROLE.INSTITUTION_ADMIN) redirect("/instruments");

  return (
    <>
      <PageHead
        eyebrow="New record · step 1 of 3"
        title="Open a draft FDR record."
        description="Enter the values as they appear on the instrument. You will attach the document and review extraction before submission."
        actions={<Link href="/instruments" className="btn btn--ghost">Cancel</Link>}
      />

      <div className="split">
        <Card>
          <CardHead
            title="Instrument details"
            description="Only the authenticated institution's scope is used; client-supplied institution IDs are ignored."
          />
          <CardBody>
            <InstrumentForm
              action="/api/instruments"
              submitLabel="Create draft"
              redirectFromResponse={{ path: "instrument.id", base: "/instruments" }}
            />
          </CardBody>
        </Card>

        <div className="stack">
          <Notice tone="warn" title="Trust boundary">
            A draft is institution self-reported data. Nothing on this screen is bank-confirmed or
            regulator-approved, and no deposit amount is suggested until an approved rule version
            exists.
          </Notice>
          <Notice tone="quiet" title="What happens next">
            1. Draft created · 2. Upload PDF/JPG/PNG and run mock extraction · 3. Confirm the
            fields, then submit for scrutiny. The server runs deterministic consistency checks on
            submission.
          </Notice>
        </div>
      </div>
    </>
  );
}
