"use client";

import { useEffect, useState } from "react";
import { apiRequest, userMessageForError, withCursor } from "@/lib/client/api";
import type { PageResult, PublicReporterReport } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/status";

export function ReportsPage() {
  const [items, setItems] = useState<PublicReporterReport[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(nextCursor: string | null, append: boolean) {
    setLoading(!append);
    setError(null);
    try {
      const result = await apiRequest<PageResult<PublicReporterReport>>(
        withCursor("/api/reports/mine", nextCursor),
      );
      setItems((current) => (append ? [...current, ...result.items] : result.items));
      setCursor(result.nextCursor);
    } catch (caught) {
      setError(userMessageForError(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(null, false);
  }, []);

  if (loading && items.length === 0) {
    return <Skeleton label="Loading reports" />;
  }
  if (error && items.length === 0) {
    return <ErrorState message={error} onRetry={() => void load(null, false)} />;
  }

  return (
    <div className="stack">
      <h1>Your reports</h1>
      {items.length === 0 ? (
        <EmptyState title="No reports" description="Reports you submit will appear here with their status." />
      ) : (
        <ul className="stack list-reset">
          {items.map((report) => (
            <li key={report.id}>
              <Card>
                <p>
                  {report.targetType} · {report.reason}
                </p>
                <p className="muted">Status: {report.status}</p>
                {report.explanation ? <p className="wrap">{report.explanation}</p> : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <Button variant="secondary" onClick={() => void load(cursor, true)}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}
