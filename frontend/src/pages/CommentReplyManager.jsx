import {
  Check,
  Clipboard,
  Copy,
  Link,
  ListChecks,
  MessageSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Trash2
} from "lucide-react";
import { useMemo, useState } from "react";
import { makerOptions, STORAGE_KEYS } from "@shared/mvpConfig.js";
import { isBackendApiEnabled, postBackend } from "../lib/backendApi.js";
import {
  createCommentCollectionBridge,
  createCommentReplyBatch,
  createCommentReplyForOne,
  createMainKeywordCandidates,
  normalizeComment,
  parseManualComments,
  resolveMainKeyword
} from "../lib/commentReplyGenerator.js";

const initialForm = {
  blogUrl: "",
  postTitle: "",
  mainKeyword: "",
  brandName: "",
  region: "",
  audienceType: "사업자/매장 홍보",
  tone: "친근한",
  forbiddenWords: "최고, 무조건, 보장",
  ctaTone: "",
  ownerNickname: "",
  ownerAliases: ""
};

const statusLabel = {
  idle: "입력 전",
  ready: "입력 완료",
  generating: "생성 중",
  generated: "생성 완료",
  saved: "저장됨",
  copied: "복사 완료"
};

const statusClassName = {
  "대기": "border-line bg-white text-ink/60",
  "생성 완료": "border-moss/30 bg-moss/10 text-moss",
  "검토 필요": "border-amber/40 bg-amber/15 text-[#7a5a1e]",
  "스킵 권장": "border-coral/30 bg-coral/10 text-coral"
};

const duplicateClassName = {
  "중복 위험 낮음": "bg-moss/10 text-moss",
  "중복 주의": "bg-amber/15 text-[#7a5a1e]",
  "재생성 권장": "bg-coral/10 text-coral"
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createEmptyComment = () => ({
  id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  author: "",
  content: "",
  source: "manual",
  hasOwnerReply: false,
  type: "",
  sentiment: "",
  intent: "",
  coreKeywords: [],
  reply: "",
  mainKeywordUsed: false,
  forbiddenWordsFound: [],
  duplicateRisk: "중복 위험 낮음",
  status: "대기",
  skipReason: "",
  reviewed: false
});

const loadStoredWork = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.commentReplies);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const normalizeStoredComments = (comments = []) => {
  const normalized = comments.map((comment, index) => ({
    ...normalizeComment(comment, index),
    reviewed: Boolean(comment.reviewed)
  }));

  return normalized.length > 0 ? normalized : [createEmptyComment()];
};

const withResolvedKeyword = (form) => ({
  ...form,
  mainKeyword: form.mainKeyword.trim() || resolveMainKeyword(form)
});

const requestCommentReplyApi = async (path, payload, fallback) => {
  if (!isBackendApiEnabled()) return fallback();

  try {
    return await postBackend(path, payload);
  } catch (error) {
    console.warn(error);
    return fallback();
  }
};

const toReplyListText = (comments) =>
  comments
    .filter((comment) => comment.reply)
    .map((comment) => `${comment.author || "작성자 미입력"}: ${comment.reply}`)
    .join("\n");

const toReplySetText = (comments) =>
  comments
    .filter((comment) => comment.content && (comment.reply || comment.status === "스킵 권장"))
    .map((comment, index) =>
      [
        `${index + 1}. 원댓글 작성자: ${comment.author || "작성자 미입력"}`,
        `원댓글: ${comment.content}`,
        comment.reply ? `대댓글: ${comment.reply}` : `상태: ${comment.skipReason || "스킵 권장"}`
      ].join("\n")
    )
    .join("\n\n");

export default function CommentReplyManager() {
  const storedWork = useMemo(loadStoredWork, []);
  const [form, setForm] = useState(() => ({
    ...initialForm,
    ...(storedWork?.form || {})
  }));
  const [comments, setComments] = useState(() => normalizeStoredComments(storedWork?.comments || []));
  const [manualInput, setManualInput] = useState("");
  const [status, setStatus] = useState(storedWork ? "saved" : "idle");
  const [message, setMessage] = useState(storedWork ? "저장된 댓글 응답 작업을 불러왔습니다." : "");

  const keywordCandidates = useMemo(() => createMainKeywordCandidates(form.postTitle), [form.postTitle]);
  const resolvedMainKeyword = useMemo(() => resolveMainKeyword(form), [form]);
  const ready = Boolean(form.blogUrl.trim() && form.postTitle.trim());
  const bridge = useMemo(createCommentCollectionBridge, []);
  const validComments = comments.filter((comment) => comment.content.trim());
  const generatedCount = comments.filter((comment) => comment.reply || comment.status === "스킵 권장").length;

  const updateForm = (key, value) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      setStatus(next.blogUrl.trim() && next.postTitle.trim() ? "ready" : "idle");
      return next;
    });
    setMessage("");
  };

  const updateComment = (id, key, value) => {
    setComments((current) =>
      current.map((comment) =>
        comment.id === id
          ? {
              ...comment,
              [key]: value,
              ...(key === "content" || key === "author"
                ? {
                    type: "",
                    sentiment: "",
                    intent: "",
                    coreKeywords: [],
                    reply: "",
                    mainKeywordUsed: false,
                    forbiddenWordsFound: [],
                    duplicateRisk: "중복 위험 낮음",
                    status: "대기",
                    skipReason: "",
                    reviewed: false
                  }
                : {})
            }
          : comment
      )
    );
    setMessage("");
  };

  const addComment = (comment = createEmptyComment()) => {
    setComments((current) => [...current, { ...createEmptyComment(), ...comment }]);
    setMessage("");
  };

  const removeComment = (id) => {
    const ok = window.confirm("이 댓글 카드를 삭제할까요?");
    if (!ok) return;

    setComments((current) => {
      const next = current.filter((comment) => comment.id !== id);
      return next.length > 0 ? next : [createEmptyComment()];
    });
  };

  const appendManualComments = () => {
    const parsed = parseManualComments(manualInput);

    if (parsed.length === 0) {
      setMessage("붙여넣은 댓글을 찾지 못했습니다.");
      return;
    }

    setComments((current) => [
      ...current.filter((comment) => comment.content.trim()),
      ...parsed.map((comment, index) => ({
        ...normalizeComment(comment, index),
        reviewed: false
      }))
    ]);
    setManualInput("");
    setStatus(ready ? "ready" : "idle");
    setMessage(`${parsed.length}개 댓글을 목록에 추가했습니다.`);
  };

  const generateAll = async ({ seed = 0 } = {}) => {
    if (!ready || validComments.length === 0) return;

    const formPayload = withResolvedKeyword(form);
    setStatus("generating");
    setMessage("");
    await wait(250);

    const data = await requestCommentReplyApi(
      "/api/comment-replies/generate",
      {
        form: formPayload,
        comments: validComments,
        options: { seed }
      },
      () => ({
        comments: createCommentReplyBatch(formPayload, validComments, { seed })
      })
    );
    const generatedMap = new Map((data.comments || []).map((comment) => [comment.id, comment]));

    setComments((current) =>
      current.map((comment) => {
        const generated = generatedMap.get(comment.id);
        return generated ? { ...comment, ...generated, reviewed: false } : comment;
      })
    );
    setStatus("generated");
    setMessage(`${data.comments?.length || 0}개 댓글의 대댓글 초안을 만들었습니다.`);
  };

  const generateOne = async (id, { regenerate = false } = {}) => {
    const target = comments.find((comment) => comment.id === id);
    if (!ready || !target?.content.trim()) return;

    const formPayload = withResolvedKeyword(form);
    const previousReplies = comments
      .filter((comment) => comment.id !== id && comment.reply)
      .map((comment) => comment.reply);
    const sequence = Math.max(0, comments.findIndex((comment) => comment.id === id));
    const seed = regenerate ? Date.now() % 11 : sequence;

    setStatus("generating");
    setMessage("");
    await wait(180);

    const data = await requestCommentReplyApi(
      "/api/comment-replies/generate-one",
      {
        form: formPayload,
        comment: target,
        previousReplies,
        options: { sequence, seed }
      },
      () => ({
        comment: createCommentReplyForOne(formPayload, target, previousReplies, { sequence, seed })
      })
    );

    setComments((current) =>
      current.map((comment) =>
        comment.id === id ? { ...comment, ...data.comment, reviewed: false } : comment
      )
    );
    setStatus("generated");
    setMessage(regenerate ? "대댓글을 다시 생성했습니다." : "대댓글 초안을 생성했습니다.");
  };

  const copyText = async (value, copiedMessage) => {
    if (!value.trim()) return;

    await navigator.clipboard.writeText(value);
    setStatus("copied");
    setMessage(copiedMessage);
  };

  const markSkip = (id) => {
    setComments((current) =>
      current.map((comment) =>
        comment.id === id
          ? {
              ...comment,
              reply: "",
              status: "스킵 권장",
              skipReason: "사용자 스킵",
              reviewed: false
            }
          : comment
      )
    );
  };

  const markReviewed = (id) => {
    setComments((current) =>
      current.map((comment) =>
        comment.id === id
          ? {
              ...comment,
              status: comment.status === "스킵 권장" ? "스킵 권장" : "생성 완료",
              reviewed: true
            }
          : comment
      )
    );
  };

  const saveWork = () => {
    const payload = {
      form,
      comments,
      updatedAt: new Date().toISOString()
    };

    localStorage.setItem(STORAGE_KEYS.commentReplies, JSON.stringify(payload));
    setStatus("saved");
    setMessage("댓글 응답 작업을 임시 저장했습니다.");
  };

  const loadWork = () => {
    const nextWork = loadStoredWork();

    if (!nextWork) {
      setMessage("저장된 댓글 응답 작업이 없습니다.");
      return;
    }

    setForm({ ...initialForm, ...(nextWork.form || {}) });
    setComments(normalizeStoredComments(nextWork.comments || []));
    setStatus("saved");
    setMessage("저장된 댓글 응답 작업을 불러왔습니다.");
  };

  const resetWork = () => {
    const ok = window.confirm("댓글 응답 관리 임시 저장과 현재 입력값을 초기화할까요?");
    if (!ok) return;

    localStorage.removeItem(STORAGE_KEYS.commentReplies);
    setForm(initialForm);
    setComments([createEmptyComment()]);
    setManualInput("");
    setStatus("idle");
    setMessage("댓글 응답 작업을 초기화했습니다.");
  };

  return (
    <div className="min-w-0 space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold text-coral">검토 후 등록 MVP</p>
          <h2 className="mt-1 text-3xl font-bold tracking-normal">댓글 응답 관리</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={statusLabel[status] || statusLabel.idle} status={status} />
          <span className="inline-flex min-h-8 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink/65">
            {generatedCount}/{comments.length} 처리
          </span>
        </div>
      </header>

      {message && (
        <p className="rounded-md border border-line bg-white px-4 py-3 text-sm font-semibold text-moss shadow-soft">
          {message}
        </p>
      )}

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(300px,340px)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold">입력값</h3>
            <span className="rounded-md bg-paper px-2.5 py-1 text-xs font-semibold text-ink/60">
              {ready ? "생성 가능" : "필수 입력 필요"}
            </span>
          </div>

          <div className="mt-5 space-y-5">
            <label className="block">
              <FieldLabel required>블로그 포스팅 URL</FieldLabel>
              <div className="mt-2 flex min-h-11 items-center gap-2 rounded-md border border-line bg-paper px-3">
                <Link size={17} className="text-ink/45" aria-hidden="true" />
                <input
                  value={form.blogUrl}
                  onChange={(event) => updateForm("blogUrl", event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  placeholder="https://blog.naver.com/..."
                />
              </div>
            </label>

            <label className="block">
              <FieldLabel required>포스팅 제목</FieldLabel>
              <input
                value={form.postTitle}
                onChange={(event) => updateForm("postTitle", event.target.value)}
                className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                placeholder="예: 강남 피부관리샵 리프팅 처음 방문 전 확인할 기준"
              />
            </label>

            <label className="block">
              <FieldLabel>메인 키워드</FieldLabel>
              <input
                value={form.mainKeyword}
                onChange={(event) => updateForm("mainKeyword", event.target.value)}
                className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                placeholder={resolvedMainKeyword ? `자동 사용: ${resolvedMainKeyword}` : "제목에서 자동 추출"}
              />
              {keywordCandidates.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {keywordCandidates.map((candidate) => (
                    <button
                      key={candidate}
                      type="button"
                      onClick={() => updateForm("mainKeyword", candidate)}
                      className="focus-ring rounded-md bg-moss/10 px-2.5 py-1 text-xs font-bold text-moss transition hover:bg-moss hover:text-white"
                    >
                      {candidate}
                    </button>
                  ))}
                </div>
              )}
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <FieldLabel>브랜드명/매장명</FieldLabel>
                <input
                  value={form.brandName}
                  onChange={(event) => updateForm("brandName", event.target.value)}
                  className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                  placeholder="예: 엠고컴퍼니"
                />
              </label>

              <label className="block">
                <FieldLabel>지역</FieldLabel>
                <input
                  value={form.region}
                  onChange={(event) => updateForm("region", event.target.value)}
                  className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                  placeholder="예: 서울 강남"
                />
              </label>
            </div>

            <fieldset>
              <legend>
                <FieldLabel>사용자 유형</FieldLabel>
              </legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {makerOptions.audienceTypes.map((audienceType) => (
                  <label
                    key={audienceType}
                    className={`flex min-h-10 cursor-pointer items-center justify-center rounded-md border px-3 text-center text-sm font-semibold transition ${
                      form.audienceType === audienceType
                        ? "border-coral bg-coral text-white"
                        : "border-line bg-paper hover:border-coral"
                    }`}
                  >
                    <input
                      type="radio"
                      name="replyAudienceType"
                      value={audienceType}
                      checked={form.audienceType === audienceType}
                      onChange={(event) => updateForm("audienceType", event.target.value)}
                      className="sr-only"
                    />
                    {audienceType}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <FieldLabel>말투</FieldLabel>
                <select
                  value={form.tone}
                  onChange={(event) => updateForm("tone", event.target.value)}
                  className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                >
                  {makerOptions.tones.map((tone) => (
                    <option key={tone} value={tone}>
                      {tone}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <FieldLabel>CTA 톤</FieldLabel>
                <input
                  value={form.ctaTone}
                  onChange={(event) => updateForm("ctaTone", event.target.value)}
                  className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                  placeholder="예: 편하게 문의 주세요"
                />
              </label>
            </div>

            <label className="block">
              <FieldLabel>금지어</FieldLabel>
              <input
                value={form.forbiddenWords}
                onChange={(event) => updateForm("forbiddenWords", event.target.value)}
                className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                placeholder="예: 최고, 무조건, 보장"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <FieldLabel>내 블로그 닉네임</FieldLabel>
                <input
                  value={form.ownerNickname}
                  onChange={(event) => updateForm("ownerNickname", event.target.value)}
                  className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                  placeholder="예: 블로그지기"
                />
              </label>

              <label className="block">
                <FieldLabel>owner aliases</FieldLabel>
                <input
                  value={form.ownerAliases}
                  onChange={(event) => updateForm("ownerAliases", event.target.value)}
                  className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                  placeholder="쉼표로 구분"
                />
              </label>
            </div>

            <div className="rounded-md border border-line bg-paper p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={18} className="text-moss" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-bold">URL 브리지</p>
                    <p className="text-xs font-semibold text-ink/50">{bridge.nextIntegration}</p>
                  </div>
                </div>
                <span className="rounded-md bg-white px-2.5 py-1 text-xs font-bold text-ink/55">
                  {bridge.status}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={saveWork}
              className="focus-ring inline-flex min-h-10 items-center justify-center gap-1 rounded-md border border-line bg-white px-2 text-xs font-bold transition hover:border-moss hover:text-moss"
            >
              <Save size={14} aria-hidden="true" />
              임시 저장
            </button>
            <button
              type="button"
              onClick={loadWork}
              className="focus-ring inline-flex min-h-10 items-center justify-center gap-1 rounded-md border border-line bg-white px-2 text-xs font-bold transition hover:border-moss hover:text-moss"
            >
              <RefreshCw size={14} aria-hidden="true" />
              불러오기
            </button>
            <button
              type="button"
              onClick={resetWork}
              className="focus-ring inline-flex min-h-10 items-center justify-center gap-1 rounded-md border border-line bg-white px-2 text-xs font-bold transition hover:border-coral hover:text-coral"
            >
              <Trash2 size={14} aria-hidden="true" />
              초기화
            </button>
          </div>
        </section>

        <section className="min-w-0 space-y-5">
          <div className="min-w-0 rounded-lg border border-line bg-white p-5 shadow-soft">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare size={19} className="text-moss" aria-hidden="true" />
                <h3 className="text-lg font-bold">댓글 직접 입력</h3>
              </div>
              <button
                type="button"
                onClick={() => addComment()}
                className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-moss hover:text-moss"
              >
                <Plus size={16} aria-hidden="true" />
                댓글 추가
              </button>
            </div>

            <textarea
              value={manualInput}
              onChange={(event) => setManualInput(event.target.value)}
              rows={5}
              className="focus-ring mt-4 w-full rounded-md border border-line bg-paper p-3 text-sm leading-6"
              placeholder={"작성자: 블링쮸\n댓글: 여기 관리 꼼꼼해 보여요"}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={appendManualComments}
                className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white transition hover:bg-[#456b61]"
              >
                <ListChecks size={16} aria-hidden="true" />
                붙여넣기 반영
              </button>
              <button
                type="button"
                onClick={() => generateAll()}
                disabled={!ready || validComments.length === 0 || status === "generating"}
                className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-coral px-3 text-sm font-semibold text-white transition hover:bg-[#bf5d4d] disabled:cursor-not-allowed disabled:bg-ink/25"
              >
                <Sparkles size={16} aria-hidden="true" />
                전체 생성
              </button>
              <button
                type="button"
                onClick={() => generateAll({ seed: Date.now() % 17 })}
                disabled={!ready || validComments.length === 0 || status === "generating"}
                className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-coral hover:text-coral disabled:cursor-not-allowed disabled:text-ink/30"
              >
                <RotateCcw size={16} aria-hidden="true" />
                전체 다시 생성
              </button>
            </div>
          </div>

          <div className="min-w-0 rounded-lg border border-line bg-white p-5 shadow-soft">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h3 className="text-lg font-bold">댓글 목록</h3>
                <p className="mt-1 text-sm font-semibold text-ink/55">
                  메인 키워드: {form.mainKeyword.trim() || resolvedMainKeyword || "자동 추출 대기"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <button
                  type="button"
                  onClick={() => copyText(toReplyListText(comments), "전체 대댓글 목록을 복사했습니다.")}
                  disabled={!comments.some((comment) => comment.reply)}
                  className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-amber hover:text-[#7a5a1e] disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  <Clipboard size={16} aria-hidden="true" />
                  대댓글 복사
                </button>
                <button
                  type="button"
                  onClick={() => copyText(toReplySetText(comments), "원댓글과 대댓글 세트를 복사했습니다.")}
                  disabled={!comments.some((comment) => comment.reply || comment.status === "스킵 권장")}
                  className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-amber hover:text-[#7a5a1e] disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  <Copy size={16} aria-hidden="true" />
                  세트 복사
                </button>
              </div>
            </div>

            <div className="mt-5 max-w-full overflow-x-auto overscroll-x-contain pb-2">
              <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-y border-line bg-paper text-xs font-bold text-ink/55">
                    <th className="w-36 px-3 py-3">작성자</th>
                    <th className="w-64 px-3 py-3">원댓글</th>
                    <th className="w-28 px-3 py-3">댓글 유형</th>
                    <th className="w-40 px-3 py-3">감정/의도</th>
                    <th className="w-36 px-3 py-3">핵심 키워드</th>
                    <th className="w-72 px-3 py-3">생성된 대댓글</th>
                    <th className="w-48 px-3 py-3">검수</th>
                    <th className="w-28 px-3 py-3">상태</th>
                    <th className="w-56 px-3 py-3">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {comments.map((comment) => (
                    <tr key={comment.id} className="align-top">
                      <td className="px-3 py-3">
                        <input
                          value={comment.author}
                          onChange={(event) => updateComment(comment.id, "author", event.target.value)}
                          className="focus-ring min-h-10 w-full rounded-md border border-line bg-paper px-2 text-sm"
                          placeholder="작성자"
                        />
                        <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-ink/55">
                          <input
                            type="checkbox"
                            checked={comment.hasOwnerReply}
                            onChange={(event) => updateComment(comment.id, "hasOwnerReply", event.target.checked)}
                            className="h-4 w-4 accent-[#52796f]"
                          />
                          기존 내 답글
                        </label>
                      </td>
                      <td className="px-3 py-3">
                        <textarea
                          value={comment.content}
                          onChange={(event) => updateComment(comment.id, "content", event.target.value)}
                          rows={4}
                          className="focus-ring w-full rounded-md border border-line bg-paper p-2 text-sm leading-6"
                          placeholder="댓글 내용"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <SmallBadge>{comment.type || "대기"}</SmallBadge>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-semibold text-ink/70">{comment.sentiment || "-"}</p>
                        <p className="mt-1 text-xs leading-5 text-ink/55">{comment.intent || "-"}</p>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {(comment.coreKeywords || []).length > 0 ? (
                            comment.coreKeywords.map((keyword) => (
                              <span
                                key={`${comment.id}-${keyword}`}
                                className="rounded-md bg-paper px-2 py-1 text-xs font-bold text-ink/60"
                              >
                                {keyword}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs font-semibold text-ink/40">-</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <textarea
                          value={comment.reply}
                          onChange={(event) => updateComment(comment.id, "reply", event.target.value)}
                          rows={4}
                          className="focus-ring w-full rounded-md border border-line bg-white p-2 text-sm leading-6"
                          placeholder={comment.status === "스킵 권장" ? comment.skipReason || "스킵 권장" : "생성 대기"}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="space-y-2 text-xs font-semibold">
                          <CheckLine label="키워드" value={comment.mainKeywordUsed ? "반영" : "미반영"} />
                          <CheckLine
                            label="금지어"
                            value={
                              comment.forbiddenWordsFound?.length
                                ? comment.forbiddenWordsFound.join(", ")
                                : "없음"
                            }
                            danger={Boolean(comment.forbiddenWordsFound?.length)}
                          />
                          <span
                            className={`inline-flex rounded-md px-2 py-1 ${
                              duplicateClassName[comment.duplicateRisk] || duplicateClassName["중복 위험 낮음"]
                            }`}
                          >
                            {comment.duplicateRisk}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <StatusPill status={comment.status} />
                        {comment.reviewed && (
                          <span className="mt-2 inline-flex rounded-md bg-moss px-2 py-1 text-xs font-bold text-white">
                            검토 완료
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="grid grid-cols-2 gap-2">
                          <ActionButton
                            icon={Sparkles}
                            label="생성"
                            onClick={() => generateOne(comment.id)}
                            disabled={!ready || !comment.content.trim() || status === "generating"}
                          />
                          <ActionButton
                            icon={RefreshCw}
                            label="다시"
                            onClick={() => generateOne(comment.id, { regenerate: true })}
                            disabled={!ready || !comment.content.trim() || status === "generating"}
                          />
                          <ActionButton
                            icon={Copy}
                            label="복사"
                            onClick={() => copyText(comment.reply, "대댓글을 복사했습니다.")}
                            disabled={!comment.reply}
                          />
                          <ActionButton icon={SkipForward} label="스킵" onClick={() => markSkip(comment.id)} />
                          <ActionButton
                            icon={Check}
                            label="검토"
                            onClick={() => markReviewed(comment.id)}
                            disabled={!comment.reply && comment.status !== "스킵 권장"}
                          />
                          <ActionButton icon={Trash2} label="삭제" onClick={() => removeComment(comment.id)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function FieldLabel({ children, required = false }) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
      <span>{children}</span>
      {required && (
        <span className="rounded-md bg-coral/10 px-2 py-0.5 text-[11px] font-bold text-coral">
          필수
        </span>
      )}
    </span>
  );
}

function StatusBadge({ label, status }) {
  const className =
    status === "generating"
      ? "border-amber/35 bg-amber/15 text-[#7a5a1e]"
      : status === "generated" || status === "saved"
        ? "border-moss/30 bg-moss/10 text-moss"
        : status === "copied"
          ? "border-amber/35 bg-amber/15 text-[#7a5a1e]"
          : "border-line bg-white text-ink/70";

  return (
    <span className={`inline-flex min-h-8 items-center rounded-md border px-3 text-sm font-semibold ${className}`}>
      {label}
    </span>
  );
}

function SmallBadge({ children }) {
  return (
    <span className="inline-flex rounded-md bg-paper px-2.5 py-1 text-xs font-bold text-ink/60">
      {children}
    </span>
  );
}

function StatusPill({ status }) {
  return (
    <span
      className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-bold ${
        statusClassName[status] || statusClassName["대기"]
      }`}
    >
      {status || "대기"}
    </span>
  );
}

function CheckLine({ label, value, danger = false }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-paper px-2 py-1">
      <span className="text-ink/45">{label}</span>
      <span className={danger ? "text-coral" : "text-ink/65"}>{value}</span>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="focus-ring inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-line bg-white px-2 text-xs font-bold transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:text-ink/30"
    >
      <Icon size={14} aria-hidden="true" />
      {label}
    </button>
  );
}
