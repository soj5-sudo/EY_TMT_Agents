import { cached } from "@/lib/core/cache";
import {
  IR_SOURCES,
  irSourceFor,
  parseIrQuarter,
  type IrDocRef,
  type IrQuarter,
} from "@/lib/feeds/ir-parse";
import { IR_SNAPSHOT, IR_SNAPSHOT_TAKEN } from "@/lib/data/ir-snapshot";
import { fetchBuffer, safeFetch } from "@/lib/core/fetcher";
import { extractPdfText, PdfParseError } from "@/lib/pdf/extract";
import type { Envelope, Provenance } from "@/lib/core/types";
import { nowIso } from "@/lib/core/types";

const DOC_TTL_MS = 12 * 60 * 60 * 1000;
const HISTORY_TTL_MS = 6 * 60 * 60 * 1000;

export interface IrProfile {
  symbol: string;
  name: string;
  irUrl: string;
  quarters: IrQuarter[];
  attempts: Array<{ label: string; ok: boolean; reason: string | null }>;
}

async function fetchQuarter(ref: IrDocRef): Promise<IrQuarter | null> {
  const res = await cached(`ir:doc:${ref.url}`, DOC_TTL_MS, async () => {
    const bytes = await fetchBuffer(ref.url, {
      timeoutMs: 25000,
      retries: 0,
      maxBytes: 25 * 1024 * 1024,
    });
    const extracted = extractPdfText(bytes);
    return parseIrQuarter(extracted.lines, ref);
  });
  return res.value;
}

export async function getIrHistory(
  symbol: string,
  count = 8,
): Promise<Envelope<IrProfile> | null> {
  const source = irSourceFor(symbol);
  if (!source) return null;

  const res = await cached(`ir:history:${symbol}:${count}`, HISTORY_TTL_MS, async () => {
    const refs = source.build(new Date(), count);
    const quarters: IrQuarter[] = [];
    const attempts: IrProfile["attempts"] = [];

    for (const ref of refs) {
      try {
        const q = await fetchQuarter(ref);
        if (q && q.confidence >= 0.4) {
          quarters.push(q);
          attempts.push({ label: ref.label, ok: true, reason: null });
        } else {
          attempts.push({
            label: ref.label,
            ok: false,
            reason: q
              ? `Parsed but only ${Math.round(q.confidence * 100)} percent of expected fields were recovered`
              : "No content returned",
          });
        }
      } catch (err) {
        attempts.push({
          label: ref.label,
          ok: false,
          reason:
            err instanceof PdfParseError
              ? `Document unreadable: ${err.message}`
              : err instanceof Error
                ? err.message
                : String(err),
        });
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    quarters.reverse();

    return {
      symbol: source.symbol,
      name: source.name,
      irUrl: source.irUrl,
      quarters,
      attempts,
    } satisfies IrProfile;
  });

  if (res.value.quarters.length === 0) {
    const snap = IR_SNAPSHOT[symbol];
    if (snap && snap.quarters.length > 0) {
      const blocked = res.value.attempts.some((a) =>
        (a.reason ?? "").includes("403"),
      );
      return {
        data: {
          symbol,
          name: snap.name,
          irUrl: snap.irUrl,
          quarters: snap.quarters,
          attempts: res.value.attempts,
        },
        provenance: {
          kind: "baseline",
          source: `${snap.name} investor relations, quarterly fact sheets`,
          url: snap.irUrl,
          retrievedAt: IR_SNAPSHOT_TAKEN,
          note:
            `${snap.quarters.length} quarters parsed from the published documents on ${IR_SNAPSHOT_TAKEN}. ` +
            (blocked
              ? "The publisher refuses requests from this host's network, so a live fetch is not possible from the deployment."
              : "A live fetch did not succeed on this request."),
        },
      };
    }
  }

  return {
    data: res.value,
    provenance: {
      kind: res.value.quarters.length > 0 ? "filing" : "unavailable",
      source: `${source.name} investor relations, quarterly fact sheets`,
      url: source.irUrl,
      retrievedAt: new Date(res.storedAt).toISOString(),
      note:
        res.value.quarters.length > 0
          ? `${res.value.quarters.length} of ${res.value.attempts.length} candidate documents parsed.`
          : `No document could be read. ${res.value.attempts
              .slice(0, 3)
              .map((a) => `${a.label}: ${a.reason}`)
              .join("; ")}`,
    },
  };
}

export async function probeIrDocument(url: string): Promise<boolean> {
  try {
    const res = await safeFetch(url, { timeoutMs: 8000, retries: 0 });
    const type = res.headers.get("content-type") ?? "";
    await res.arrayBuffer();
    return type.includes("pdf");
  } catch {
    return false;
  }
}

export { nowIso };
