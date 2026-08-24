import { SectorTracker } from "@/components/dashboards/SectorTracker";
import { TRACKER_TAKEN_AT } from "@/lib/data/sector-tracker";
import { PEER_TAKEN_AT } from "@/lib/data/peer-universe";

export const metadata = {
  title: "IT services tracker",
};

export default function TrackerPage() {
  return <SectorTracker trackerTakenAt={TRACKER_TAKEN_AT} peerTakenAt={PEER_TAKEN_AT} />;
}
