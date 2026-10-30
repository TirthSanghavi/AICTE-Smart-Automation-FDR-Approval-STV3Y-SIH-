import { ApiForm } from "./ApiForm";

export type InstrumentDefaults = {
  bankName?: string;
  branch?: string | null;
  fdrNumber?: string;
  ifscCode?: string;
  amount?: string;
  issueDate?: string;
  maturityDate?: string;
  holderName?: string;
  declaredLienStatus?: string;
};

export function InstrumentFields({ defaults }: { defaults?: InstrumentDefaults }) {
  return (
    <>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="bankName">Bank name</label>
          <input
            id="bankName"
            name="bankName"
            type="text"
            required
            maxLength={160}
            defaultValue={defaults?.bankName ?? ""}
            placeholder="e.g. Demo Cooperative Bank"
          />
        </div>
        <div className="field">
          <label htmlFor="branch">Branch (optional)</label>
          <input
            id="branch"
            name="branch"
            type="text"
            maxLength={120}
            defaultValue={defaults?.branch ?? ""}
            placeholder="e.g. Pune Camp"
          />
        </div>
        <div className="field">
          <label htmlFor="fdrNumber">FDR number</label>
          <input
            id="fdrNumber"
            name="fdrNumber"
            type="text"
            required
            maxLength={80}
            defaultValue={defaults?.fdrNumber ?? ""}
            placeholder="e.g. SYN-FDR-100248"
          />
        </div>
        <div className="field">
          <label htmlFor="ifscCode">IFSC (optional)</label>
          <input
            id="ifscCode"
            name="ifscCode"
            type="text"
            maxLength={11}
            defaultValue={defaults?.ifscCode ?? ""}
            placeholder="HDFC0001234"
            style={{ textTransform: "uppercase" }}
          />
          <span className="field__hint">
            Format check only (4 letters, 0, 5 alphanumeric). No live RBI/bank directory
            lookup exists in this prototype.
          </span>
        </div>
        <div className="field">
          <label htmlFor="amount">Deposit amount (INR)</label>
          <input
            id="amount"
            name="amount"
            type="text"
            inputMode="decimal"
            required
            defaultValue={defaults?.amount ?? ""}
            placeholder="3500000.00"
          />
          <span className="field__hint">Up to two decimals. Stored as a fixed-precision decimal.</span>
        </div>
        <div className="field">
          <label htmlFor="issueDate">Issue date</label>
          <input
            id="issueDate"
            name="issueDate"
            type="date"
            required
            defaultValue={defaults?.issueDate ?? ""}
          />
        </div>
        <div className="field">
          <label htmlFor="maturityDate">Maturity date</label>
          <input
            id="maturityDate"
            name="maturityDate"
            type="date"
            required
            defaultValue={defaults?.maturityDate ?? ""}
          />
        </div>
        <div className="field">
          <label htmlFor="holderName">Holder name on FDR</label>
          <input
            id="holderName"
            name="holderName"
            type="text"
            required
            maxLength={200}
            defaultValue={defaults?.holderName ?? ""}
            placeholder="Registered institution / trust name"
          />
        </div>
        <div className="field">
          <label htmlFor="declaredLienStatus">Lien declared</label>
          <select
            id="declaredLienStatus"
            name="declaredLienStatus"
            defaultValue={defaults?.declaredLienStatus ?? "UNKNOWN"}
          >
            <option value="UNKNOWN">Unknown</option>
            <option value="YES">Yes — declared</option>
            <option value="NO">No</option>
          </select>
          <span className="field__hint">
            A declaration is not a bank-confirmed lien status.
          </span>
        </div>
      </div>
      <div className="form-note">
        The server derives institution scope from your session; it ignores any institution ID in
        the request. Amount guidance from regulatory tables is disabled until an approved rule
        version exists.
      </div>
    </>
  );
}

export function InstrumentForm({
  action,
  method = "POST",
  submitLabel,
  defaults,
  expectedVersion,
  redirectTo,
  redirectFromResponse,
}: {
  action: string;
  method?: "POST" | "PATCH";
  submitLabel: string;
  defaults?: InstrumentDefaults;
  expectedVersion?: number;
  redirectTo?: string;
  redirectFromResponse?: { path: string; base: string };
}) {
  return (
    <ApiForm
      action={action}
      method={method}
      submitLabel={submitLabel}
      successMessage="Record saved. Document evidence is still required before submission."
      redirectTo={redirectTo}
      redirectFromResponse={redirectFromResponse}
      note="Draft records are editable until submitted."
    >
      {expectedVersion !== undefined ? (
        <input type="hidden" name="expectedVersion" value={expectedVersion} />
      ) : null}
      <InstrumentFields defaults={defaults} />
    </ApiForm>
  );
}
