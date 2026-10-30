import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LIFECYCLE, ROLE } from "@/lib/constants";
import { toIsoDate } from "@/lib/dates";
import { InstrumentForm } from "@/components/InstrumentForm";
import { Card, CardBody, CardHead, Notice, PageHead } from "@/components/ui";

export default async function EditInstrumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (user.role !== ROLE.INSTITUTION_ADMIN) redirect("/instruments");
  const { id } = await params;
  const instrument = await prisma.instrument.findFirst({
    where: { id, institutionId: user.institutionId ?? "__none__" },
  });
  if (!instrument) notFound();
  if (![LIFECYCLE.DRAFT, LIFECYCLE.CORRECTION_REQUESTED].includes(instrument.lifecycleStatus as never)) {
    redirect(`/instruments/${id}`);
  }

  return (
    <>
      <PageHead
        eyebrow="Edit draft"
        title={instrument.fdrNumber}
        description="Saving creates a new record version. Previous versions and uploaded evidence are retained."
        actions={<Link href={`/instruments/${id}`} className="btn btn--ghost">Cancel</Link>}
      />
      <div className="split">
        <Card>
          <CardHead title="Record details" description={`Current version ${instrument.versionNo}. A stale save returns a version conflict.`} />
          <CardBody>
            <InstrumentForm
              action={`/api/instruments/${id}`}
              method="PATCH"
              submitLabel="Save new version"
              expectedVersion={instrument.versionNo}
              redirectTo={`/instruments/${id}`}
              defaults={{
                bankName: instrument.bankName,
                branch: instrument.branch,
                fdrNumber: instrument.fdrNumber,
                ifscCode: instrument.ifscCode ?? "",
                amount: instrument.amount.toString(),
                issueDate: toIsoDate(instrument.issueDate),
                maturityDate: toIsoDate(instrument.maturityDate),
                holderName: instrument.holderName,
                declaredLienStatus: instrument.declaredLienStatus,
              }}
            />
          </CardBody>
        </Card>
        <Notice tone="quiet" title="Evidence stays intact">
          Editing metadata does not replace uploaded documents. If the document itself needs
          correction, upload a new version after the officer requests it.
        </Notice>
      </div>
    </>
  );
}
