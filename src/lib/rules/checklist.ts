import { ROLE } from "../constants";

export const CHECKLIST_VERSION = "illustrative-v1";
export const CHECKLIST_LABEL =
  "ILLUSTRATIVE SAMPLE — not an official AICTE sequence";

export type TaskTemplate = {
  stepOrder: number;
  role: string;
  title: string;
  description: string;
  required: boolean;
};

const COMMON: TaskTemplate[] = [
  {
    stepOrder: 1,
    role: ROLE.INSTITUTION_ADMIN,
    title: "Request letter and affidavit on file",
    description:
      "Confirm the release request letter and Affidavit 6 are attached to the case. Document names are illustrative and unconfirmed.",
    required: true,
  },
  {
    stepOrder: 2,
    role: ROLE.SCRUTINY_OFFICER,
    title: "FDR and payment evidence checked",
    description:
      "Compare the latest FDR, payment proof and LoA/EoA against the instrument record.",
    required: true,
  },
  {
    stepOrder: 3,
    role: ROLE.DEPT_REVIEWER,
    title: "PGRC clearance recorded",
    description:
      "Record the PGRC clearance issuer, reference and scope in the clearance section. A recorded clearance is not independently verified here.",
    required: true,
  },
  {
    stepOrder: 4,
    role: ROLE.DEPT_REVIEWER,
    title: "Vigilance NOC recorded",
    description:
      "Record the Vigilance NOC issuer, reference and scope. Step names and ordering are illustrative, not an official routing sequence.",
    required: true,
  },
  {
    stepOrder: 5,
    role: ROLE.SCRUTINY_OFFICER,
    title: "Outstanding conditions and evidence reviewed",
    description:
      "Check that every required document and clearance has a recorded, in-scope reference before the case goes to the authority.",
    required: true,
  },
];

const EXTENSION: TaskTemplate[] = [
  {
    stepOrder: 1,
    role: ROLE.INSTITUTION_ADMIN,
    title: "Extension request and justification on file",
    description:
      "Confirm the extension request, prior term basis and supporting evidence are attached. No extension is automatic.",
    required: true,
  },
  {
    stepOrder: 2,
    role: ROLE.SCRUTINY_OFFICER,
    title: "Term basis reviewed",
    description:
      "Confirm the recorded term basis and source. The applicable term length and start date remain unconfirmed in this prototype.",
    required: true,
  },
];

export function checklistFor(caseType: string): TaskTemplate[] {
  if (caseType === "EXTENSION") return EXTENSION;
  return COMMON;
}

export function checklistSatisfied(
  tasks: { required: boolean; status: string; outcome: string | null }[],
): { complete: boolean; missing: string[] } {
  const missing = tasks
    .filter(
      (task) =>
        task.required &&
        !(task.status === "COMPLETED" && task.outcome === "SATISFIED"),
    )
    .map((task) => task.status);
  return { complete: missing.length === 0, missing };
}
