"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

type ApiError = {
  code?: string;
  message?: string;
  details?: { issue: string }[];
};

export function UploadForm({ action }: { action: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string>("");
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError({ message: "Choose a PDF, JPG or PNG file to upload." });
      return;
    }
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(action, { method: "POST", body: data });
      const body = (await response.json().catch(() => null)) as
        | { error?: ApiError; document?: { versionNo: number } }
        | null;
      if (!response.ok) {
        setError(body?.error ?? { message: "The upload failed." });
        return;
      }
      setSuccess(
        `Document v${body?.document?.versionNo ?? ""} stored privately with a SHA-256 digest.`,
      );
      setFileLabel("");
      formRef.current?.reset();
      router.refresh();
    } catch {
      setError({ message: "Network error while uploading." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} className="form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="file">FDR document (PDF, JPG or PNG, max 10 MB)</label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          onChange={(event) => setFileLabel(event.target.files?.[0]?.name ?? "")}
        />
        <span className="field__hint">
          {fileLabel || "Stored outside public assets; served only to authorized roles."}
        </span>
      </div>
      {error ? (
        <div className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
          {error.code ? <span className="form-error__code">{error.code}</span> : null}
          {error.message}
          {error.details?.length ? (
            <ul>
              {error.details.map((detail, index) => (
                <li key={index}>{detail.issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {success ? (
        <div className="form-success" role="status">
          {success}
        </div>
      ) : null}
      <div className="btn-row">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Uploading…" : "Upload document"}
        </button>
        <span className="form-note">Type, size and magic bytes are checked server-side.</span>
      </div>
    </form>
  );
}
