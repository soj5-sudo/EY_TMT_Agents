"use client";

import { useCallback, useState } from "react";

export interface ClientDocument {
  id: string;
  name: string;
  bytes: number;
  pages: number | null;
  characters: number;
  extracted: Array<{ label: string; value: string; context: string }>;
  addedAt: string;
}

const MAX_DOCS = 12;

export function useDocuments() {
  const [documents, setDocuments] = useState<ClientDocument[]>([]);

  const add = useCallback((incoming: ClientDocument[]) => {
    setDocuments((prev) => [...prev, ...incoming].slice(0, MAX_DOCS));
  }, []);

  const clear = useCallback(() => setDocuments([]), []);

  return { documents, add, clear };
}
