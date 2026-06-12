import { Cloud, Server, Wifi } from "lucide-react";
import { getRuntimeInfo, isStaticBetaMode, STATIC_BETA_NOTICE } from "../lib/runtimeMode.js";

const iconByMode = {
  "static-beta": Cloud,
  render: Server,
  "local-bridge": Wifi
};

export default function EnvironmentBanner() {
  const runtime = getRuntimeInfo();
  const Icon = iconByMode[runtime.mode] || Cloud;
  const notice = isStaticBetaMode() ? STATIC_BETA_NOTICE : runtime.description;

  return (
    <details className="mb-4 rounded-md border border-line bg-white/85 px-3 py-2 text-sm shadow-[0_8px_22px_rgba(31,36,40,0.04)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-paper text-moss">
            <Icon size={15} aria-hidden="true" />
          </span>
          <span className="min-w-0 truncate font-bold text-ink">{runtime.label}</span>
        </span>
        <span className="inline-flex shrink-0 rounded-md bg-paper px-2 py-0.5 text-[11px] font-bold text-ink/55">
          {runtime.target}
        </span>
      </summary>
      <div className="mt-2 pl-9">
        <p className="text-xs font-semibold leading-5 text-ink/58">
          {notice}
        </p>
      </div>
    </details>
  );
}
