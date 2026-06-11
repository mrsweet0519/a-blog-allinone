import { Archive, FilePlus2, ListChecks, WandSparkles } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { mvpScope } from "@shared/mvpConfig.js";
import { loadDrafts } from "../lib/localDrafts.js";

const formatDate = (value) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));

export default function Dashboard() {
  const navigate = useNavigate();
  const drafts = loadDrafts();

  const stats = useMemo(() => {
    const todayKey = new Date().toDateString();
    const todayCount = drafts.filter((draft) => new Date(draft.updatedAt).toDateString() === todayKey).length;

    return [
      { label: "전체 초안", value: drafts.length, icon: Archive },
      { label: "오늘 작업", value: todayCount, icon: ListChecks },
      { label: "MVP 기능", value: mvpScope.included.length, icon: WandSparkles }
    ];
  }, [drafts]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-coral">1차 MVP</p>
          <h2 className="mt-1 text-3xl font-bold tracking-normal">대시보드</h2>
        </div>
        <button
          type="button"
          onClick={() => navigate("/product-review-maker")}
          className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-moss px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-[#456b61]"
        >
          <FilePlus2 size={18} aria-hidden="true" />
          후기글 만들기
        </button>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        {stats.map((stat) => {
          const Icon = stat.icon;

          return (
            <article key={stat.label} className="rounded-lg border border-line bg-white p-5 shadow-soft">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink/65">{stat.label}</p>
                <Icon size={20} className="text-moss" aria-hidden="true" />
              </div>
              <p className="mt-4 text-3xl font-bold">{stat.value}</p>
            </article>
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold">최근 초안</h3>
            <button
              type="button"
              onClick={() => navigate("/storage")}
              className="focus-ring rounded-md border border-line px-3 py-2 text-sm font-semibold transition hover:border-moss hover:text-moss"
            >
              보관함
            </button>
          </div>

          <div className="mt-4 divide-y divide-line">
            {drafts.slice(0, 5).map((draft) => (
              <button
                type="button"
                key={draft.id}
                onClick={() => navigate("/maker", { state: { draftId: draft.id } })}
                className="focus-ring block w-full py-4 text-left transition hover:text-moss"
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-semibold">{draft.title}</p>
                  <time className="text-sm text-ink/55">{formatDate(draft.updatedAt)}</time>
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink/65">{draft.summary}</p>
              </button>
            ))}

            {drafts.length === 0 && (
              <div className="py-10 text-center text-sm text-ink/60">
                저장된 초안이 없습니다.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-lg font-bold">이번 범위</h3>
          <div className="mt-4 space-y-2">
            {mvpScope.included.map((item) => (
              <div key={item} className="flex items-center gap-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-moss" aria-hidden="true" />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-sm font-semibold text-ink/65">미구현</p>
            <div className="mt-3 space-y-2">
              {mvpScope.excluded.map((item) => (
                <div key={item} className="flex items-center gap-2 text-sm text-ink/65">
                  <span className="h-2 w-2 rounded-full bg-coral" aria-hidden="true" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
