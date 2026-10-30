export type RuleSeed = {
  code: string;
  title: string;
  description: string;
  sourceTitle: string;
  clause: string;
  page: string;
  interpretation: string;
  applicability: string;
  status: "PENDING_CONFIRMATION";
};

export const SOURCE_TITLE =
  "AICTE Approval Process Handbook 2024–2027 (public reference copy; applicability and amendments unconfirmed)";

export const RULE_SEEDS: RuleSeed[] = [
  {
    code: "REG-001",
    title: "Deposit amount by programme and level",
    description:
      "Table 1.4 lists deposit amounts by programme and level, with a note about private leased land/building.",
    sourceTitle: SOURCE_TITLE,
    clause: "Clause 1.12 / Table 1.4",
    page: "printed p. 10",
    interpretation:
      "The table may set required deposit amounts, doubled for private leased land/building. Exact applicability has not been validated.",
    applicability:
      "Depends on institution category, programme, level and property circumstances.",
    status: "PENDING_CONFIRMATION",
  },
  {
    code: "REG-002",
    title: "Exemption for a defined category of institutions",
    description:
      "Clause 1.12(i) describes an exemption for a specified category of existing institutions.",
    sourceTitle: SOURCE_TITLE,
    clause: "Clause 1.12(i)",
    page: "printed p. 10",
    interpretation:
      "Certain existing institutions may be exempt. Eligibility and evidence requirements are not confirmed.",
    applicability: "Case-specific; requires evidence and authorized review.",
    status: "PENDING_CONFIRMATION",
  },
  {
    code: "REG-003",
    title: "Deposit term and term-start basis",
    description:
      "Clause 1.12(iv) refers to a ten-year term; Affidavit 6 mentions 8/10-year cases.",
    sourceTitle: SOURCE_TITLE,
    clause: "Clause 1.12(iv); Affidavit 6",
    page: "printed p. 10; p. 192",
    interpretation:
      "Term length and start-date basis vary by case. The prototype must not hard-code one duration.",
    applicability: "Case-specific.",
    status: "PENDING_CONFIRMATION",
  },
  {
    code: "REG-004",
    title: "Extension considered case by case",
    description: "Clause 1.12(v) allows extension on a case-by-case basis.",
    sourceTitle: SOURCE_TITLE,
    clause: "Clause 1.12(v)",
    page: "printed p. 10",
    interpretation:
      "Extension requires an authorized human decision. No automatic date change is permitted.",
    applicability: "Case-specific extension requests.",
    status: "PENDING_CONFIRMATION",
  },
  {
    code: "REG-005",
    title: "Release of deposit and required evidence",
    description:
      "Clause 6.46 describes release of Security Deposit, required documents and clearances.",
    sourceTitle: SOURCE_TITLE,
    clause: "Clause 6.46(a)–(d)",
    page: "printed pp. 61–62",
    interpretation:
      "Release evidence may include a request letter, Affidavit 6, FDR/payment proof, latest LoA/EoA and clearances. The exact current checklist is unconfirmed.",
    applicability: "Case-specific; FDR/RPGF and RTGS paths may differ.",
    status: "PENDING_CONFIRMATION",
  },
  {
    code: "REG-006",
    title: "Forfeiture under specified circumstances",
    description:
      "Clause 1.12(v) mentions possible forfeiture in specified circumstances.",
    sourceTitle: SOURCE_TITLE,
    clause: "Clause 1.12(v)",
    page: "printed p. 10",
    interpretation:
      "Forfeiture is never automatic and requires evidence plus competent-authority action.",
    applicability: "Case-specific; requires escalation.",
    status: "PENDING_CONFIRMATION",
  },
  {
    code: "REG-007",
    title: "Prior NOC and clearance requirements",
    description:
      "Clause 6.46 references PGRC, Vigilance and other clearances, NOC for FDR/RPGF and sanction order for RTGS.",
    sourceTitle: SOURCE_TITLE,
    clause: "Clause 1.12(iii); Clause 6.46",
    page: "printed pp. 10, 61–62",
    interpretation:
      "NOC issuer, reference, scope and validity must be recorded. An upload alone does not establish a valid clearance.",
    applicability: "Case-specific.",
    status: "PENDING_CONFIRMATION",
  },
  {
    code: "REG-008",
    title: "Special release cases",
    description:
      "Clause 6.46 includes conditions for embezzlement-related NOC, conversion to private/deemed university, progressive closure and merger.",
    sourceTitle: SOURCE_TITLE,
    clause: "Clause 6.46(e), (g)–(i)",
    page: "printed pp. 61–62",
    interpretation:
      "Special case types may require extra clearances. They must be labelled illustrative until an approved template exists.",
    applicability: "Only specified case types.",
    status: "PENDING_CONFIRMATION",
  },
];
