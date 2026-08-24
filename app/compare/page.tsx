import { Benchmark } from "@/components/dashboards/Benchmark";
import { Compare } from "@/components/dashboards/Compare";
import { PageHeader, Stack } from "@/components/ui/Bits";

export const metadata = {
  title: "Compare",
};

export default function ComparePage() {
  return (
    <div className="shell">
      <PageHeader
        index="04"
        title="Compare"
        lede="Two or three companies on the same measures, on the same arithmetic, each on its own last reported period. Below that, one company against a named cohort, so a level can be read as a position rather than a number on its own."
      />

      <Stack gap={28}>
        <Compare />
        <Benchmark />
      </Stack>

      <div style={{ height: 64 }} />
    </div>
  );
}
