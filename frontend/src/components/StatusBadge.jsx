import { makerStatuses } from "@shared/mvpConfig.js";

const statusClassName = {
  idle: "border-line bg-white text-ink/70",
  ready: "border-moss/25 bg-moss/10 text-moss",
  generating: "border-amber/35 bg-amber/15 text-[#7a5a1e]",
  generated: "border-moss/30 bg-moss/10 text-moss",
  editing: "border-coral/30 bg-coral/10 text-coral",
  saved: "border-moss/30 bg-moss/10 text-moss",
  copied: "border-amber/35 bg-amber/15 text-[#7a5a1e]"
};

export default function StatusBadge({ status }) {
  return (
    <span
      className={`inline-flex min-h-8 items-center rounded-md border px-3 text-sm font-semibold ${
        statusClassName[status] ?? statusClassName.idle
      }`}
    >
      {makerStatuses[status] ?? makerStatuses.idle}
    </span>
  );
}
