import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/components/LoginForm";
import { SYNTHETIC_BANNER } from "@/lib/constants";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <main className="login-shell">
      <section className="login-editorial">
        <div>
          <div className="login-brand">
            <span className="brand__seal">SD</span>
            <div>
              <div className="brand__name" style={{ color: "#f6efdf" }}>
                Security Deposit Register
              </div>
              <span className="brand__sub">AICTE · FDR lifecycle prototype</span>
            </div>
          </div>

          <h1 className="login-statement">
            A ledger for what the state holds in trust.
          </h1>
          <p className="login-lede">
            One register for FDR records, document evidence, explainable findings, maturity
            alerts and release cases. Extraction, consistency checks, independent
            confirmation and authorized decisions stay visibly separate.
          </p>

          <div className="login-rule">
            <div className="login-rule__item">
              <strong>01 · Record</strong>
              Institution-maintained FDR metadata with versioned evidence
            </div>
            <div className="login-rule__item">
              <strong>02 · Verify</strong>
              Simulated or manual confirmation, never silently “bank confirmed”
            </div>
            <div className="login-rule__item">
              <strong>03 · Decide</strong>
              Human checklist and reason, recorded in an append-only trail
            </div>
          </div>
        </div>

        <div className="login-rule__item" style={{ maxWidth: 420, letterSpacing: "0.1em" }}>
          {SYNTHETIC_BANNER}
          <br />
          Regulatory interpretations remain pending authorized confirmation.
        </div>
        <div className="login-seal" aria-hidden="true" />
      </section>

      <section className="login-panel">
        <LoginForm />
      </section>
    </main>
  );
}
