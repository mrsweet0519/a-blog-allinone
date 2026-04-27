import { ExternalLink, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteDraft, loadDrafts } from "../lib/localDrafts.js";

const formatDate = (value) =>
  new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));

export default function Storage() {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState(loadDrafts);
  const [query, setQuery] = useState("");

  const filteredDrafts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return drafts;

    return drafts.filter((draft) =>
      [draft.title, draft.keyword, draft.summary]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [drafts, query]);

  const removeDraft = (draftId) => {
    const ok = window.confirm("이 초안을 보관함에서 삭제할까요?");
    if (!ok) return;

    setDrafts(deleteDraft(draftId));
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-coral">로컬 초안</p>
        <h2 className="mt-1 text-3xl font-bold tracking-normal">내 보관함</h2>
      </header>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <label className="flex min-h-11 items-center gap-2 rounded-md border border-line bg-paper px-3">
          <Search size={18} className="text-ink/50" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            placeholder="제목 또는 키워드 검색"
          />
        </label>

        <div className="mt-5 grid gap-3">
          {filteredDrafts.map((draft) => (
            <article key={draft.id} className="rounded-lg border border-line bg-paper p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-moss">{draft.keyword || "키워드 없음"}</p>
                  <h3 className="mt-1 text-lg font-bold">{draft.title}</h3>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-ink/55">
                    {draft.selectedTopic && (
                      <span className="rounded-md bg-white px-2 py-1">주제: {draft.selectedTopic}</span>
                    )}
                    {draft.targetLength && (
                      <span className="rounded-md bg-white px-2 py-1">목표: {draft.targetLength}자</span>
                    )}
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink/65">{draft.summary}</p>
                  <time className="mt-3 block text-xs font-semibold text-ink/50">
                    {formatDate(draft.updatedAt)}
                  </time>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => navigate("/maker", { state: { draftId: draft.id } })}
                    className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white transition hover:bg-[#456b61]"
                  >
                    <ExternalLink size={16} aria-hidden="true" />
                    열기
                  </button>
                  <button
                    type="button"
                    onClick={() => removeDraft(draft.id)}
                    className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-coral hover:text-coral"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    삭제
                  </button>
                </div>
              </div>
            </article>
          ))}

          {filteredDrafts.length === 0 && (
            <div className="grid min-h-[260px] place-items-center rounded-lg border border-dashed border-line bg-paper text-sm text-ink/60">
              보관된 초안이 없습니다.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
