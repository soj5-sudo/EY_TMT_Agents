"use client";

import { useCallback, useEffect, useState } from "react";

export interface ClientDocument {
  id: string;
  name: string;
  bytes: number;
  pages: number | null;
  characters: number;
  extracted: Array<{ label: string; value: string; context: string }>;
  addedAt: string;
}

const KEY = "ey.documents.v1";
const MAX_DOCS = 12;

/**
 * Parsed documents live in the browser tab, not on the server.
 *
 * The server keeps nothing, so the tab is the only place they exist. Session
 * storage rather than local storage: confidential material should not outlive
 * the tab it was opened in.
 */
export function useDocuments() {
  const [documents, setDocuments] = useState<ClientDocument[]>([]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) setDocuments(JSON.parse(raw) as ClientDocument[]);
    } catch {
      // Corrupt or unavailable storage is not worth surfacing.
    }
  }, []);

  const persist = useCallback((next: ClientDocument[]) => {
    setDocuments(next);
    try {
      sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Over quota. The documents still work for this page view.
    }
  }, []);

  const add = useCallback(
    (incoming: ClientDocument[]) => {
      persist([...documents, ...incoming].slice(0, MAX_DOCS));
    },
    [documents, persist],
  );

  const clear = useCallback(() => {
    persist([]);
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      // Nothing to do.
    }
  }, [persist]);

  return { documents, add, clear };
}
