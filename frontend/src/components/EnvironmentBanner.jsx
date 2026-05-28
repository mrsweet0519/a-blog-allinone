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

  return (
    <div className="mb-5 rounded-lg border border-line bg-white px-4 py-3 shadow-soft">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-paper text-moss">
            <Icon size={18} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink">{runtime.label}</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-ink/60">
              {isStaticBetaMode() ? STATIC_BETA_NOTICE : runtime.description}
            </p>
          </div>
        </div>
        <span className="inline-flex w-fit rounded-md bg-paper px-2.5 py-1 text-xs font-bold text-ink/55">
          {runtime.target}
        </span>
      </div>
    </div>
  );
}
