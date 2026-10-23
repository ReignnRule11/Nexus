"use client";

import { useState } from "react";
import { apiRequest, isApiError, userMessageForError } from "@/lib/client/api";
import type { PublicReporterReport } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { StatusMessage } from "@/components/ui/status";

const REASONS = [
  ["SPAM", "Spam"],
  ["HARASSMENT", "Harassment"],
  ["HATE_OR_ABUSIVE_CONTENT", "Hate or abusive content"],
  ["THREATS_OR_VIOLENCE", "Threats or violence"],
  ["IMPERSONATION", "Impersonation"],
  ["SEXUAL_CONTENT", "Sexual content"],
  ["SCAM_OR_FRAUD", "Scam or fraud"],
  ["PRIVACY_VIOLATION", "Privacy violation"],
  ["ILLEGAL_CONTENT", "Illegal content"],
  ["OTHER", "Other"],
] as const;

type ReportDialogProps = {
  open: boolean;
  onClose: () => void;
  targetType: "USER" | "POST" | "COMMENT" | "MESSAGE" | "COMMUNITY";
  targetId: string;
};

export function ReportDialog({ open, onClose, targetType, targetId }: ReportDialogProps) {
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>("SPAM");
  const [explanation, setExplanation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest<{ report: PublicReporterReport }>("/api/reports", {
        method: "POST",
        body: {
          targetType,
          targetId,
          reason,
          explanation: explanation.trim() ? explanation.trim() : undefined,
        },
      });
      setSuccess(true);
    } catch (caught) {
      if (isApiError(caught) && caught.code === "conflict") {
        setError("You already have an open report for this item.");
      } else {
        setError(userMessageForError(caught));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={open} title="Report" onClose={onClose}>
      {success ? (
        <div>
          <StatusMessage tone="success">Report submitted. Moderators will review it.</StatusMessage>
          <Button onClick={onClose}>Close</Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="stack">
          <Field id="report-reason" label="Reason" required>
            <Select
              id="report-reason"
              value={reason}
              onChange={(event) =>
                setReason(event.target.value as (typeof REASONS)[number][0])
              }
              required
            >
              {REASONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="report-explanation" label="Explanation" hint="Optional, up to 500 characters.">
            <Textarea
              id="report-explanation"
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
              maxLength={500}
              rows={4}
            />
          </Field>
          {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
          <div className="row">
            <Button type="submit" disabled={pending}>
              {pending ? "Submitting..." : "Submit report"}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
