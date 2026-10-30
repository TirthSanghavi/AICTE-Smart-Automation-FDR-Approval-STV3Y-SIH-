import { AppError } from "./errors";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_UPLOAD_MIME = ["application/pdf", "image/jpeg", "image/png"] as const;

export type DetectedFile = {
  mime: (typeof ALLOWED_UPLOAD_MIME)[number];
  extension: "pdf" | "jpg" | "png";
};

export function detectFileType(bytes: Buffer): DetectedFile | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") {
    return { mime: "application/pdf", extension: "pdf" };
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { mime: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mime: "image/png", extension: "png" };
  }
  return null;
}

export function validateUpload(input: {
  fileName: string;
  declaredMime: string;
  bytes: Buffer;
}): DetectedFile {
  if (input.bytes.length === 0) {
    throw new AppError(422, "EMPTY_FILE", "The selected file is empty.");
  }
  if (input.bytes.length > MAX_UPLOAD_BYTES) {
    throw new AppError(
      413,
      "FILE_TOO_LARGE",
      "Upload a PDF, JPG or PNG up to 10 MB. This file is larger than 10 MB.",
    );
  }

  const detected = detectFileType(input.bytes);
  const declared = (input.declaredMime || "").toLowerCase();
  const declaredSupported =
    (ALLOWED_UPLOAD_MIME as readonly string[]).includes(declared) ||
    declared === "image/jpg" ||
    /\.(pdf|jpe?g|png)$/i.test(input.fileName);
  if (!detected) {
    throw new AppError(
      415,
      declaredSupported ? "FILE_CONTENT_TYPE_MISMATCH" : "FILE_TYPE_UNSUPPORTED",
      declaredSupported
        ? "Upload a PDF, JPG or PNG up to 10 MB. The file contents do not match its declared type."
        : "Upload a PDF, JPG or PNG up to 10 MB. The file contents do not match a supported type.",
    );
  }

  const mimeMatches =
    declared === detected.mime ||
    (detected.mime === "image/jpeg" && declared === "image/jpg");
  if (!mimeMatches) {
    throw new AppError(
      415,
      "FILE_CONTENT_TYPE_MISMATCH",
      "Upload a PDF, JPG or PNG up to 10 MB. The file contents do not match its declared type.",
    );
  }

  const extension = input.fileName.split(".").pop()?.toLowerCase() ?? "";
  const allowedExtensions =
    detected.extension === "jpg" ? ["jpg", "jpeg"] : [detected.extension];
  if (!allowedExtensions.includes(extension)) {
    throw new AppError(
      415,
      "FILE_CONTENT_TYPE_MISMATCH",
      "The filename extension does not match the file contents.",
    );
  }

  return detected;
}

export function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  return base.replace(/[\u0000-\u001f<>"]/g, "").slice(0, 180) || "document";
}
