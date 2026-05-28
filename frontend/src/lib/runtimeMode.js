const buildDeployTarget =
  typeof __BLOG_ALLINONE_DEPLOY_TARGET__ === "string" ? __BLOG_ALLINONE_DEPLOY_TARGET__ : "";
const buildRouterMode =
  typeof __BLOG_ALLINONE_ROUTER_MODE__ === "string" ? __BLOG_ALLINONE_ROUTER_MODE__ : "";

const STATIC_TARGETS = new Set([
  "static",
  "static-beta",
  "cloudflare",
  "cloudflare-pages",
  "vercel",
  "github",
  "github-pages"
]);

const normalize = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase();

const detectTargetFromHost = () => {
  if (typeof window === "undefined") return "";

  const host = normalize(window.location.hostname);

  if (!host) return "";
  if (host === "localhost" || host === "127.0.0.1") return "local";
  if (host.endsWith(".pages.dev")) return "cloudflare-pages";
  if (host.endsWith(".vercel.app")) return "vercel";
  if (host.endsWith(".github.io")) return "github-pages";
  if (host.endsWith(".onrender.com")) return "render";

  return "";
};

const explicitTarget = normalize(import.meta.env.VITE_DEPLOY_TARGET || import.meta.env.VITE_APP_MODE);
const configuredTarget = normalize(buildDeployTarget);

export const getRuntimeInfo = () => {
  const target =
    explicitTarget ||
    configuredTarget ||
    detectTargetFromHost() ||
    (import.meta.env.DEV ? "local" : "render");
  const isStaticBeta = STATIC_TARGETS.has(target);

  if (isStaticBeta) {
    return {
      target,
      mode: "static-beta",
      label: "정적 베타 모드",
      description: "콘텐츠 생성과 수동 댓글 응답 생성만 테스트할 수 있습니다."
    };
  }

  if (target === "render") {
    return {
      target,
      mode: "render",
      label: "백엔드 포함 테스트 서버",
      description: "무료 서버는 첫 접속 시 로딩이 길 수 있습니다."
    };
  }

  return {
    target,
    mode: "local-bridge",
    label: "로컬 브리지 연결 가능",
    description: "blog-automation 연결 상태를 확인하면 URL 자동 수집/등록 기능을 테스트할 수 있습니다."
  };
};

export const isStaticBetaMode = () => getRuntimeInfo().mode === "static-beta";

export const isLocalBridgeMode = () => getRuntimeInfo().mode === "local-bridge";

export const isRenderMode = () => getRuntimeInfo().mode === "render";

export const getRouterMode = () =>
  normalize(import.meta.env.VITE_ROUTER_MODE || buildRouterMode) === "hash" ? "hash" : "browser";

export const STATIC_BETA_NOTICE =
  "현재 베타 URL에서는 콘텐츠 생성, 캡처 업로드, 수동 댓글 응답 초안 생성을 테스트할 수 있습니다. 네이버 댓글 자동 수집/자동 등록은 로컬 blog-automation 브리지 연결 시 사용할 수 있습니다.";
