import { ROLE, type Role } from "./constants";

export type NavItem = { href: string; label: string };

export function navFor(role: Role): NavItem[] {
  switch (role) {
    case ROLE.INSTITUTION_ADMIN:
      return [
        { href: "/", label: "Overview" },
        { href: "/institutions", label: "Institutions" },
        { href: "/reports", label: "Reports" },
        { href: "/instruments", label: "FDR records" },
        { href: "/cases", label: "Release cases" },
        { href: "/alerts", label: "Maturity alerts" },
        { href: "/rules", label: "Source register" },
      ];
    case ROLE.INSTITUTION_VIEWER:
      return [
        { href: "/", label: "Overview" },
        { href: "/institutions", label: "Institutions" },
        { href: "/reports", label: "Reports" },
        { href: "/instruments", label: "FDR records" },
        { href: "/cases", label: "Release cases" },
        { href: "/alerts", label: "Maturity alerts" },
        { href: "/rules", label: "Source register" },
      ];
    case ROLE.SCRUTINY_OFFICER:
      return [
        { href: "/", label: "Overview" },
        { href: "/queue", label: "Review queue" },
        { href: "/institutions", label: "Institutions" },
        { href: "/reports", label: "Reports" },
        { href: "/instruments", label: "FDR records" },
        { href: "/cases", label: "Release cases" },
        { href: "/alerts", label: "Maturity alerts" },
        { href: "/rules", label: "Source register" },
      ];
    case ROLE.DEPT_REVIEWER:
      return [
        { href: "/", label: "Overview" },
        { href: "/institutions", label: "Institutions" },
        { href: "/reports", label: "Reports" },
        { href: "/cases", label: "Release cases" },
      ];
    case ROLE.COMPETENT_AUTHORITY:
      return [
        { href: "/", label: "Overview" },
        { href: "/cases", label: "Release cases" },
        { href: "/institutions", label: "Institutions" },
        { href: "/reports", label: "Reports" },
        { href: "/instruments", label: "FDR records" },
        { href: "/alerts", label: "Maturity alerts" },
        { href: "/rules", label: "Source register" },
      ];
    case ROLE.AUDITOR:
      return [
        { href: "/", label: "Overview" },
        { href: "/audit", label: "Audit trail" },
        { href: "/institutions", label: "Institutions" },
        { href: "/reports", label: "Reports" },
        { href: "/instruments", label: "FDR records" },
        { href: "/cases", label: "Release cases" },
        { href: "/rules", label: "Source register" },
      ];
    case ROLE.SYSTEM_ADMIN:
      return [
        { href: "/", label: "Overview" },
        { href: "/institutions", label: "Institutions" },
        { href: "/reports", label: "Reports" },
        { href: "/rules", label: "Source register" },
        { href: "/audit", label: "Audit trail" },
        { href: "/alerts", label: "Maturity alerts" },
      ];
    default:
      return [{ href: "/", label: "Overview" }];
  }
}
