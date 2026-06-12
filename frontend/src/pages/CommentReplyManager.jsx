import {
  Bot,
  Check,
  Clipboard,
  Copy,
  Eye,
  FileText,
  Image as ImageIcon,
  Link,
  ListChecks,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  SkipForward,
  Sparkles,
  StopCircle,
  Trash2,
  Upload
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { makerOptions, STORAGE_KEYS } from "@shared/mvpConfig.js";
import { isBackendApiEnabled, postBackend, requestBackend } from "../lib/backendApi.js";
import { extractCaptureTextFromImage } from "../lib/captureOcr.js";
import { isStaticBetaMode, STATIC_BETA_NOTICE } from "../lib/runtimeMode.js";
import {
  assessCapturedCommentExtraction,
  createCommentCollectionBridge,
  createCommentReplyBatch,
  createCommentReplyForOne,
  createMainKeywordCandidates,
  generateContextualCaptureReplies,
  generateContextualCaptureReply,
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

const automationModes = [
  { id: "manual", label: "수동 댓글 입력" },
  { id: "capture", label: "캡처 이미지 업로드" },
  { id: "url-review", label: "URL 자동화 브리지", requiresBridge: true }
];

const modeLabels = {
  manual: "수동 댓글 입력",
  capture: "캡처 이미지 업로드",
  "url-review": "URL 자동화 브리지",
  "url-auto": "URL 자동 등록"
};

const bridgeStatusClassName = {
  connected: "border-moss/30 bg-moss/10 text-moss",
  not_connected: "border-coral/30 bg-coral/10 text-coral",
  checking: "border-amber/40 bg-amber/15 text-[#7a5a1e]"
};

const supportedCaptureImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const supportedCaptureImageExtensions = new Set(["png", "jpg", "jpeg", "webp"]);
const MAX_CAPTURE_IMAGE_SIZE = 12 * 1024 * 1024;
const MIN_CAPTURE_IMAGE_WIDTH = 600;
const MIN_CAPTURE_IMAGE_HEIGHT = 300;
const LOW_CAPTURE_IMAGE_SIZE = 40 * 1024;
const OCR_LOW_CONFIDENCE_MESSAGE =
  "댓글을 정확히 읽지 못했습니다. 댓글 글자가 크게 보이도록 다시 캡처하거나, 댓글 내용을 직접 입력해주세요.";
const OCR_MANUAL_INPUT_MESSAGE =
  "이미지에서 댓글을 정확히 찾지 못했습니다. 댓글 내용을 아래에 직접 붙여넣어도 대댓글을 만들 수 있습니다.";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readImageSize = (previewUrl) =>
  new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = previewUrl;
  });

const getCaptureImageQualityWarnings = ({ width = 0, height = 0, size = 0 } = {}) => {
  const warnings = [];

  if ((width && width < MIN_CAPTURE_IMAGE_WIDTH) || (height && height < MIN_CAPTURE_IMAGE_HEIGHT)) {
    warnings.push("이미지가 작거나 글자가 흐리면 댓글을 정확히 읽지 못할 수 있습니다.");
  }

  if (size > 0 && size < LOW_CAPTURE_IMAGE_SIZE) {
    warnings.push("파일 용량이 매우 작으면 댓글 글자가 흐리게 저장됐을 수 있습니다.");
  }

  return warnings;
};

const getSupportedCaptureImageType = (file) => {
  const type = String(file?.type || "").toLowerCase();
  if (supportedCaptureImageTypes.has(type)) return type;

  const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
  if (supportedCaptureImageExtensions.has(extension)) {
    return extension === "jpg" ? "image/jpeg" : `image/${extension}`;
  }

  return "";
};

const isSupportedCaptureImage = (file) => Boolean(getSupportedCaptureImageType(file));

const getCaptureImageFromTransfer = (dataTransfer) => {
  if (!dataTransfer) return { file: null, unsupported: false };

  const items = Array.from(dataTransfer.items || []);
  let unsupported = false;

  for (const item of items) {
    if (!String(item.type || "").startsWith("image/")) continue;

    const file = item.getAsFile?.();
    if (isSupportedCaptureImage(file)) return { file, unsupported: false };
    unsupported = true;
  }

  for (const file of Array.from(dataTransfer.files || [])) {
    if (!String(file.type || "").startsWith("image/")) continue;
    if (isSupportedCaptureImage(file)) return { file, unsupported: false };
    unsupported = true;
  }

  return { file: null, unsupported };
};

const createEmptyComment = () => ({
  id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  commentId: "",
  author: "",
  content: "",
  createdAt: "",
  source: "manual",
  isOwnerComment: false,
  hasOwnerReply: false,
  existingReplies: [],
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
  processStatus: "",
  registerStatus: "",
  retryCount: 0,
  errorMessage: "",
  selected: false,
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

const normalizeInitialMode = (value) =>
  isStaticBetaMode() && (value === "url-review" || value === "url-auto") ? "manual" : value || "manual";

const isMissingAuthor = (author = "") => {
  const normalized = String(author || "").trim();
  return !normalized || normalized === "작성자 미입력" || normalized === "작성자 미확인";
};

const getCommentDisplayName = (comment = {}, index = 0) =>
  isMissingAuthor(comment.author) ? `댓글 ${index + 1}` : comment.author;

const normalizeStoredComments = (comments = []) => {
  const normalized = comments.map((comment, index) => ({
    ...normalizeComment(comment, index),
    selected: Boolean(comment.selected),
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

const createEmptyReport = () => ({
  totalComments: 0,
  targetComments: 0,
  skippedCount: 0,
  generatedCount: 0,
  registeredCount: 0,
  failedCount: 0,
  retryCount: 0,
  exitReason: "",
  failedComments: []
});

const createLogEntry = (message, level = "info") => ({
  id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  level,
  message
});

const normalizeAutomationComment = (comment = {}, index = 0) => ({
  ...createEmptyComment(),
  ...normalizeComment(comment, index),
  id: comment.id || comment.commentId || `url-${Date.now()}-${index + 1}`,
  commentId: comment.commentId || comment.commentNo || comment.commentKey || comment.id || "",
  createdAt: comment.createdAt || comment.writtenAt || comment.datetime || comment.date || "",
  source: comment.source || "url",
  isOwnerComment: Boolean(comment.isOwnerComment || comment.isMine || comment.isMyComment),
  hasOwnerReply: Boolean(comment.hasOwnerReply || comment.hasMyReply || comment.alreadyReplied),
  existingReplies: Array.isArray(comment.existingReplies)
    ? comment.existingReplies
    : Array.isArray(comment.replies)
      ? comment.replies
      : [],
  processStatus: comment.processStatus || comment.processingStatus || "",
  registerStatus: comment.registerStatus || "",
  retryCount: Number(comment.retryCount || 0),
  errorMessage: comment.errorMessage || comment.error || "",
  selected: Boolean(comment.selected),
  reviewed: Boolean(comment.reviewed)
});

const normalizeCapturedComment = (comment = {}, index = 0) => ({
  ...createEmptyComment(),
  ...normalizeComment(
    {
      ...comment,
      source: "capture"
    },
    index
  ),
  id: comment.id || comment.commentId || `capture-${Date.now()}-${index + 1}`,
  commentId: comment.commentId || comment.commentNo || comment.commentKey || comment.id || "",
  source: "capture",
  selected: Boolean(comment.selected),
  reviewed: Boolean(comment.reviewed)
});

const normalizeCaptureReviewComment = (comment = {}, index = 0, confidence = 0) => ({
  ...normalizeCapturedComment(comment, index),
  id: comment.id || `capture-review-${Date.now()}-${index + 1}`,
  extractionConfidence: Number.isFinite(confidence) ? confidence : 0,
  extractionStatus: confidence >= 0.7 ? "자동 추출" : "확인 필요",
  status: "대기",
  reply: "",
  reviewed: false
});

const createEmptyCaptureReviewComment = () => ({
  ...createEmptyComment(),
  id: `capture-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  author: "작성자 미확인",
  content: "",
  source: "capture",
  extractionConfidence: 0,
  extractionStatus: "직접 입력",
  status: "대기"
});

const createCapturePlaceholderComment = () => ({
  ...createEmptyComment(),
  id: `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  author: "작성자 미확인",
  content: "",
  source: "capture",
  status: "검토 필요",
  skipReason: "OCR 결과를 확인하고 댓글 내용을 입력해주세요."
});

const buildReportFromComments = (comments = [], base = {}) => {
  const skipped = comments.filter(
    (comment) => comment.status === "스킵 권장" || comment.skipReason || comment.hasOwnerReply || comment.isOwnerComment
  );
  const failed = comments.filter((comment) => comment.registerStatus === "등록 실패" || comment.errorMessage);

  return {
    ...createEmptyReport(),
    ...base,
    totalComments: base.totalComments ?? comments.length,
    targetComments: base.targetComments ?? Math.max(0, comments.length - skipped.length),
    skippedCount: base.skippedCount ?? skipped.length,
    generatedCount: base.generatedCount ?? comments.filter((comment) => Boolean(comment.reply)).length,
    registeredCount: base.registeredCount ?? comments.filter((comment) => comment.registerStatus === "등록 완료").length,
    failedCount: base.failedCount ?? failed.length,
    retryCount: base.retryCount ?? comments.reduce((sum, comment) => sum + Number(comment.retryCount || 0), 0),
    failedComments:
      base.failedComments?.length > 0
        ? base.failedComments
        : failed.map((comment) => ({
            id: comment.id,
            author: comment.author,
            content: comment.content,
            reason: comment.errorMessage || comment.skipReason || "실패"
          }))
  };
};

const toReplyListText = (comments) =>
  comments
    .filter((comment) => comment.reply)
    .map((comment, index) => `${getCommentDisplayName(comment, index)}: ${comment.reply}`)
    .join("\n");

const toReplySetText = (comments) =>
  comments
    .filter((comment) => comment.content && (comment.reply || comment.status === "스킵 권장"))
    .map((comment, index) =>
      [
        `[${getCommentDisplayName(comment, index)}]`,
        `원댓글: ${comment.content}`,
        comment.reply ? `대댓글: ${comment.reply}` : `상태: ${comment.skipReason || "스킵 권장"}`
      ].join("\n")
    )
    .join("\n\n");

export default function CommentReplyManager({ modeVariant = "optimized" }) {
  const isQuickReply = modeVariant === "quick";
  const storedWork = useMemo(() => (isQuickReply ? null : loadStoredWork()), [isQuickReply]);
  const staticBeta = isStaticBetaMode();
  const automationAbortRef = useRef(null);
  const captureFileInputRef = useRef(null);
  const capturePasteZoneRef = useRef(null);
  const captureOcrTextareaRef = useRef(null);
  const manualInputRef = useRef(null);
  const [form, setForm] = useState(() => ({
    ...initialForm,
    ...(storedWork?.form || {})
  }));
  const [comments, setComments] = useState(() => normalizeStoredComments(storedWork?.comments || []));
  const [manualInput, setManualInput] = useState("");
  const [mode, setMode] = useState(() => (isQuickReply ? "capture" : normalizeInitialMode(storedWork?.mode)));
  const [captureImage, setCaptureImage] = useState(null);
  const [captureOcrText, setCaptureOcrText] = useState(storedWork?.capture?.ocrText || "");
  const [captureOcrMeta, setCaptureOcrMeta] = useState(
    storedWork?.capture?.ocrMeta || {
      provider: "",
      confidence: 0,
      warnings: [],
      blocked: false,
      blockedReason: ""
    }
  );
  const [captureOcrEdited, setCaptureOcrEdited] = useState(false);
  const [captureRawOpen, setCaptureRawOpen] = useState(false);
  const [captureReviewComments, setCaptureReviewComments] = useState(() =>
    (storedWork?.capture?.reviewComments || []).map((comment, index) =>
      normalizeCaptureReviewComment(comment, index, comment.extractionConfidence || storedWork?.capture?.ocrMeta?.confidence || 0)
    )
  );
  const [captureDragActive, setCaptureDragActive] = useState(false);
  const [bridge, setBridge] = useState(() => storedWork?.bridge || createCommentCollectionBridge());
  const [automationLogs, setAutomationLogs] = useState(() => storedWork?.automationLogs || []);
  const [automationReport, setAutomationReport] = useState(() => storedWork?.automationReport || createEmptyReport());
  const [automationBusy, setAutomationBusy] = useState(false);
  const [status, setStatus] = useState(storedWork ? "saved" : "idle");
  const [message, setMessage] = useState(storedWork ? "저장된 댓글 응답 작업을 불러왔습니다." : "");

  const keywordCandidates = useMemo(() => createMainKeywordCandidates(form.postTitle), [form.postTitle]);
  const resolvedMainKeyword = useMemo(() => resolveMainKeyword(form), [form]);
  const urlReady = Boolean(form.blogUrl.trim() && form.postTitle.trim());
  const urlMode = !staticBeta && (mode === "url-review" || mode === "url-auto");
  const ready = Boolean(form.postTitle.trim() && (!urlMode || form.blogUrl.trim()));
  const replyContextReady = Boolean(form.postTitle.trim() || form.mainKeyword.trim() || resolvedMainKeyword);
  const bridgeConnected = bridge.connected || bridge.status === "connected";
  const bridgeChecking = bridge.status === "checking";
  const bridgeStatusLabel = bridgeChecking ? "확인 중" : bridgeConnected ? "연결됨" : "연결 안 됨";
  const canScanComments = !staticBeta && isBackendApiEnabled() && bridgeConnected && bridge.canScan !== false;
  const canRegisterReplies = !staticBeta && isBackendApiEnabled() && bridgeConnected && bridge.canRegister !== false;
  const canRunLegacyAuto = !staticBeta && isBackendApiEnabled() && bridgeConnected && bridge.canRunAuto !== false;
  const validComments = comments.filter((comment) => comment.content.trim());
  const captureReviewValidCount = captureReviewComments.filter((comment) => comment.content.trim()).length;
  const captureReplyTargetCount = validComments.length;
  const captureReviewGenerateHint =
    status === "generating"
      ? "상호대댓글을 생성 중입니다."
      : automationBusy
        ? "이미지 처리 또는 댓글 추출이 끝나면 생성할 수 있습니다."
        : captureReviewValidCount === 0
          ? "추출된 댓글이 없습니다. 이미지에서 댓글 추출을 누르거나 빈 댓글을 직접 추가해주세요."
          : replyContextReady
            ? "추출된 댓글 전체에 맞춤 대댓글을 한 번에 생성합니다."
            : "포스팅 제목이나 메인 키워드를 넣으면 더 자연스럽지만, 지금도 생성할 수 있습니다.";
  const captureCardGenerateHint =
    status === "generating"
      ? "상호대댓글을 생성 중입니다."
      : automationBusy
        ? "이미지 처리 또는 댓글 추출이 끝나면 생성할 수 있습니다."
        : captureReplyTargetCount === 0
          ? "댓글 카드가 없습니다. 이미지에서 댓글 추출 후 카드로 반영하거나 직접 댓글을 추가해주세요."
          : replyContextReady
            ? "댓글 카드 전체에 맞춤 대댓글을 한 번에 생성합니다."
            : "포스팅 제목이나 메인 키워드를 넣으면 더 자연스럽지만, 지금도 생성할 수 있습니다.";
  const selectedComments = comments.filter((comment) => comment.selected && comment.reply);
  const generatedCount = comments.filter((comment) => comment.reply || comment.status === "스킵 권장").length;
  const generateAllLabel = "대댓글 초안 만들기";
  const liveReport = useMemo(
    () => buildReportFromComments(comments, automationReport),
    [comments, automationReport]
  );

  useEffect(() => {
    const previewUrl = captureImage?.previewUrl;

    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [captureImage?.previewUrl]);

  const updateForm = (key, value) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      const nextNeedsUrl = !staticBeta && (mode === "url-review" || mode === "url-auto");
      setStatus(next.postTitle.trim() && (!nextNeedsUrl || next.blogUrl.trim()) ? "ready" : "idle");
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
                    processStatus: "",
                    registerStatus: "",
                    errorMessage: "",
                    reviewed: false
                  }
                : {})
            }
          : comment
      )
    );
    setMessage("");
  };

  const updateCaptureReviewComment = (id, key, value) => {
    setCaptureReviewComments((current) =>
      current.map((comment) =>
        comment.id === id
          ? {
              ...comment,
              [key]: value,
              extractionStatus: "확인 필요"
            }
          : comment
      )
    );
    setMessage("");
  };

  const addCaptureReviewComment = () => {
    setCaptureReviewComments((current) => [...current, createEmptyCaptureReviewComment()]);
    setMessage("");
  };

  const removeCaptureReviewComment = (id) => {
    setCaptureReviewComments((current) => current.filter((comment) => comment.id !== id));
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
    setStatus("ready");
    setMessage(`${parsed.length}개 댓글을 목록에 추가했습니다.`);
  };

  const parseCaptureTextToReview = (
    rawText = captureOcrText,
    confidence = captureOcrMeta.confidence || 0,
    options = {}
  ) => {
    const source = options.source || (captureOcrEdited ? "manual-edit" : "ocr");
    const assessment = assessCapturedCommentExtraction(rawText, {
      confidence,
      source: source === "ocr" ? "ocr" : "manual",
      force: options.force
    });

    setMode("capture");
    setCaptureOcrMeta((current) => ({
      ...current,
      confidence,
      blocked: !assessment.ok,
      blockedReason: assessment.ok ? "" : assessment.message,
      warnings: [
        ...new Set([
          ...(current.warnings || []),
          ...(!assessment.ok ? [assessment.message] : []),
          ...(assessment.confidenceStatus === "review" && assessment.ok
            ? ["OCR 신뢰도가 보통입니다. 추출 댓글을 확인하고 수정해주세요."]
            : [])
        ])
      ]
    }));

    if (!assessment.ok) {
      setCaptureReviewComments([]);
      setAutomationReport(buildReportFromComments([], { exitReason: assessment.reason }));
      setStatus("idle");
      setMessage(assessment.message);
      return [];
    }

    const nextReviewComments = assessment.comments.map((comment, index) =>
      normalizeCaptureReviewComment(comment, index, confidence)
    );

    setCaptureReviewComments(nextReviewComments);
    setAutomationReport(
      buildReportFromComments(nextReviewComments, {
        exitReason: assessment.confidenceStatus === "auto" ? "capture_parsed" : "capture_needs_review"
      })
    );
    setStatus(form.postTitle.trim() ? "ready" : "idle");
    setMessage(assessment.message);

    return nextReviewComments;
  };

  const parseCurrentCaptureText = () =>
    parseCaptureTextToReview(captureOcrText, captureOcrEdited ? 1 : captureOcrMeta.confidence || 0, {
      source: captureOcrEdited ? "manual-edit" : "ocr"
    });

  const forceParseCurrentCaptureText = () =>
    parseCaptureTextToReview(captureOcrText, captureOcrMeta.confidence || 0, {
      source: "ocr",
      force: true
    });

  const focusManualCommentInput = () => {
    setMode("manual");
    setMessage("댓글 내용을 직접 붙여넣어도 대댓글을 만들 수 있습니다.");
    window.setTimeout(() => manualInputRef.current?.focus(), 0);
  };

  const focusCaptureOcrText = () => {
    setCaptureRawOpen(true);
    window.setTimeout(() => captureOcrTextareaRef.current?.focus(), 0);
  };

  const applyCaptureReviewToComments = (reviewComments = captureReviewComments) => {
    const nextComments = buildCaptureReviewComments(reviewComments);

    if (nextComments.length === 0) {
      setMessage("댓글 카드로 반영할 내용이 없습니다. 추출 텍스트나 댓글 내용을 먼저 입력해주세요.");
      return;
    }

    setMode("capture");
    setComments(nextComments);
    setAutomationReport(buildReportFromComments(nextComments, { exitReason: "capture_review_applied" }));
    setStatus(replyContextReady ? "ready" : "idle");
    setMessage(`${nextComments.length}개 댓글을 댓글 카드로 반영했습니다. 이제 대댓글을 생성할 수 있습니다.`);
  };

  const buildCaptureReviewComments = (reviewComments = captureReviewComments) =>
    reviewComments
      .filter((comment) => comment.content.trim())
      .map((comment, index) =>
        normalizeCapturedComment(
          {
            ...comment,
            status: "대기",
            skipReason: ""
          },
          index
        )
      );

  const handleGenerateAllContextualReplies = async ({
    seed = 0,
    sourceComments = validComments,
    replaceComments = false,
    confirmRegenerate = false
  } = {}) => {
    const targetComments = sourceComments.filter((comment) => comment.content.trim());

    if (targetComments.length === 0) {
      setMessage("전체 상호대댓글을 생성할 댓글 카드가 없습니다.");
      return;
    }

    if (confirmRegenerate && targetComments.some((comment) => comment.reply)) {
      const ok = window.confirm("이미 만들어진 대댓글이 있습니다. 전체 대댓글을 다시 만들까요?");
      if (!ok) return;
    }

    try {
      const missingContext = !replyContextReady;
      const formPayload = withResolvedKeyword(form);
      setMode("capture");
      setStatus("generating");
      setMessage("");
      await wait(250);

      const generatedCaptureReplies = generateContextualCaptureReplies(targetComments, formPayload, {
        seed,
        regenerate: confirmRegenerate
      });
      const generatedMap = new Map(generatedCaptureReplies.map((comment) => [comment.id, comment]));
      const generatedComments = replaceComments
        ? generatedCaptureReplies.map((comment) => ({ ...comment, reviewed: false }))
        : comments.map((comment) => {
            const generated = generatedMap.get(comment.id);
            return generated ? { ...comment, ...generated, reviewed: false, selected: comment.selected } : comment;
          });
      const successCount = generatedCaptureReplies.filter((comment) => comment.reply).length;
      const skippedCount = generatedCaptureReplies.filter((comment) => comment.status === "스킵 권장").length;
      const failedCount = Math.max(0, targetComments.length - successCount - skippedCount);

      setComments(generatedComments);
      setAutomationReport(buildReportFromComments(generatedComments, { exitReason: "capture_reply_generated" }));
      appendAutomationLogs(
        `${successCount}개 성공 / ${skippedCount}개 스킵 / ${failedCount}개 실패`,
        failedCount > 0 ? "retry" : "success"
      );
      setStatus("generated");
      setMessage(
        failedCount > 0
          ? `${successCount}개 성공 / ${failedCount}개 실패했습니다. 실패한 댓글 내용을 확인해주세요.`
          : `${successCount}개 대댓글을 생성했습니다.${
              missingContext ? " 포스팅 제목이나 메인 키워드를 넣으면 더 자연스러운 답글을 만들 수 있습니다." : ""
            }`
      );
    } catch (error) {
      console.error(error);
      appendAutomationLogs(`전체 상호대댓글 생성 실패: ${error.message}`, "fail");
      setStatus("ready");
      setMessage(`전체 상호대댓글 생성에 실패했습니다: ${error.message}`);
    }
  };

  const generateCaptureReviewReplies = async () => {
    const nextComments = buildCaptureReviewComments();

    if (nextComments.length === 0) {
      setMessage("전체 상호대댓글을 생성할 댓글이 없습니다. 추출 결과를 확인하거나 댓글을 추가해주세요.");
      return;
    }

    await handleGenerateAllContextualReplies({
      sourceComments: nextComments,
      replaceComments: true
    });
  };

  const processCaptureImage = async (file, source = "upload") => {
    if (!file) {
      setMessage("선택된 이미지 파일이 없습니다. PNG, JPG, WEBP 캡처 이미지를 선택해주세요.");
      return;
    }

    if (!isSupportedCaptureImage(file)) {
      setMessage("PNG, JPG, WEBP 형식의 이미지 캡처만 사용할 수 있습니다.");
      return;
    }

    if (file.size > MAX_CAPTURE_IMAGE_SIZE) {
      setMessage("이미지 용량이 너무 큽니다. 12MB 이하의 PNG, JPG, WEBP 파일을 사용해주세요.");
      return;
    }

    const sourceLabel =
      source === "paste" ? "붙여넣은" : source === "drop" ? "드롭한" : "업로드한";

    setMode("capture");
    setAutomationBusy(true);
    setMessage(`${sourceLabel} 이미지를 미리보기로 올렸습니다. 댓글을 추출하는 중입니다.`);

    const previewUrl = URL.createObjectURL(file);
    const imageType = getSupportedCaptureImageType(file);
    const dimensions = await readImageSize(previewUrl);
    const qualityWarnings = getCaptureImageQualityWarnings({ ...dimensions, size: file.size });
    setCaptureOcrEdited(false);
    setCaptureRawOpen(false);
    setCaptureImage((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return {
        name: file.name,
        size: file.size,
        type: imageType,
        width: dimensions.width,
        height: dimensions.height,
        qualityWarnings,
        previewUrl
      };
    });

    try {
      const extraction = await extractCaptureTextFromImage(file);
      setCaptureOcrText(extraction.text || "");
      setCaptureOcrMeta({
        provider: extraction.provider,
        confidence: extraction.confidence,
        warnings: [...new Set([...(qualityWarnings || []), ...(extraction.warnings || [])])],
        blocked: false,
        blockedReason: ""
      });
      appendAutomationLogs(
        [
          extraction.message || `${sourceLabel} 캡처 이미지를 확인했습니다.`,
          ...(extraction.warnings || [])
        ].filter(Boolean),
        extraction.warnings?.length ? "retry" : "success"
      );

      const nextReviewComments = parseCaptureTextToReview(extraction.text || "", extraction.confidence || 0, {
        source: "ocr"
      });
      const validCount = nextReviewComments.filter((comment) => comment.content.trim()).length;
      const lowConfidence = extraction.confidence > 0 && extraction.confidence < 0.5;
      setStatus(form.postTitle.trim() ? "ready" : "idle");
      setMessage(
        validCount
          ? `${sourceLabel} 이미지에서 ${validCount}개 댓글을 분리했습니다. 추출 결과를 확인하고 댓글 카드로 반영해주세요.`
          : lowConfidence
            ? OCR_LOW_CONFIDENCE_MESSAGE
            : `${sourceLabel} 이미지는 반영됐지만 댓글을 찾지 못했습니다. ${OCR_MANUAL_INPUT_MESSAGE}`
      );
    } catch (error) {
      appendAutomationLogs(`캡처 이미지 처리 실패: ${error.message}`, "fail");
      setMessage("캡처 이미지 처리에 실패했습니다.");
    } finally {
      setAutomationBusy(false);
    }
  };

  const handleCaptureImageUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    await processCaptureImage(file, "upload");
  };

  const handleCapturePaste = async (event) => {
    const { file, unsupported } = getCaptureImageFromTransfer(event.clipboardData);

    if (file) {
      event.preventDefault();
      await processCaptureImage(file, "paste");
      return;
    }

    const pastedText = event.clipboardData?.getData("text/plain") || "";

    if (pastedText.trim()) {
      event.preventDefault();
      setMode("capture");
      setCaptureOcrText(pastedText);
      setCaptureOcrEdited(true);
      setCaptureRawOpen(true);
      setCaptureOcrMeta({
        provider: "clipboard-text",
        confidence: 1,
        warnings: ["이미지가 아닌 텍스트를 붙여넣어 추출 텍스트로 반영했습니다."],
        blocked: false,
        blockedReason: ""
      });
      parseCaptureTextToReview(pastedText, 1, { source: "manual-edit" });
      appendAutomationLogs("클립보드 텍스트를 캡처 추출 텍스트로 반영했습니다.", "info");
      return;
    }

    setMessage(unsupported ? "PNG, JPG, WEBP 형식의 이미지 캡처를 붙여넣어 주세요." : "이미지 캡처를 붙여넣어 주세요.");
  };

  const handleCaptureDragOver = (event) => {
    event.preventDefault();
    setCaptureDragActive(true);
  };

  const handleCaptureDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setCaptureDragActive(false);
  };

  const handleCaptureDrop = async (event) => {
    event.preventDefault();
    setCaptureDragActive(false);

    const { file, unsupported } = getCaptureImageFromTransfer(event.dataTransfer);

    if (!file) {
      setMessage(unsupported ? "PNG, JPG, WEBP 형식의 이미지 파일을 올려주세요." : "이미지 파일을 드롭하거나 Ctrl+V로 붙여넣어 주세요.");
      return;
    }

    await processCaptureImage(file, "drop");
  };

  const appendAutomationLogs = (logs = [], level = "info") => {
    const entries = (Array.isArray(logs) ? logs : [logs])
      .filter(Boolean)
      .map((log) => (typeof log === "string" ? createLogEntry(log, level) : { ...createLogEntry(log.message, level), ...log }));

    if (entries.length === 0) return;

    setAutomationLogs((current) => [...entries, ...current].slice(0, 80));
  };

  const runAutomationRequest = async (path, payload) => {
    const controller = new AbortController();
    automationAbortRef.current = controller;

    try {
      return await requestBackend(path, {
        method: "POST",
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally {
      automationAbortRef.current = null;
    }
  };

  const checkBridgeStatus = async () => {
    if (staticBeta) {
      const disconnected = {
        ...createCommentCollectionBridge(),
        status: "not_connected",
        connected: false,
        message: STATIC_BETA_NOTICE
      };
      setBridge(disconnected);
      appendAutomationLogs(disconnected.message, "info");
      setMessage(disconnected.message);
      return;
    }

    if (!isBackendApiEnabled()) {
      const disconnected = {
        ...createCommentCollectionBridge(),
        status: "not_connected",
        connected: false,
        message: "프론트엔드 VITE_API_BASE_URL이 설정되지 않아 브리지 상태를 확인할 수 없습니다."
      };
      setBridge(disconnected);
      appendAutomationLogs(disconnected.message, "fail");
      setMessage(disconnected.message);
      return;
    }

    setBridge((current) => ({ ...current, status: "checking" }));
    setAutomationBusy(true);

    try {
      const data = await requestBackend("/api/comment-automation/status");
      setBridge(data);
      appendAutomationLogs(data.logs?.length ? data.logs : data.message, data.connected ? "success" : "fail");
      setMessage(data.message || "브리지 상태를 확인했습니다.");
    } catch (error) {
      const disconnected = {
        ...createCommentCollectionBridge(),
        status: "not_connected",
        connected: false,
        message: error.message
      };
      setBridge(disconnected);
      appendAutomationLogs(`브리지 상태 확인 실패: ${error.message}`, "fail");
      setMessage("브리지 상태 확인에 실패했습니다.");
    } finally {
      setAutomationBusy(false);
    }
  };

  const loadCommentsFromUrl = async () => {
    if (staticBeta) {
      setMessage(STATIC_BETA_NOTICE);
      return;
    }

    if (!urlReady) {
      setMessage("블로그 포스팅 URL과 포스팅 제목을 먼저 입력해주세요.");
      return;
    }

    setMode("url-review");
    setAutomationBusy(true);
    setMessage("");
    appendAutomationLogs("URL 기준 댓글 수집을 요청했습니다.");

    try {
      const data = await runAutomationRequest("/api/comment-automation/scan", {
        form: withResolvedKeyword(form)
      });
      if (data.status) setBridge(data.status);
      appendAutomationLogs(data.logs || data.message, data.ok ? "success" : "fail");
      setAutomationReport(data.report || createEmptyReport());

      const nextComments = (data.comments || []).map((comment, index) => {
        const normalized = normalizeAutomationComment(comment, index);
        const shouldSelect = !normalized.hasOwnerReply && !normalized.isOwnerComment && normalized.status !== "스킵 권장";
        return { ...normalized, selected: shouldSelect };
      });

      if (nextComments.length > 0) {
        setComments(nextComments);
      }

      setMessage(data.message || `${nextComments.length}개 댓글을 불러왔습니다.`);
    } catch (error) {
      appendAutomationLogs(`댓글 불러오기 실패: ${error.message}`, "fail");
      setMessage("댓글 불러오기에 실패했습니다.");
    } finally {
      setAutomationBusy(false);
    }
  };

  const generateAll = async ({ seed = 0, confirmRegenerate = false } = {}) => {
    const shouldUseCaptureGenerator =
      mode === "capture" || validComments.some((comment) => comment.source === "capture");

    if (shouldUseCaptureGenerator) {
      await handleGenerateAllContextualReplies({ seed, confirmRegenerate });
      return;
    }

    if (validComments.length === 0) {
      setMessage("전체 상호대댓글을 생성할 댓글 카드가 없습니다.");
      return;
    }
    if (urlMode && !ready) return;
    if (confirmRegenerate && validComments.some((comment) => comment.reply)) {
      const ok = window.confirm("이미 만들어진 대댓글이 있습니다. 전체 대댓글을 다시 만들까요?");
      if (!ok) return;
    }

    const missingContext = !replyContextReady;
    const formPayload = withResolvedKeyword(form);
    setStatus("generating");
    setMessage("");
    await wait(250);

    const data = await requestCommentReplyApi(
      urlMode ? "/api/comment-automation/generate" : "/api/comment-replies/generate",
      {
        form: formPayload,
        comments: validComments,
        options: { seed, regenerate: confirmRegenerate }
      },
      () => ({
        comments: createCommentReplyBatch(formPayload, validComments, { seed, regenerate: confirmRegenerate })
      })
    );
    const generatedMap = new Map((data.comments || []).map((comment) => [comment.id, comment]));

    setComments((current) =>
      current.map((comment) => {
        const generated = generatedMap.get(comment.id);
        return generated ? { ...comment, ...generated, reviewed: false, selected: comment.selected } : comment;
      })
    );
    setAutomationReport(data.report || buildReportFromComments(data.comments || []));
    appendAutomationLogs(data.logs || `${data.comments?.length || 0}개 댓글의 대댓글 초안을 생성했습니다.`, "success");
    setStatus("generated");
    setMessage(
      `${data.comments?.length || 0}개 댓글의 대댓글 초안을 만들었습니다.${
        missingContext ? " 포스팅 제목이나 메인 키워드를 넣으면 더 자연스럽지만, 지금도 생성할 수 있습니다." : ""
      }`
    );
  };

  const generateOne = async (id, { regenerate = false } = {}) => {
    const target = comments.find((comment) => comment.id === id);
    const captureTarget = mode === "capture" || target?.source === "capture";
    const nextRegenerationCount = Number(target?.regenerationCount || 0) + (regenerate ? 1 : 0);

    if (!target?.content.trim()) return;
    if (!captureTarget && urlMode && !ready) return;

    const formPayload = withResolvedKeyword(form);
    const previousReplies = comments
      .filter((comment) => comment.id !== id && comment.reply)
      .map((comment) => comment.reply);
    if (regenerate && target.reply) previousReplies.unshift(target.reply);
    const sequence = Math.max(0, comments.findIndex((comment) => comment.id === id));
    const seed = regenerate ? Date.now() + nextRegenerationCount + sequence : sequence;

    setStatus("generating");
    setMessage("");
    await wait(180);

    if (captureTarget) {
      const generatedCaptureReply = generateContextualCaptureReply(target, formPayload, previousReplies, {
        sequence,
        seed: regenerate ? seed : sequence,
        regenerate,
        regenerationCount: nextRegenerationCount
      });

      setComments((current) =>
        current.map((comment) =>
          comment.id === id ? { ...comment, ...generatedCaptureReply, reviewed: false, regenerationCount: nextRegenerationCount } : comment
        )
      );
      setStatus("generated");
      setMessage(regenerate ? "대댓글 초안을 다시 만들었습니다." : "대댓글 초안을 만들었습니다.");
      return;
    }

    const data = await requestCommentReplyApi(
      "/api/comment-replies/generate-one",
      {
        form: formPayload,
        comment: target,
        previousReplies,
        options: { sequence, seed, regenerate, regenerationCount: nextRegenerationCount }
      },
      () => ({
        comment: createCommentReplyForOne(formPayload, target, previousReplies, {
          sequence,
          seed,
          regenerate,
          regenerationCount: nextRegenerationCount
        })
      })
    );

    setComments((current) =>
      current.map((comment) =>
        comment.id === id ? { ...comment, ...data.comment, reviewed: false, regenerationCount: nextRegenerationCount } : comment
      )
    );
    setStatus("generated");
    setMessage(regenerate ? "대댓글 초안을 다시 만들었습니다." : "대댓글 초안을 만들었습니다.");
  };

  const registerSelectedReplies = async () => {
    if (staticBeta) {
      setMessage(STATIC_BETA_NOTICE);
      return;
    }

    if (!urlReady) {
      setMessage("선택 등록에는 블로그 포스팅 URL과 포스팅 제목이 필요합니다.");
      return;
    }

    if (selectedComments.length === 0) {
      setMessage("등록할 대댓글이 선택되지 않았습니다.");
      return;
    }

    setAutomationBusy(true);
    appendAutomationLogs(`${selectedComments.length}개 선택 대댓글 등록을 요청했습니다.`);

    try {
      const data = await runAutomationRequest("/api/comment-automation/register", {
        form: withResolvedKeyword(form),
        comments: selectedComments
      });
      if (data.status) setBridge(data.status);
      appendAutomationLogs(data.logs || data.message, data.ok ? "success" : "fail");
      setAutomationReport(data.report || createEmptyReport());

      if (Array.isArray(data.comments) && data.comments.length > 0) {
        const resultMap = new Map(data.comments.map((comment) => [comment.id, comment]));
        setComments((current) =>
          current.map((comment) => {
            const result = resultMap.get(comment.id);
            return result ? { ...comment, ...result, selected: comment.selected } : comment;
          })
        );
      }

      setMessage(data.message || "선택 대댓글 등록 요청을 처리했습니다.");
    } catch (error) {
      appendAutomationLogs(`선택 등록 실패: ${error.message}`, "fail");
      setMessage("선택 대댓글 등록에 실패했습니다.");
    } finally {
      setAutomationBusy(false);
    }
  };

  const runAutoRegister = async () => {
    if (staticBeta) {
      setMessage(STATIC_BETA_NOTICE);
      return;
    }

    if (!urlReady) {
      setMessage("전체 자동 등록에는 블로그 포스팅 URL과 포스팅 제목이 필요합니다.");
      return;
    }

    const ok = window.confirm(
      "전체 자동 등록을 실행할까요? blog-automation의 기존 자동화 엔진이 네이버 댓글을 순회하며 실제 대댓글 등록을 시도합니다."
    );
    if (!ok) return;

    setMode("url-auto");
    setAutomationBusy(true);
    appendAutomationLogs("전체 자동 등록을 시작했습니다.");

    try {
      const data = await runAutomationRequest("/api/comment-automation/run", {
        form: withResolvedKeyword(form),
        autoRegister: true
      });
      if (data.status) setBridge(data.status);
      appendAutomationLogs(data.logs || data.message, data.ok ? "success" : "fail");
      setAutomationReport(data.report || createEmptyReport());
      setMessage(data.message || "전체 자동 등록 작업이 종료되었습니다.");
    } catch (error) {
      appendAutomationLogs(`전체 자동 등록 실패: ${error.message}`, "fail");
      setMessage("전체 자동 등록에 실패했습니다.");
    } finally {
      setAutomationBusy(false);
    }
  };

  const stopAutomationWork = async () => {
    if (staticBeta) {
      setAutomationBusy(false);
      setMessage(STATIC_BETA_NOTICE);
      return;
    }

    if (automationAbortRef.current) {
      automationAbortRef.current.abort();
      appendAutomationLogs("현재 프론트 요청을 취소했습니다.", "retry");
    }

    try {
      const data = await postBackend("/api/comment-automation/stop", {
        form: withResolvedKeyword(form)
      });
      appendAutomationLogs(data.logs || data.message, data.ok ? "success" : "fail");
      setMessage(data.message || "작업 중지 요청을 보냈습니다.");
    } catch (error) {
      appendAutomationLogs(`작업 중지 요청 실패: ${error.message}`, "fail");
      setMessage("작업 중지 요청에 실패했습니다.");
    } finally {
      setAutomationBusy(false);
    }
  };

  const loadAutomationLogs = async () => {
    if (staticBeta) {
      setMessage(STATIC_BETA_NOTICE);
      return;
    }

    if (!isBackendApiEnabled()) {
      setMessage("백엔드 API가 연결되어야 로그를 볼 수 있습니다.");
      return;
    }

    setAutomationBusy(true);

    try {
      const data = await requestBackend("/api/comment-automation/logs");
      appendAutomationLogs(
        [
          ...(data.logs || []),
          ...(data.files || []).map((file) => `${file.name} (${Math.ceil(file.size / 1024)}KB)`)
        ],
        data.ok ? "info" : "fail"
      );
      setMessage(data.message || "로그 정보를 불러왔습니다.");
    } catch (error) {
      appendAutomationLogs(`로그 보기 실패: ${error.message}`, "fail");
      setMessage("로그 정보를 불러오지 못했습니다.");
    } finally {
      setAutomationBusy(false);
    }
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

  const toggleCommentSelected = (id, selected) => {
    setComments((current) =>
      current.map((comment) =>
        comment.id === id
          ? {
              ...comment,
              selected
            }
          : comment
      )
    );
  };

  const saveWork = () => {
    const payload = {
      form,
      comments,
      mode,
      bridge,
      capture: {
        ocrText: captureOcrText,
        ocrMeta: captureOcrMeta,
        reviewComments: captureReviewComments
      },
      automationLogs,
      automationReport,
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
    setMode(normalizeInitialMode(nextWork.mode));
    setBridge(nextWork.bridge || createCommentCollectionBridge());
    setCaptureImage((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setCaptureOcrText(nextWork.capture?.ocrText || "");
    setCaptureOcrMeta(nextWork.capture?.ocrMeta || { provider: "", confidence: 0, warnings: [], blocked: false, blockedReason: "" });
    setCaptureOcrEdited(false);
    setCaptureRawOpen(false);
    setCaptureReviewComments(
      (nextWork.capture?.reviewComments || []).map((comment, index) =>
        normalizeCaptureReviewComment(comment, index, comment.extractionConfidence || nextWork.capture?.ocrMeta?.confidence || 0)
      )
    );
    setAutomationLogs(nextWork.automationLogs || []);
    setAutomationReport(nextWork.automationReport || createEmptyReport());
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
    setMode("manual");
    setCaptureImage((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setCaptureOcrText("");
    setCaptureOcrMeta({ provider: "", confidence: 0, warnings: [], blocked: false, blockedReason: "" });
    setCaptureOcrEdited(false);
    setCaptureRawOpen(false);
    setCaptureReviewComments([]);
    setBridge(createCommentCollectionBridge());
    setAutomationLogs([]);
    setAutomationReport(createEmptyReport());
    setStatus("idle");
    setMessage("댓글 응답 작업을 초기화했습니다.");
  };

  return (
    <div className="min-w-0 space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold text-coral">
            {isQuickReply ? "댓글 캡처 원클릭 초안" : "키워드와 말투까지 조정하는 대댓글"}
          </p>
          <h2 className="mt-1 text-3xl font-bold tracking-normal">
            {isQuickReply ? "원클릭 대댓글 작성" : "SEO 최적화 대댓글 작성"}
          </h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-ink/55">
            {isQuickReply
              ? "댓글 캡처 이미지를 넣으면 댓글별 상호 대댓글 초안을 만들어드립니다."
              : "포스팅 URL 또는 제목, 키워드, 브랜드명, 말투, CTA, 금지어를 조정해 댓글별 대댓글 초안을 만듭니다."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={isQuickReply ? "캡처 중심" : modeLabels[mode] || "수동 댓글 입력"} status="ready" />
          <StatusBadge label={statusLabel[status] || statusLabel.idle} status={status} />
          <span className="inline-flex min-h-8 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink/65">
            {generatedCount}/{comments.length} 처리
          </span>
        </div>
      </header>

      <div className="rounded-lg border border-moss/20 bg-moss/10 p-4 text-sm font-semibold leading-6 text-ink/70">
        <p className="font-bold text-moss">
          {isQuickReply ? "대댓글은 이렇게 만들어요" : "최적화 대댓글은 이렇게 만들어요"}
        </p>
        <p className="mt-1">
          {isQuickReply
            ? "댓글 캡처 이미지나 댓글 내용을 입력하면 댓글별 대댓글 초안이 생성됩니다."
            : "포스팅 제목, 키워드, 댓글 내용을 입력하면 말투와 CTA를 반영한 대댓글 초안이 생성됩니다."}
        </p>
      </div>

      {message && (
        <p className="rounded-md border border-line bg-white px-4 py-3 text-sm font-semibold text-moss shadow-soft">
          {message}
        </p>
      )}

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(300px,340px)_minmax(0,1fr)]">
        <section className="order-2 min-w-0 rounded-lg border border-line bg-white p-5 shadow-soft xl:order-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold">{isQuickReply ? "포스팅 주제" : "최적화 입력"}</h3>
            <span className="rounded-md bg-paper px-2.5 py-1 text-xs font-semibold text-ink/60">
              {isQuickReply ? "원클릭" : urlMode ? (ready ? "자동화 준비" : "URL 입력 필요") : "세부 조정"}
            </span>
          </div>

          <div className="mt-5 space-y-5">
            {urlMode && (
            <label className="block">
              <FieldLabel required={urlMode}>블로그 포스팅 URL</FieldLabel>
              <div className="mt-2 flex min-h-11 items-center gap-2 rounded-md border border-line bg-paper px-3">
                <Link size={17} className="text-ink/45" aria-hidden="true" />
                <input
                  value={form.blogUrl}
                  onChange={(event) => updateForm("blogUrl", event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  placeholder="https://blog.naver.com/..."
                />
              </div>
              <p className="mt-1 text-xs font-semibold text-ink/45">
                URL 자동 수집/등록에 필요합니다.
              </p>
            </label>
            )}

            <label className="block">
              <FieldLabel>{isQuickReply ? "포스팅 주제" : "포스팅 제목"}</FieldLabel>
              <input
                value={form.postTitle}
                onChange={(event) => updateForm("postTitle", event.target.value)}
                className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                placeholder={isQuickReply ? "예: 역삼역 중식당 회식 후기 / 신논현 피부관리 방문 후기" : "예: 강남 피부관리샵 리프팅 처음 방문 전 확인할 기준"}
              />
              <p className="mt-1 text-xs font-semibold text-ink/45">
                {isQuickReply
                  ? "선택 입력입니다. 입력하면 댓글 분위기에 맞는 대댓글을 더 자연스럽게 만들 수 있습니다."
                  : "포스팅 URL 대신 제목만 입력해도 최적화 대댓글을 만들 수 있습니다."}
              </p>
            </label>

            {!isQuickReply && (
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
            )}

            {!isQuickReply && (
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
                <FieldLabel>금지어</FieldLabel>
                <input
                  value={form.forbiddenWords}
                  onChange={(event) => updateForm("forbiddenWords", event.target.value)}
                  className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                  placeholder="예: 최고, 무조건, 보장"
                />
              </label>
            </div>
            )}

            <details
              key={`advanced-${mode}`}
              open={urlMode}
              className="rounded-md border border-line bg-paper p-3"
            >
              <summary className="cursor-pointer text-sm font-bold text-ink/70">
                {isQuickReply ? "자세한 설정 열기" : "고급 설정 열기"}
              </summary>

              <div className="mt-4 space-y-4">
                {isQuickReply && (
                  <>
                    <label className="block">
                      <FieldLabel>메인 키워드</FieldLabel>
                      <input
                        value={form.mainKeyword}
                        onChange={(event) => updateForm("mainKeyword", event.target.value)}
                        className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
                        placeholder={resolvedMainKeyword ? `자동 사용: ${resolvedMainKeyword}` : "예: 회식 장소, 메뉴 추천, 주차 확인"}
                      />
                    </label>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <FieldLabel>말투</FieldLabel>
                        <select
                          value={form.tone}
                          onChange={(event) => updateForm("tone", event.target.value)}
                          className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
                        >
                          {makerOptions.tones.map((tone) => (
                            <option key={`quick-${tone}`} value={tone}>
                              {tone}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <FieldLabel>금지어</FieldLabel>
                        <input
                          value={form.forbiddenWords}
                          onChange={(event) => updateForm("forbiddenWords", event.target.value)}
                          className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
                          placeholder="예: 광고 티, 무조건, 최고, 보장"
                        />
                      </label>
                    </div>
                  </>
                )}

                {!urlMode && !isQuickReply && (
                  <label className="block">
                    <FieldLabel>블로그 포스팅 URL</FieldLabel>
                    <div className="mt-2 flex min-h-11 items-center gap-2 rounded-md border border-line bg-white px-3">
                      <Link size={17} className="text-ink/45" aria-hidden="true" />
                      <input
                        value={form.blogUrl}
                        onChange={(event) => updateForm("blogUrl", event.target.value)}
                        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                        placeholder="수동/캡처에서는 선택 입력"
                      />
                    </div>
                  </label>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <FieldLabel>브랜드명/매장명</FieldLabel>
                    <input
                      value={form.brandName}
                      onChange={(event) => updateForm("brandName", event.target.value)}
                      className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
                      placeholder="예: 우리 매장명"
                    />
                  </label>

                  <label className="block">
                    <FieldLabel>지역</FieldLabel>
                    <input
                      value={form.region}
                      onChange={(event) => updateForm("region", event.target.value)}
                      className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
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
                            : "border-line bg-white hover:border-coral"
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

                <label className="block">
                  <FieldLabel>CTA 톤</FieldLabel>
                  <input
                    value={form.ctaTone}
                    onChange={(event) => updateForm("ctaTone", event.target.value)}
                    className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
                    placeholder="예: 편하게 문의 주세요"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <FieldLabel>내 블로그 닉네임</FieldLabel>
                    <input
                      value={form.ownerNickname}
                      onChange={(event) => updateForm("ownerNickname", event.target.value)}
                      className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
                      placeholder="예: 블로그지기"
                    />
                  </label>

                  <label className="block">
                    <FieldLabel>owner aliases</FieldLabel>
                    <input
                      value={form.ownerAliases}
                      onChange={(event) => updateForm("ownerAliases", event.target.value)}
                      className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 text-sm"
                      placeholder="쉼표로 구분"
                    />
                  </label>
                </div>

                {urlMode && (
                  <div className="rounded-md border border-line bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <ShieldCheck size={18} className="text-moss" aria-hidden="true" />
                        <div>
                          <p className="text-sm font-bold">URL 브리지</p>
                          <p className="text-xs font-semibold text-ink/50">
                            {bridge.baseUrl || bridge.nextIntegration || "blog-automation"}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`rounded-md border px-2.5 py-1 text-xs font-bold ${
                          bridgeStatusClassName[bridgeChecking ? "checking" : bridgeConnected ? "connected" : "not_connected"]
                        }`}
                      >
                        {bridgeStatusLabel}
                      </span>
                    </div>
                    <p className="mt-3 text-xs font-semibold leading-5 text-ink/55">
                      {bridgeConnected
                        ? bridge.session?.ok
                          ? "네이버 로그인 세션이 확인되었습니다."
                          : bridge.session?.message || "브리지는 연결됐지만 네이버 로그인 세션 확인이 필요합니다."
                        : "URL 자동 수집 기능을 사용하려면 blog-automation 브리지가 실행 중이어야 합니다."}
                    </p>
                  </div>
                )}
              </div>
            </details>
          </div>

          {!isQuickReply && (
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
          )}
        </section>

        <section className="order-1 flex min-w-0 flex-col gap-5 xl:order-2">
          {mode === "capture" && (
          <div className="order-2 min-w-0 rounded-lg border border-line bg-white p-5 shadow-soft">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <ImageIcon size={19} className="text-moss" aria-hidden="true" />
                  <h3 className="text-lg font-bold">{isQuickReply ? "댓글 캡처 이미지" : "캡처 붙여넣기"}</h3>
                </div>
                <p className="mt-1 text-sm font-semibold leading-6 text-ink/55">
                  {isQuickReply
                    ? "댓글 캡처 이미지를 넣으면 댓글별 상호 대댓글 초안을 만들어드립니다."
                    : "캡처에서 추출한 댓글을 확인한 뒤, 전체 상호대댓글 생성을 누르면 댓글별 맞춤 답글을 만들 수 있습니다."}
                </p>
                <p className="mt-2 text-xs font-semibold leading-5 text-ink/50">
                  댓글 글자가 크게 보이도록 댓글 영역만 캡처해주세요. 전체 화면보다 댓글 부분만 확대해서 캡처하면 더 정확하게 읽을 수 있습니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={captureFileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleCaptureImageUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => captureFileInputRef.current?.click()}
                  disabled={automationBusy}
                  className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white transition hover:bg-[#456b61] disabled:cursor-not-allowed disabled:bg-ink/25"
                >
                  <Upload size={16} aria-hidden="true" />
                  캡처 이미지 업로드
                </button>
                <button
                  type="button"
                  onClick={parseCurrentCaptureText}
                  disabled={automationBusy}
                  className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  <ListChecks size={16} aria-hidden="true" />
                  OCR 텍스트 댓글 분리
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(300px,420px)_minmax(0,1fr)]">
              <div className="min-w-0">
                <div
                  ref={capturePasteZoneRef}
                  tabIndex={0}
                  onPaste={handleCapturePaste}
                  onDragEnter={handleCaptureDragOver}
                  onDragOver={handleCaptureDragOver}
                  onDragLeave={handleCaptureDragLeave}
                  onDrop={handleCaptureDrop}
                  onClick={(event) => {
                    if (!event.target.closest?.("button")) capturePasteZoneRef.current?.focus();
                  }}
                  className={`focus-ring min-h-[420px] rounded-lg border-2 border-dashed bg-paper p-4 transition ${
                    captureDragActive
                      ? "border-moss bg-moss/10"
                      : "border-line hover:border-moss hover:bg-white"
                  }`}
                >
                  <div className="flex h-full flex-col gap-4">
                    <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md border border-line bg-white">
                      {captureImage?.previewUrl ? (
                        <img
                          src={captureImage.previewUrl}
                          alt="업로드한 댓글 캡처 미리보기"
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <div className="px-4 text-center">
                          <Clipboard size={30} className="mx-auto text-moss" aria-hidden="true" />
                          <p className="mt-3 text-base font-bold text-ink">
                            캡처 이미지를 Ctrl+V로 붙여넣기
                          </p>
                          <p className="mt-2 text-sm font-semibold leading-6 text-ink/55">
                            댓글이 작게 보이면 OCR이 정확히 읽지 못할 수 있습니다. 댓글 텍스트가 선명하게 보이도록 캡처해주세요.
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      <p className="text-sm font-bold text-ink">
                        파일로 저장하지 않아도 캡처한 이미지를 바로 붙여넣을 수 있습니다.
                      </p>
                      <ol className="grid gap-1 text-xs font-semibold leading-5 text-ink/60">
                        <li>1. 댓글 영역만 확대해서 캡처합니다.</li>
                        <li>2. 이 박스를 클릭합니다.</li>
                        <li>3. Ctrl+V로 붙여넣습니다.</li>
                        <li>4. 추출된 댓글을 확인하고 필요하면 수정합니다.</li>
                        <li>5. {generateAllLabel}을 누릅니다.</li>
                      </ol>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => captureFileInputRef.current?.click()}
                          disabled={automationBusy}
                          className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:text-ink/30"
                        >
                          <Upload size={16} aria-hidden="true" />
                          또는 이미지 파일 선택
                        </button>
                        {captureImage && (
                          <span className="inline-flex min-h-10 items-center rounded-md bg-white px-3 text-xs font-bold text-moss">
                            새 캡처를 붙여넣으면 미리보기가 교체됩니다.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                {captureImage && (
                  <div className="mt-2 rounded-md bg-paper px-3 py-2 text-xs font-semibold leading-5 text-ink/55">
                    <p>
                      {captureImage.name} · {Math.max(1, Math.ceil(captureImage.size / 1024))}KB
                      {captureImage.width && captureImage.height ? ` · ${captureImage.width}x${captureImage.height}px` : ""}
                    </p>
                    {captureImage.qualityWarnings?.map((warning) => (
                      <p key={warning} className="mt-1 text-[#7a5a1e]">
                        {warning}
                      </p>
                    ))}
                    {captureOcrMeta.confidence > 0 && captureOcrMeta.confidence < 0.5 && (
                      <p className="mt-1 text-[#7a5a1e]">
                        이미지가 작거나 글자가 흐리면 댓글을 정확히 읽지 못할 수 있습니다.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold">추출 결과 확인</p>
                    <p className="mt-1 text-xs font-semibold text-ink/50">
                      이미지에서 읽은 원문과 자동 분리된 댓글을 확인한 뒤 댓글 카드로 반영하세요.
                    </p>
                  </div>
                  {captureOcrMeta.provider && (
                    <span className="rounded-md bg-paper px-2.5 py-1 text-xs font-bold text-ink/55">
                      {captureOcrMeta.provider}
                    </span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={parseCurrentCaptureText}
                    disabled={automationBusy}
                    className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white transition hover:bg-[#456b61] disabled:cursor-not-allowed disabled:bg-ink/25"
                  >
                    <ListChecks size={16} aria-hidden="true" />
                    이미지에서 댓글 추출
                  </button>
                  <button
                    type="button"
                    onClick={addCaptureReviewComment}
                    className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-moss hover:text-moss"
                  >
                    <Plus size={16} aria-hidden="true" />
                    빈 댓글 직접 추가
                  </button>
                  <button
                    type="button"
                    onClick={() => applyCaptureReviewToComments()}
                    disabled={captureReviewValidCount === 0}
                    className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-coral px-3 text-sm font-semibold text-white transition hover:bg-[#bf5d4d] disabled:cursor-not-allowed disabled:bg-ink/25"
                  >
                    <Check size={16} aria-hidden="true" />
                    댓글 카드로 반영
                  </button>
                  <button
                    type="button"
                    onClick={generateCaptureReviewReplies}
                    disabled={captureReviewValidCount === 0 || status === "generating" || automationBusy}
                    className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white transition hover:bg-ink/85 disabled:cursor-not-allowed disabled:bg-ink/25"
                  >
                    {status === "generating" ? (
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Sparkles size={16} aria-hidden="true" />
                    )}
                    {status === "generating" ? "생성 중..." : `${generateAllLabel} (${captureReviewValidCount}개)`}
                  </button>
                </div>
                <p
                  className={`mt-2 text-xs font-semibold ${
                    captureReviewValidCount === 0 || automationBusy ? "text-coral" : "text-ink/50"
                  }`}
                >
                  {captureReviewGenerateHint}
                </p>

                {captureOcrMeta.blocked && (
                  <div className="mt-3 rounded-md border border-amber/30 bg-amber/10 p-3">
                    <p className="text-sm font-bold text-[#7a5a1e]">
                      {captureOcrMeta.blockedReason || OCR_LOW_CONFIDENCE_MESSAGE}
                    </p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-[#7a5a1e]">
                      {OCR_MANUAL_INPUT_MESSAGE}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={focusManualCommentInput}
                        className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-xs font-bold text-white transition hover:bg-[#456b61]"
                      >
                        <MessageSquare size={14} aria-hidden="true" />
                        댓글 직접 입력하기
                      </button>
                      <button
                        type="button"
                        onClick={focusCaptureOcrText}
                        className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-amber/40 bg-white px-3 text-xs font-bold text-[#7a5a1e] transition hover:bg-amber/10"
                      >
                        <FileText size={14} aria-hidden="true" />
                        OCR 원문 직접 수정
                      </button>
                      <button
                        type="button"
                        onClick={() => captureFileInputRef.current?.click()}
                        className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-amber/40 bg-white px-3 text-xs font-bold text-[#7a5a1e] transition hover:bg-amber/10"
                      >
                        <Upload size={14} aria-hidden="true" />
                        다시 캡처 업로드
                      </button>
                      {captureOcrText.trim() && (
                        <button
                          type="button"
                          onClick={forceParseCurrentCaptureText}
                          className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-xs font-bold text-ink/60 transition hover:border-moss hover:text-moss"
                        >
                          <ListChecks size={14} aria-hidden="true" />
                          그래도 댓글 카드로 반영
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold">자동 분리된 댓글</p>
                    <span className="rounded-md bg-paper px-2.5 py-1 text-xs font-bold text-ink/55">
                      {captureReviewComments.length}개
                    </span>
                  </div>
                  {captureReviewComments.length > 0 ? (
                    captureReviewComments.map((comment, index) => (
                      <div key={comment.id} className="rounded-md border border-line bg-paper p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <span className="text-xs font-bold text-ink/45">추출 댓글 {index + 1}</span>
                          <div className="flex flex-wrap gap-2">
                            <span className="rounded-md bg-white px-2.5 py-1 text-xs font-bold text-[#7a5a1e]">
                              {comment.extractionStatus || "확인 필요"}
                              {comment.extractionConfidence > 0
                                ? ` ${Math.round(comment.extractionConfidence * 100)}%`
                                : ""}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeCaptureReviewComment(comment.id)}
                              className="focus-ring inline-flex min-h-8 items-center justify-center gap-1 rounded-md border border-line bg-white px-2.5 text-xs font-bold text-ink/55 transition hover:border-coral hover:text-coral"
                            >
                              <Trash2 size={14} aria-hidden="true" />
                              삭제
                            </button>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2">
                          <input
                            value={comment.author}
                            onChange={(event) => updateCaptureReviewComment(comment.id, "author", event.target.value)}
                            className="focus-ring min-h-10 w-full rounded-md border border-line bg-white px-3 text-sm font-semibold"
                            placeholder="작성자"
                          />
                          <textarea
                            value={comment.content}
                            onChange={(event) => updateCaptureReviewComment(comment.id, "content", event.target.value)}
                            rows={3}
                            className="focus-ring w-full rounded-md border border-line bg-white p-3 text-sm leading-6"
                            placeholder="댓글 내용"
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md border border-dashed border-line bg-paper p-4 text-sm font-semibold leading-6 text-ink/55">
                      이미지에서 댓글을 정확히 찾지 못했습니다. 댓글 내용을 아래에 직접 붙여넣거나 `빈 댓글 직접 추가`로 직접 입력해주세요.
                    </div>
                  )}
                </div>

                <details
                  open={captureRawOpen}
                  onToggle={(event) => setCaptureRawOpen(event.currentTarget.open)}
                  className="mt-4 rounded-md border border-line bg-paper p-3"
                >
                  <summary className="cursor-pointer text-sm font-bold text-ink/65">
                    OCR 원문 전체 보기 / 직접 수정
                  </summary>
                  {(captureOcrMeta.blocked || (captureOcrMeta.confidence > 0 && captureOcrMeta.confidence < 0.5)) && (
                    <p className="mt-3 rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-xs font-semibold leading-5 text-[#7a5a1e]">
                      아래 원문은 OCR이 잘못 읽었을 수 있습니다. 필요하면 직접 수정한 뒤 댓글 추출을 다시 눌러주세요.
                    </p>
                  )}
                  <textarea
                    ref={captureOcrTextareaRef}
                    value={captureOcrText}
                    onChange={(event) => {
                      setCaptureOcrText(event.target.value);
                      setCaptureOcrEdited(true);
                    }}
                    rows={8}
                    className="focus-ring mt-3 w-full rounded-md border border-line bg-white p-3 text-sm leading-6"
                    placeholder={"이미지에서 댓글을 자동으로 읽지 못했다면 여기에 OCR 원문이나 댓글 텍스트를 붙여넣어 주세요.\n예: 작성자: 민지님\n댓글: 탕수육 바삭해 보여요. 주차도 가능한가요?\n\n작성자: 이웃님\n댓글: 회식 장소로 괜찮아 보여서 저장했어요."}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCaptureOcrEdited(true);
                        parseCaptureTextToReview(captureOcrText, 1, { source: "manual-edit" });
                      }}
                      className="focus-ring inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-xs font-bold text-white transition hover:bg-[#456b61]"
                    >
                      <ListChecks size={14} aria-hidden="true" />
                      수정한 원문에서 다시 댓글 추출
                    </button>
                  </div>
                  {captureOcrMeta.warnings?.length > 0 && (
                    <div className="mt-3 space-y-1 rounded-md border border-amber/30 bg-amber/10 px-3 py-2">
                      {captureOcrMeta.warnings.map((warning) => (
                        <p key={warning} className="text-xs font-semibold text-[#7a5a1e]">
                          {warning}
                        </p>
                      ))}
                    </div>
                  )}
                </details>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  handleGenerateAllContextualReplies({
                    confirmRegenerate: true,
                    seed: comments.some((comment) => comment.reply) ? Date.now() : 0
                  })
                }
                disabled={captureReplyTargetCount === 0 || status === "generating" || automationBusy}
                className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-coral px-3 text-sm font-semibold text-white transition hover:bg-[#bf5d4d] disabled:cursor-not-allowed disabled:bg-ink/25"
              >
                {status === "generating" ? (
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles size={16} aria-hidden="true" />
                )}
                {status === "generating" ? "생성 중..." : `${generateAllLabel} (${captureReplyTargetCount}개)`}
              </button>
              <button
                type="button"
                onClick={() => copyText(toReplySetText(comments), "캡처 댓글 원댓글과 대댓글 세트를 복사했습니다.")}
                disabled={!comments.some((comment) => comment.reply)}
                className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-amber hover:text-[#7a5a1e] disabled:cursor-not-allowed disabled:text-ink/30"
              >
                <Clipboard size={16} aria-hidden="true" />
                전체 대댓글 복사하기
              </button>
            </div>
            <p
              className={`mt-2 text-xs font-semibold ${
                captureReplyTargetCount === 0 || automationBusy ? "text-coral" : "text-ink/50"
              }`}
            >
              {captureCardGenerateHint}
            </p>
          </div>
          )}

          {!isQuickReply && (
          <div className="order-1 min-w-0 rounded-lg border border-line bg-white p-5 shadow-soft">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Bot size={19} className="text-moss" aria-hidden="true" />
                  <h3 className="text-lg font-bold">입력 방식</h3>
                </div>
                <p className="mt-1 text-sm font-semibold text-ink/55">
                  수동 입력, 캡처 이미지, URL 브리지 중 작업 방식을 선택합니다.
                </p>
              </div>
              {urlMode && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={checkBridgeStatus}
                  disabled={automationBusy || staticBeta}
                  className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:text-ink/30"
                  title={staticBeta ? "정적 베타에서는 로컬 브리지를 사용할 수 없습니다." : "브리지 상태 확인"}
                >
                  {automationBusy && bridgeChecking ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}
                  브리지 상태 확인
                </button>
                <button
                  type="button"
                  onClick={loadAutomationLogs}
                  disabled={automationBusy || staticBeta}
                  className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-amber hover:text-[#7a5a1e] disabled:cursor-not-allowed disabled:text-ink/30"
                  title={staticBeta ? "정적 베타에서는 로컬 자동화 로그를 볼 수 없습니다." : "자동화 로그 보기"}
                >
                  <Eye size={16} aria-hidden="true" />
                  로그 보기
                </button>
              </div>
              )}
            </div>

            <div className="mt-4 grid gap-2 lg:grid-cols-3">
              {automationModes.map((item) => {
                const disabled = staticBeta && item.requiresBridge;

                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={mode === item.id && !disabled}
                    onClick={() => {
                      if (disabled) {
                        setMessage(STATIC_BETA_NOTICE);
                        return;
                      }

                      setMode(item.id);
                      const nextNeedsUrl = !staticBeta && (item.id === "url-review" || item.id === "url-auto");
                      setStatus(form.postTitle.trim() && (!nextNeedsUrl || form.blogUrl.trim()) ? "ready" : "idle");
                    }}
                    disabled={disabled}
                    className={`focus-ring min-h-11 rounded-md border px-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:border-line disabled:bg-paper disabled:text-ink/30 ${
                      mode === item.id && !disabled
                        ? "border-moss bg-moss text-white"
                        : "border-line bg-paper text-ink/70 hover:border-moss"
                    }`}
                    title={disabled ? "정적 베타에서는 로컬 브리지 기능이 비활성화됩니다." : item.label}
                  >
                    {item.label}
                    {mode === item.id && !disabled && <span className="ml-2 text-[11px]">선택됨</span>}
                    {disabled && <span className="ml-2 text-[11px]">로컬 전용</span>}
                  </button>
                );
              })}
            </div>

            {staticBeta && (
              <p className="mt-4 rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm font-semibold leading-6 text-[#7a5a1e]">
                {STATIC_BETA_NOTICE}
              </p>
            )}

            {urlMode && (
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <button
                type="button"
                onClick={loadCommentsFromUrl}
                disabled={!urlReady || !canScanComments || automationBusy}
                className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white transition hover:bg-[#456b61] disabled:cursor-not-allowed disabled:bg-ink/25"
              >
                <FileText size={16} aria-hidden="true" />
                댓글 불러오기
              </button>
              <button
                type="button"
                onClick={() => generateAll()}
                disabled={!ready || validComments.length === 0 || status === "generating" || automationBusy}
                className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-coral px-3 text-sm font-semibold text-white transition hover:bg-[#bf5d4d] disabled:cursor-not-allowed disabled:bg-ink/25"
              >
                <Sparkles size={16} aria-hidden="true" />
                대댓글 초안 만들기
              </button>
              <button
                type="button"
                onClick={registerSelectedReplies}
                disabled={!urlReady || !canRegisterReplies || selectedComments.length === 0 || automationBusy}
                className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:text-ink/30"
              >
                <Send size={16} aria-hidden="true" />
                선택 댓글 등록
              </button>
              <button
                type="button"
                onClick={runAutoRegister}
                disabled={!urlReady || !canRunLegacyAuto || automationBusy}
                className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-coral px-3 text-sm font-semibold text-coral transition hover:bg-coral hover:text-white disabled:cursor-not-allowed disabled:border-line disabled:text-ink/30"
              >
                <Play size={16} aria-hidden="true" />
                전체 자동 등록
              </button>
              <button
                type="button"
                onClick={stopAutomationWork}
                disabled={!automationBusy}
                className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-coral hover:text-coral disabled:cursor-not-allowed disabled:text-ink/30 md:col-span-2 xl:col-span-4"
              >
                <StopCircle size={16} aria-hidden="true" />
                작업 중지
              </button>
            </div>
            )}

            {!bridgeConnected && urlMode && (
              <p className="mt-4 rounded-md border border-coral/20 bg-coral/10 px-3 py-2 text-sm font-semibold text-coral">
                브리지 미연결 상태에서는 수동 모드만 사용할 수 있습니다.
              </p>
            )}

            {urlMode && <ReportGrid report={liveReport} />}

            {urlMode && automationLogs.length > 0 && (
              <div className="mt-4 max-h-48 overflow-auto rounded-md border border-line bg-paper p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-bold text-ink/55">
                  <ListChecks size={14} aria-hidden="true" />
                  작업 로그
                </div>
                <div className="space-y-1">
                  {automationLogs.slice(0, 18).map((log) => (
                    <p
                      key={log.id}
                      className={`text-xs font-semibold leading-5 ${
                        log.level === "fail"
                          ? "text-coral"
                          : log.level === "success"
                            ? "text-moss"
                            : log.level === "retry"
                              ? "text-[#7a5a1e]"
                              : "text-ink/60"
                      }`}
                    >
                      <span className="text-ink/35">{log.time}</span> {log.message}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}

          {mode === "manual" && (
          <div className="order-2 min-w-0 rounded-lg border border-line bg-white p-5 shadow-soft">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare size={19} className="text-moss" aria-hidden="true" />
              <h3 className="text-lg font-bold">댓글 직접 입력</h3>
              </div>
            </div>

            <textarea
              ref={manualInputRef}
              value={manualInput}
              onChange={(event) => setManualInput(event.target.value)}
              rows={6}
              className="focus-ring mt-4 w-full rounded-md border border-line bg-paper p-3 text-sm leading-6"
              placeholder={
                isQuickReply
                  ? "댓글만 입력해도 대댓글을 만들 수 있습니다.\n\n탕수육 진짜 바삭해 보여요\n\n회식 장소로 괜찮아 보여서 저장했어요\n\n주차 정보도 궁금해요\n\n작성자를 넣고 싶다면:\n작성자: 민지님\n댓글: 탕수육 진짜 바삭해 보여요"
                  : "댓글만 입력해도 대댓글을 만들 수 있습니다.\n\n가격 상담은 어떻게 하나요?\n\n예약 전에 확인할 포인트가 궁금해요\n\n직접 방문한 후기라 더 믿음이 가네요\n\n작성자를 넣고 싶다면:\n작성자: 이웃님\n댓글: 예약 전에 확인할 포인트가 궁금해요"
              }
            />
            <p className="mt-2 text-xs font-semibold leading-5 text-ink/50">
              작성자명은 선택입니다. 빈 줄 기준 또는 한 줄씩 댓글 카드로 나눌 수 있습니다.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={appendManualComments}
                className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white transition hover:bg-[#456b61]"
              >
                <ListChecks size={16} aria-hidden="true" />
                댓글 목록에 넣기
              </button>
              <button
                type="button"
                onClick={() => generateAll()}
                disabled={validComments.length === 0 || status === "generating"}
                className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-coral px-3 text-sm font-semibold text-white transition hover:bg-[#bf5d4d] disabled:cursor-not-allowed disabled:bg-ink/25"
              >
                {status === "generating" ? (
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles size={16} aria-hidden="true" />
                )}
                {status === "generating" ? "생성 중..." : `${generateAllLabel} (${validComments.length}개)`}
              </button>
              <button
                type="button"
                onClick={() => copyText(toReplySetText(comments), "전체 댓글과 대댓글을 복사했습니다.")}
                disabled={!comments.some((comment) => comment.reply || comment.status === "스킵 권장")}
                className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-amber hover:text-[#7a5a1e] disabled:cursor-not-allowed disabled:text-ink/30"
              >
                <Clipboard size={16} aria-hidden="true" />
                전체 대댓글 복사하기
              </button>
            </div>
            {validComments.length > 0 && !replyContextReady && (
              <p className="mt-2 text-xs font-semibold leading-5 text-ink/50">
                포스팅 제목이나 메인 키워드를 넣으면 더 자연스럽지만, 댓글 내용만으로도 생성할 수 있습니다.
              </p>
            )}
            <details className="mt-3 rounded-md border border-line bg-paper p-3">
              <summary className="cursor-pointer text-sm font-bold text-ink/65">보조 작업</summary>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => addComment()}
                  className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold transition hover:border-moss hover:text-moss"
                >
                  <Plus size={16} aria-hidden="true" />
                  빈 댓글 직접 추가
                </button>
                <button
                  type="button"
                  onClick={() => generateAll({ seed: Date.now(), confirmRegenerate: true })}
                  disabled={validComments.length === 0 || status === "generating"}
                  className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold transition hover:border-coral hover:text-coral disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  <RotateCcw size={16} aria-hidden="true" />
                  대댓글 다시 만들기
                </button>
              </div>
            </details>
          </div>
          )}

          <div className="order-3 min-w-0 rounded-lg border border-line bg-white p-5 shadow-soft">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h3 className="text-lg font-bold">댓글 목록</h3>
                <p className="mt-1 text-sm font-semibold text-ink/55">
                  메인 키워드: {form.mainKeyword.trim() || resolvedMainKeyword || "자동 추출 대기"}
                </p>
                {comments.some((comment) => comment.reply) && (
                  <p className="mt-2 rounded-md border border-moss/20 bg-moss/10 px-3 py-2 text-xs font-semibold leading-5 text-ink/60">
                    초안은 복사 후 내 말투에 맞게 한 번만 다듬으면 더 자연스럽습니다.
                  </p>
                )}
              </div>
              {mode !== "manual" && (
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <button
                  type="button"
                  onClick={() => copyText(toReplyListText(comments), "전체 대댓글 목록을 복사했습니다.")}
                  disabled={!comments.some((comment) => comment.reply)}
                  className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-amber hover:text-[#7a5a1e] disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  <Clipboard size={16} aria-hidden="true" />
                  대댓글만 복사하기
                </button>
                <button
                  type="button"
                  onClick={() => copyText(toReplySetText(comments), "원댓글과 대댓글 세트를 복사했습니다.")}
                  disabled={!comments.some((comment) => comment.reply || comment.status === "스킵 권장")}
                  className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold transition hover:border-amber hover:text-[#7a5a1e] disabled:cursor-not-allowed disabled:text-ink/30"
                >
                  <Copy size={16} aria-hidden="true" />
                  댓글+대댓글 복사하기
                </button>
              </div>
              )}
            </div>

            <div className="mt-5 grid min-w-0 gap-4">
              {comments.map((comment, index) => {
                const forbiddenWordsText = comment.forbiddenWordsFound?.length
                  ? comment.forbiddenWordsFound.join(", ")
                  : "없음";
                const duplicateClass =
                  duplicateClassName[comment.duplicateRisk] || duplicateClassName["중복 위험 낮음"];
                const displayName = getCommentDisplayName(comment, index);
                const hasAuthor = !isMissingAuthor(comment.author);

                return (
                  <article
                    key={comment.id}
                    className="min-w-0 rounded-lg border border-line bg-paper p-4"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-ink/45">{displayName}</span>
                          {urlMode && (
                            <label className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line bg-white px-2 text-xs font-bold text-ink/60">
                              <input
                                type="checkbox"
                                checked={Boolean(comment.selected)}
                                onChange={(event) => toggleCommentSelected(comment.id, event.target.checked)}
                                disabled={comment.status === "스킵 권장" || comment.hasOwnerReply || comment.isOwnerComment}
                                className="h-4 w-4 accent-[#52796f]"
                              />
                              선택
                            </label>
                          )}
                          <details className="rounded-md border border-line bg-white px-2 py-1 text-xs font-bold text-ink/55">
                            <summary className="cursor-pointer">
                              {hasAuthor ? `작성자: ${comment.author}` : "작성자 추가"}
                            </summary>
                            <input
                              value={isMissingAuthor(comment.author) ? "" : comment.author}
                              onChange={(event) => updateComment(comment.id, "author", event.target.value)}
                              className="focus-ring mt-2 min-h-9 w-44 rounded-md border border-line bg-paper px-2 text-sm font-semibold"
                              placeholder="선택 입력"
                            />
                          </details>
                          <SmallBadge>
                            {comment.source === "url" ? "URL 수집" : comment.source === "capture" ? "캡처 추출" : "수동"}
                          </SmallBadge>
                          <SmallBadge>{comment.type || "대기"}</SmallBadge>
                          <StatusPill status={comment.status} />
                          {comment.registerStatus && <SmallBadge>{comment.registerStatus}</SmallBadge>}
                          {comment.reviewed && (
                            <span className="inline-flex rounded-md bg-moss px-2.5 py-1 text-xs font-bold text-white">
                              검토 완료
                            </span>
                          )}
                        </div>
                        <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-ink/55">
                          <input
                            type="checkbox"
                            checked={comment.hasOwnerReply}
                            onChange={(event) => updateComment(comment.id, "hasOwnerReply", event.target.checked)}
                            className="h-4 w-4 accent-[#52796f]"
                          />
                          기존 내 답글 있음
                        </label>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-ink/45">
                          {comment.commentId && <span>식별값: {comment.commentId}</span>}
                          {comment.createdAt && <span>작성시간: {comment.createdAt}</span>}
                          {comment.isOwnerComment && <span className="text-coral">내 계정 원댓글</span>}
                          {comment.existingReplies?.length > 0 && <span>기존 대댓글 {comment.existingReplies.length}개</span>}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        <ActionButton
                          icon={Sparkles}
                          label="대댓글 만들기"
                          onClick={() => generateOne(comment.id)}
                          disabled={!comment.content.trim() || status === "generating" || (urlMode && comment.source !== "capture" && !ready)}
                        />
                        <ActionButton
                          icon={RefreshCw}
                          label="다시 만들기"
                          onClick={() => generateOne(comment.id, { regenerate: true })}
                          disabled={!comment.content.trim() || status === "generating" || (urlMode && comment.source !== "capture" && !ready)}
                        />
                        <ActionButton
                          icon={Copy}
                          label="이 대댓글 복사"
                          onClick={() => copyText(comment.reply, "대댓글을 복사했습니다.")}
                          disabled={!comment.reply}
                        />
                        <ActionButton icon={Trash2} label="삭제" onClick={() => removeComment(comment.id)} />
                        <details className="relative rounded-md border border-line bg-white px-2 py-1 text-xs font-bold text-ink/55">
                          <summary className="cursor-pointer leading-7">더보기</summary>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <ActionButton icon={SkipForward} label="스킵" onClick={() => markSkip(comment.id)} />
                            <ActionButton
                              icon={Check}
                              label="검토 완료"
                              onClick={() => markReviewed(comment.id)}
                              disabled={!comment.reply && comment.status !== "스킵 권장"}
                            />
                          </div>
                        </details>
                      </div>
                    </div>

                    <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-2">
                      <label className="block min-w-0">
                        <span className="text-xs font-bold text-ink/55">원댓글</span>
                        <textarea
                          value={comment.content}
                          onChange={(event) => updateComment(comment.id, "content", event.target.value)}
                          rows={4}
                          className="focus-ring mt-2 w-full rounded-md border border-line bg-white p-3 text-sm leading-6"
                          placeholder="댓글 내용"
                        />
                      </label>

                      <label className="block min-w-0">
                        <span className="text-xs font-bold text-ink/55">생성된 대댓글</span>
                        <textarea
                          value={comment.reply}
                          onChange={(event) => updateComment(comment.id, "reply", event.target.value)}
                          rows={4}
                          className="focus-ring mt-2 w-full rounded-md border border-line bg-white p-3 text-sm leading-6"
                          placeholder={comment.status === "스킵 권장" ? comment.skipReason || "스킵 권장" : "생성 대기"}
                        />
                      </label>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
                      <InfoChip label="키워드" value={comment.mainKeywordUsed ? "자연 반영" : "미반영"} />
                      <InfoChip
                        label="금지어"
                        value={forbiddenWordsText}
                        danger={Boolean(comment.forbiddenWordsFound?.length)}
                      />
                      <span className={`inline-flex rounded-md px-2.5 py-1 ${duplicateClass}`}>
                        {comment.duplicateRisk}
                      </span>
                      <InfoChip label="감정" value={comment.sentiment || "-"} />
                      <InfoChip label="의도" value={comment.intent || "-"} />
                      {comment.processStatus && <InfoChip label="처리" value={comment.processStatus} />}
                      {comment.retryCount > 0 && <InfoChip label="재시도" value={`${comment.retryCount}회`} />}
                      {comment.errorMessage && <InfoChip label="오류" value={comment.errorMessage} danger />}
                      {(comment.coreKeywords || []).length > 0 ? (
                        comment.coreKeywords.map((keyword) => (
                          <span
                            key={`${comment.id}-${keyword}`}
                            className="rounded-md bg-white px-2.5 py-1 text-ink/60"
                          >
                            #{keyword}
                          </span>
                        ))
                      ) : (
                        <InfoChip label="핵심 키워드" value="-" />
                      )}
                    </div>
                  </article>
                );
              })}
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

function ReportGrid({ report }) {
  const items = [
    ["총 댓글", report.totalComments],
    ["처리 대상", report.targetComments],
    ["스킵", report.skippedCount],
    ["생성", report.generatedCount],
    ["등록 성공", report.registeredCount],
    ["실패", report.failedCount],
    ["보류/재시도", report.retryCount],
    ["종료 사유", report.exitReason || "-"]
  ];

  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md border border-line bg-paper px-3 py-2">
          <p className="text-[11px] font-bold text-ink/45">{label}</p>
          <p className="mt-1 break-words text-sm font-bold text-ink">{value}</p>
        </div>
      ))}
      {report.failedComments?.length > 0 && (
        <div className="rounded-md border border-coral/30 bg-coral/10 px-3 py-2 sm:col-span-2 xl:col-span-4">
          <p className="text-[11px] font-bold text-coral">실패 댓글 목록</p>
          <div className="mt-1 space-y-1">
            {report.failedComments.slice(0, 4).map((item) => (
              <p key={`${item.id}-${item.reason}`} className="text-xs font-semibold text-coral">
                {item.author || "작성자 미입력"}: {item.reason}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
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

function InfoChip({ label, value, danger = false }) {
  return (
    <span className={`inline-flex rounded-md bg-white px-2.5 py-1 ${danger ? "text-coral" : "text-ink/60"}`}>
      {label}: {value}
    </span>
  );
}

function ActionButton({ icon: Icon, label, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="focus-ring inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-line bg-white px-2.5 text-xs font-bold transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:text-ink/30"
    >
      <Icon size={14} aria-hidden="true" />
      {label}
    </button>
  );
}
