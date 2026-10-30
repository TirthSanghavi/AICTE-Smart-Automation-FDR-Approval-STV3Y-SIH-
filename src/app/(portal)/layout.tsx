import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { navFor } from "@/lib/nav";
import { ROLE_LABEL, SYNTHETIC_BANNER } from "@/lib/constants";
import { getDemoState } from "@/lib/demo-clock";
import { formatDate } from "@/lib/dates";
import { NavLinks } from "@/components/NavLinks";
import { LogoutButton } from "@/components/LogoutButton";
import { Initials } from "@/components/ui";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const items = navFor(user.role);
  const clock = await getDemoState();

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Security Deposit Register home">
          <span className="brand__seal">SD</span>
          <span>
            <span className="brand__name">Security Deposit Register</span>
            <span className="brand__sub">AICTE · synthetic prototype</span>
          </span>
        </Link>

        <div>
          <div className="nav-group__label">Workspace</div>
          <NavLinks items={items} />
        </div>

        <div className="sidebar__footer">
          <div style={{ marginBottom: 12 }}>
            Local demonstration build. No live AICTE, bank, identity or payment integration.
          </div>
          {clock.frozen ? (
            <div style={{ color: "rgba(255,255,255,0.72)" }}>
              Clock frozen: {formatDate(clock.demoDate!)}
            </div>
          ) : (
            <div>Clock: live (IST)</div>
          )}
        </div>

        <div className="sidebar__user">
          <Initials name={user.name} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="sidebar__user-name">{user.name}</div>
            <div className="sidebar__user-role">{ROLE_LABEL[user.role]}</div>
          </div>
          <LogoutButton />
        </div>
      </aside>

      <div>
        <div className="banner">
          <div className="banner__left">
            <span className="banner__dot" aria-hidden="true" />
            {SYNTHETIC_BANNER}
          </div>
          <div className="banner__right">
            <span>Prototype · no legal effect</span>
            <span>IST · Asia/Kolkata</span>
          </div>
        </div>
        <main id="main-content" className="content" tabIndex={-1}>
          {children}
        </main>
        <footer className="app-footer">
          <span>
            Security Deposit Register · local SIH prototype · documents and responses are
            simulated.
          </span>
          <span>
            Rules remain <span className="mono">PENDING_CONFIRMATION</span> unless an
            authorized version is active.
          </span>
        </footer>
      </div>
    </div>
  );
}
