import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, "../../..");
const defaultAutomationDir = path.resolve(projectRoot, "..", "블로그자동화", "blog-automation");
const defaultTimeoutMs = 5000;
const legacyRunTimeoutMs = 20 * 60 * 1000;

const trimTrailingSlash = (value) => String(value || "").replace(/\/+$/u, "");
const unique = (items = []) => Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));

const getAutomationBaseUrl = () =>
  trimTrailingSlash(
    process.env.BLOG_AUTOMATION_BASE_URL ||
      `http://127.0.0.1:${process.env.BLOG_AUTOMATION_PORT || "3000"}`
  );

const getAutomationDir = () => path.resolve(process.env.BLOG_AUTOMATION_DIR || defaultAutomationDir);

const createReport = (overrides = {}) => ({
  totalComments: 0,
  targetComments: 0,
  skippedCount: 0,
  generatedCount: 0,
  registeredCount: 0,
  failedCount: 0,
  retryCount: 0,
  exitReason: "",
  failedComments: [],
  ...overrides
});

const normalizeLogs = (logs = []) =>
  (Array.isArray(logs) ? logs : [logs])
    .flat()
    .map((log) => String(log || "").trim())
    .filter(Boolean);

const splitList = (value) =>
  Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[\n,]/u)
        .map((item) => item.trim())
        .filter(Boolean);

const getForm = (payload = {}) => payload.form || {};

const getPostUrl = (payload = {}) => payload.postUrl || payload.blogUrl || getForm(payload).blogUrl || getForm(payload).postUrl || "";

const getPostTitle = (payload = {}) => payload.postTitle || getForm(payload).postTitle || getForm(payload).title || "";

const getOwnerNickname = (payload = {}) => payload.ownerNickname || getForm(payload).ownerNickname || "";

const getOwnerAliases = (payload = {}) => unique([...splitList(payload.ownerAliases), ...splitList(getForm(payload).ownerAliases)]);

const buildBridgeScanPayload = (payload = {}) => ({
  ...payload,
  postUrl: getPostUrl(payload),
  postTitle: getPostTitle(payload),
  ownerNickname: getOwnerNickname(payload),
  ownerAliases: getOwnerAliases(payload)
});

const getCommentId = (comment = {}) => comment.commentId || comment.commentNo || comment.commentKey || comment.id || "";

const buildBridgeRegisterPayload = (payload = {}) => {
  const comments = Array.isArray(payload.comments) ? payload.comments : Array.isArray(payload.items) ? payload.items : [];

  return {
    postUrl: getPostUrl(payload),
    postTitle: getPostTitle(payload),
    ownerNickname: getOwnerNickname(payload),
    ownerAliases: getOwnerAliases(payload),
    items: comments.map((comment) => ({
      clientId: comment.id || getCommentId(comment),
      commentId: getCommentId(comment),
      replyText: comment.replyText || comment.reply || comment.text || ""
    }))
  };
};

const readPackageSummary = (automationDir) => {
  const packagePath = path.join(automationDir, "package.json");

  try {
    if (!fs.existsSync(packagePath)) {
      return {
        exists: false,
        packagePath
      };
    }

    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return {
      exists: true,
      packagePath,
      name: packageJson.name || "blog-automation",
      version: packageJson.version || "",
      scripts: packageJson.scripts || {}
    };
  } catch (error) {
    return {
      exists: false,
      packagePath,
      error: error.message
    };
  }
};

class BridgeHttpError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "BridgeHttpError";
    Object.assign(this, details);
  }
}

const requestJson = async (pathname, options = {}) => {
  const baseUrl = options.baseUrl || getAutomationBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || defaultTimeoutMs);

  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    });
    const raw = await response.text();
    let data = null;

    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = { raw };
      }
    }

    if (!response.ok) {
      throw new BridgeHttpError(data?.message || `blog-automation request failed: ${response.status}`, {
        statusCode: response.status,
        data,
        pathname
      });
    }

    return data || {};
  } catch (error) {
    if (error.name === "AbortError") {
      throw new BridgeHttpError("blog-automation request timed out.", {
        code: "BRIDGE_TIMEOUT",
        pathname
      });
    }

    if (error instanceof BridgeHttpError) throw error;

    throw new BridgeHttpError(error.message || "blog-automation request failed.", {
      code: "BRIDGE_NETWORK_ERROR",
      pathname
    });
  } finally {
    clearTimeout(timeout);
  }
};

const isUnsupportedEndpointError = (error) =>
  [404, 405, 501].includes(error?.statusCode) ||
  /cannot\s+(get|post)|not\s+found|route/i.test(error?.message || "");

const endpointExists = async (pathname, options = {}) => {
  const baseUrl = options.baseUrl || getAutomationBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || defaultTimeoutMs);

  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json"
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    });
    const raw = await response.text().catch(() => "");

    if ([404, 405, 501].includes(response.status)) return false;
    if (/cannot\s+(get|post)|not\s+found|route/i.test(raw)) return false;
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

const callFirstSupportedEndpoint = async (candidates, payload, options = {}) => {
  const unsupported = [];

  for (const pathname of candidates) {
    try {
      const data = await requestJson(pathname, {
        method: "POST",
        body: payload,
        timeoutMs: options.timeoutMs || defaultTimeoutMs
      });

      return {
        supported: true,
        pathname,
        data
      };
    } catch (error) {
      if (isUnsupportedEndpointError(error)) {
        unsupported.push(pathname);
        continue;
      }

      throw error;
    }
  }

  return {
    supported: false,
    unsupported
  };
};

const applyBridgeCapabilityStatus = (status, bridgeStatus = {}) => {
  const bridgeSupports = Array.isArray(bridgeStatus.supports) ? bridgeStatus.supports : [];
  const supports = unique([...status.supports, ...bridgeSupports]);
  const sessionConnected =
    bridgeStatus.session === "connected" ||
    bridgeStatus.session?.status === "SESSION_ACTIVE" ||
    bridgeStatus.session?.ok === true;

  status.bridge = {
    ok: bridgeStatus.ok !== false,
    service: bridgeStatus.service || "",
    bridgeReady: Boolean(bridgeStatus.bridgeReady),
    reason: bridgeStatus.reason || ""
  };
  status.connected = status.connected || Boolean(bridgeStatus.ok || bridgeStatus.service);
  status.status = status.connected ? "connected" : status.status;
  status.supports = supports;
  status.canScan = Boolean(bridgeStatus.canScan || (sessionConnected && supports.includes("scan-comments")));
  status.canRegister = Boolean(bridgeStatus.canRegister || (sessionConnected && supports.includes("register-reply")));
  status.canRegisterBatch = Boolean(bridgeStatus.canRegisterBatch || (sessionConnected && supports.includes("register-batch")));
  status.canRunAuto = Boolean(status.canRunAuto || bridgeStatus.canRunAuto || supports.includes("url-run-legacy"));
  status.canCollectNow = Boolean(status.canCollectNow || status.canScan);

  if (!status.session && bridgeStatus.session) {
    status.session = {
      ok: sessionConnected,
      status: sessionConnected ? "SESSION_ACTIVE" : "LOGIN_REQUIRED",
      message: sessionConnected ? "네이버 로그인 세션이 연결되어 있습니다." : "네이버 로그인 세션이 필요합니다.",
      reason: bridgeStatus.reason || ""
    };
  }
};

const applyDetectedBridgeEndpoints = (status, detected = {}) => {
  const supports = [...status.supports];
  if (detected.scan) supports.push("scan-comments");
  if (detected.register) supports.push("register-reply");
  if (detected.registerBatch) supports.push("register-batch");
  if (detected.logs) supports.push("logs");
  if (detected.stop) supports.push("stop");
  status.supports = unique(supports);

  const sessionActive = status.session?.ok || status.session?.status === "SESSION_ACTIVE";
  status.canScan = Boolean(status.canScan || (sessionActive && detected.scan));
  status.canRegister = Boolean(status.canRegister || (sessionActive && detected.register));
  status.canRegisterBatch = Boolean(status.canRegisterBatch || (sessionActive && detected.registerBatch));
};

export async function getBlogAutomationStatus() {
  const automationDir = getAutomationDir();
  const baseUrl = getAutomationBaseUrl();
  const packageSummary = readPackageSummary(automationDir);
  const status = {
    mode: "local-http-bridge",
    service: "blog-automation",
    baseUrl,
    directory: automationDir,
    directoryExists: packageSummary.exists,
    package: packageSummary,
    connected: false,
    status: "not_connected",
    canCollectNow: false,
    canScan: false,
    canGenerate: true,
    canRegister: false,
    canRegisterBatch: false,
    canRunAuto: false,
    supports: ["manual-input", "url-status", "url-run-legacy"],
    nextIntegration: "blog-automation",
    session: null,
    logs: [],
    warnings: []
  };

  if (process.env.RENDER || process.env.RENDER_EXTERNAL_URL) {
    status.warnings.push("Render 서버에서는 네이버 브라우저 자동화가 제한될 수 있어 로컬 브리지가 필요합니다.");
  }

  if (!packageSummary.exists) {
    status.logs.push("blog-automation 폴더를 찾지 못했습니다. BLOG_AUTOMATION_DIR 환경변수를 확인하세요.");
  }

  try {
    const diag = await requestJson("/__diag/run-shape", { baseUrl, timeoutMs: 2500 });
    status.connected = Boolean(diag?.success || diag?.source || diag?.message);
    status.status = status.connected ? "connected" : "not_connected";
    status.canCollectNow = status.connected;
    status.canRunAuto = status.connected;
    status.diag = {
      source: diag?.source || "",
      message: diag?.message || ""
    };
    status.logs.push(`blog-automation HTTP 브리지 응답 확인: ${baseUrl}`);
  } catch (error) {
    status.error = error.message;
    status.logs.push(`blog-automation HTTP 브리지 미연결: ${error.message}`);
  }

  if (status.connected) {
    try {
      const bridgeStatus = await requestJson("/bridge/status", { baseUrl, timeoutMs: 5000 });
      applyBridgeCapabilityStatus(status, bridgeStatus);
      status.logs.push("blog-automation 브리지 capability를 확인했습니다.");
    } catch (error) {
      if (!isUnsupportedEndpointError(error)) {
        status.logs.push(`브리지 capability 확인 실패: ${error.message}`);
      }
    }
  }

  if (status.connected) {
    try {
      const session = await requestJson("/session-status", { baseUrl, timeoutMs: 5000 });
      status.session = {
        ok: Boolean(session.ok),
        status: session.status || (session.ok ? "SESSION_ACTIVE" : "LOGIN_REQUIRED"),
        message: session.message || "",
        reason: session.session?.reason || session.reason || ""
      };
      status.logs.push(...normalizeLogs(session.logs));
    } catch (error) {
      status.session = {
        ok: false,
        status: "SESSION_CHECK_FAILED",
        message: error.message
      };
      status.logs.push(`세션 확인 실패: ${error.message}`);
    }
  }

  if (status.connected) {
    const detected = {
      scan: await endpointExists("/bridge/scan-comments", {
        baseUrl,
        method: "POST",
        body: {},
        timeoutMs: 3000
      }),
      register: await endpointExists("/bridge/register-reply", {
        baseUrl,
        method: "POST",
        body: {},
        timeoutMs: 3000
      }),
      registerBatch: await endpointExists("/bridge/register-batch", {
        baseUrl,
        method: "POST",
        body: {},
        timeoutMs: 3000
      }),
      logs: await endpointExists("/bridge/logs", {
        baseUrl,
        timeoutMs: 3000
      })
    };
    applyDetectedBridgeEndpoints(status, detected);
  }

  status.message = status.connected
    ? "blog-automation 브리지가 연결되었습니다."
    : "URL 자동 수집 기능을 사용하려면 로컬 blog-automation 브리지가 실행 중이어야 합니다.";

  return status;
}

export async function scanCommentsByUrl(payload = {}) {
  const status = await getBlogAutomationStatus();

  if (!status.connected) {
    return {
      ok: false,
      status,
      comments: [],
      report: createReport({ exitReason: "bridge_not_connected" }),
      logs: status.logs,
      message: status.message
    };
  }

  try {
    const bridgePayload = buildBridgeScanPayload(payload);
    const result = await callFirstSupportedEndpoint(
      ["/bridge/scan-comments", "/api/comment-automation/scan", "/comment-automation/scan", "/comments/scan", "/scan-comments"],
      bridgePayload,
      { timeoutMs: 90 * 1000 }
    );

    if (!result.supported) {
      return {
        ok: false,
        unsupported: true,
        status,
        comments: [],
        report: createReport({ exitReason: "scan_endpoint_not_supported" }),
        logs: [
          "blog-automation 서버가 현재 분리 댓글 수집 API를 노출하지 않습니다.",
          "안전상 /run 일괄 실행을 댓글 불러오기 동작으로 대체하지 않았습니다."
        ],
        message: "현재 blog-automation은 댓글 불러오기 전용 API가 없어 수집 목록을 가져올 수 없습니다."
      };
    }

    const data = result.data || {};
    const comments = Array.isArray(data.comments) ? data.comments : [];
    return {
      ok: data.ok !== false,
      status,
      endpoint: result.pathname,
      comments,
      report:
        data.report ||
        createReport({
          totalComments: comments.length,
          targetComments: comments.filter((comment) => !comment.hasOwnerReply && !comment.isOwnerComment).length,
          skippedCount: comments.filter((comment) => comment.hasOwnerReply || comment.isOwnerComment).length,
          exitReason: "scan_completed"
        }),
      logs: normalizeLogs(data.logs),
      message: data.message || `${comments.length}개 댓글을 수집했습니다.`
    };
  } catch (error) {
    return {
      ok: false,
      status,
      comments: [],
      report: createReport({ exitReason: "scan_failed", failedCount: 1 }),
      logs: [error.message],
      message: `댓글 수집 중 오류가 발생했습니다: ${error.message}`
    };
  }
}

export async function registerRepliesByBridge(payload = {}) {
  const status = await getBlogAutomationStatus();

  if (!status.connected) {
    return {
      ok: false,
      status,
      report: createReport({ exitReason: "bridge_not_connected" }),
      logs: status.logs,
      message: status.message
    };
  }

  try {
    const bridgePayload = buildBridgeRegisterPayload(payload);
    const result = await callFirstSupportedEndpoint(
      ["/bridge/register-batch", "/api/comment-automation/register", "/comment-automation/register", "/replies/register", "/register-replies"],
      bridgePayload,
      { timeoutMs: 5 * 60 * 1000 }
    );

    if (!result.supported) {
      return {
        ok: false,
        unsupported: true,
        status,
        report: createReport({ exitReason: "register_endpoint_not_supported" }),
        logs: [
          "blog-automation 서버가 현재 선택 대댓글 등록 API를 노출하지 않습니다.",
          "안전상 선택 등록 요청을 /run 일괄 자동등록으로 대체하지 않았습니다."
        ],
        message: "현재 blog-automation은 선택 댓글 등록 전용 API가 없어 등록을 실행하지 않았습니다."
      };
    }

    const data = result.data || {};
    const sourceComments = Array.isArray(payload.comments) ? payload.comments : [];
    const resultByCommentId = new Map(
      (Array.isArray(data.results) ? data.results : []).map((item) => [item.commentId || item.clientId, item])
    );
    const comments =
      sourceComments.length > 0
        ? sourceComments.map((comment) => {
            const key = getCommentId(comment);
            const bridgeResult = resultByCommentId.get(key) || resultByCommentId.get(comment.id);
            if (!bridgeResult) return comment;

            return {
              ...comment,
              registerStatus: bridgeResult.registered ? "등록 완료" : bridgeResult.skipped ? "스킵" : "등록 실패",
              errorMessage: bridgeResult.registered ? "" : bridgeResult.message || bridgeResult.reason || "",
              registered: Boolean(bridgeResult.registered)
            };
          })
        : Array.isArray(data.comments)
          ? data.comments
          : [];
    return {
      ok: data.ok !== false,
      status,
      endpoint: result.pathname,
      comments,
      report:
        data.report ||
        createReport({
          registeredCount: Number(data.registeredCount || comments.filter((comment) => comment.registerStatus === "등록 완료").length),
          failedCount: Number(data.failedCount || comments.filter((comment) => comment.registerStatus === "등록 실패").length),
          skippedCount: Number(data.skippedCount || comments.filter((comment) => comment.registerStatus === "스킵").length),
          exitReason: data.stopped ? "register_stopped" : "register_completed"
        }),
      logs: normalizeLogs(data.logs),
      message: data.message || "선택 대댓글 등록 요청을 완료했습니다."
    };
  } catch (error) {
    return {
      ok: false,
      status,
      report: createReport({ exitReason: "register_failed", failedCount: 1 }),
      logs: [error.message],
      message: `대댓글 등록 중 오류가 발생했습니다: ${error.message}`
    };
  }
}

export async function runLegacyReplyAutomation(payload = {}) {
  const status = await getBlogAutomationStatus();
  const blogUrl = payload.blogUrl || payload.url || payload.form?.blogUrl;

  if (!status.connected) {
    return {
      ok: false,
      status,
      report: createReport({ exitReason: "bridge_not_connected" }),
      logs: status.logs,
      message: status.message
    };
  }

  try {
    const data = await requestJson("/run", {
      method: "POST",
      body: {
        type: "reply",
        value: blogUrl
      },
      timeoutMs: legacyRunTimeoutMs
    });

    const registeredCount = Number(data.processed || data.registeredCount || 0);
    const failedCount = Number(data.errorCount || data.failedCount || 0);
    return {
      ok: data.success !== false,
      status,
      mode: "legacy-run",
      report: createReport({
        registeredCount,
        failedCount,
        exitReason: data.success === false ? "legacy_run_failed" : "legacy_run_completed"
      }),
      logs: normalizeLogs(data.logs),
      message:
        data.message ||
        `blog-automation 전체 실행을 완료했습니다. 등록 ${registeredCount}건, 실패 ${failedCount}건`
    };
  } catch (error) {
    return {
      ok: false,
      status,
      mode: "legacy-run",
      report: createReport({ failedCount: 1, exitReason: "legacy_run_failed" }),
      logs: [error.message],
      message: `blog-automation 전체 실행 중 오류가 발생했습니다: ${error.message}`
    };
  }
}

export async function stopBlogAutomation(payload = {}) {
  const status = await getBlogAutomationStatus();

  if (!status.connected) {
    return {
      ok: false,
      status,
      logs: status.logs,
      message: status.message
    };
  }

  try {
    const result = await callFirstSupportedEndpoint(["/bridge/stop", "/api/comment-automation/stop", "/comment-automation/stop", "/stop"], payload, {
      timeoutMs: 10000
    });

    if (!result.supported) {
      return {
        ok: false,
        unsupported: true,
        status,
        logs: ["blog-automation 서버가 중지 전용 API를 노출하지 않습니다."],
        message: "현재 실행 중지 요청은 프론트 요청 취소까지만 적용됩니다."
      };
    }

    return {
      ok: result.data?.ok !== false,
      status,
      logs: normalizeLogs(result.data?.logs),
      message: result.data?.message || "작업 중지 요청을 보냈습니다."
    };
  } catch (error) {
    return {
      ok: false,
      status,
      logs: [error.message],
      message: `작업 중지 요청 중 오류가 발생했습니다: ${error.message}`
    };
  }
}

export async function getBlogAutomationLogs() {
  const status = await getBlogAutomationStatus();
  const automationDir = getAutomationDir();
  const logsDir = path.join(automationDir, "logs");
  const entries = [];
  let bridgeLogs = [];

  if (status.connected && status.supports?.includes("logs")) {
    try {
      const data = await requestJson("/bridge/logs", { timeoutMs: 5000 });
      bridgeLogs = normalizeLogs(data.logs?.map((entry) => entry.message || `${entry.event || "log"} ${entry.reason || ""}`));
    } catch (error) {
      bridgeLogs = [`브리지 로그 API 확인 실패: ${error.message}`];
    }
  }

  try {
    if (fs.existsSync(logsDir)) {
      const files = fs
        .readdirSync(logsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const filePath = path.join(logsDir, entry.name);
          const stat = fs.statSync(filePath);
          return {
            name: entry.name,
            size: stat.size,
            updatedAt: stat.mtime.toISOString()
          };
        })
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

      entries.push(...files.slice(0, 10));
    }
  } catch (error) {
    return {
      ok: false,
      status,
      logs: [error.message],
      files: [],
      message: "blog-automation 로그 목록을 읽지 못했습니다."
    };
  }

  return {
    ok: true,
    status,
    logs: [
      `로그 폴더: ${logsDir}`,
      ...bridgeLogs.slice(-20),
      entries.length ? `최근 로그 파일 ${entries.length}개를 확인했습니다.` : "표시할 로그 파일이 없습니다."
    ],
    files: entries,
    message: "blog-automation 로그 정보를 불러왔습니다."
  };
}
