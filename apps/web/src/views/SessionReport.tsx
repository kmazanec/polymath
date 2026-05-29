import { type ReactElement } from 'react';
import { useParams } from 'react-router-dom';

/**
 * Session report view — mounted at `/session/:id/report`.
 *
 * Barrier placeholder: a real, routable component so the router array is exhaustive
 * and compiles. The summary workstream fills in the data fetch (`GET
 * /api/session/:id/report`, the `SessionSummary` tiles) and the view-scoped
 * stylesheet (`sessionReport.css`, consuming the global `var()` tokens).
 */
export function SessionReport(): ReactElement {
  const { id } = useParams<{ id: string }>();
  return (
    <main>
      <h1>Session report</h1>
      <p>Report for session {id ?? '(unknown)'} is not yet available.</p>
    </main>
  );
}
