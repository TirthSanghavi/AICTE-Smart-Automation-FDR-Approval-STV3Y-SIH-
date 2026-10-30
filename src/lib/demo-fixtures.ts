/** Builds a tiny valid single-page PDF containing synthetic lines. */
export function buildSyntheticPdf(lines: string[]): Buffer {
  const escape = (value: string) =>
    value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  const contentLines = ["BT", "/F1 10 Tf", "60 800 Td"];
  for (const line of lines) {
    contentLines.push(`(${escape(line)}) Tj`);
    contentLines.push("0 -16 Td");
  }
  contentLines.push("ET");
  const stream = contentLines.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

export const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);

export function syntheticFdrDocument(input: {
  institution: string;
  bank: string;
  fdrNumber: string;
  amount: string;
  issueDate: string;
  maturityDate: string;
  holder: string;
}): Buffer {
  return buildSyntheticPdf([
    "SYNTHETIC DEMONSTRATION DOCUMENT",
    "NOT A REAL BANK INSTRUMENT",
    "",
    `Institution : ${input.institution}`,
    `Bank        : ${input.bank}`,
    `FDR number  : ${input.fdrNumber}`,
    `Amount      : INR ${input.amount}`,
    `Issue date  : ${input.issueDate}`,
    `Maturity    : ${input.maturityDate}`,
    `Holder      : ${input.holder}`,
    "",
    "Generated for the AICTE FDR portal prototype. No legal effect.",
  ]);
}
