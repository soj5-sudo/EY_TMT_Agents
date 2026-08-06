import { SectorTracker } from "@/components/dashboards/SectorTracker";
import { TRACKER_TAKEN_AT } from "@/lib/data/sector-tracker";
import { PEER_TAKEN_AT } from "@/lib/data/peer-universe";

export const metadata = {
  title: "IT services tracker",
};

/**
 * The two read dates are handed down from the server rather than fetched,
 * because they are properties of the generated files themselves. A reader has
 * to be able to see how old this record is even while the request is in
 * flight, and neither constant needs the dataset shipped to the browser.
 */
export default function TrackerPage() {
  return <SectorTracker trackerTakenAt={TRACKER_TAKEN_AT} peerTakenAt={PEER_TAKEN_AT} />;
}
