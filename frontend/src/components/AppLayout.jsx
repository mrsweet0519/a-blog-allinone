import {
  Archive,
  LogOut,
  MessageSquare,
  PackageSearch,
  Settings2,
  ShieldCheck,
  Sparkles,
  WandSparkles
} from "lucide-react";
import { NavLink } from "react-router-dom";
import EnvironmentBanner from "./EnvironmentBanner.jsx";
import { getAccessDaysRemaining } from "../lib/accessControl.js";

const navGroups = [
  {
    label: "초보자용 메뉴",
    description: "사진과 메모만 넣고 바로 초안을 만듭니다.",
    items: [
      {
        to: "/one-click/naver",
        label: "원클릭 네이버 블로그 글쓰기",
        description: "사진과 짧은 메모만 넣으면 네이버 블로그 후기글 초안을 만들어줍니다.",
        icon: PackageSearch
      },
      {
        to: "/one-click/tistory",
        label: "원클릭 티스토리 글쓰기",
        description: "키워드와 메모로 티스토리용 정보형 글 구조를 한 번에 만듭니다.",
        icon: WandSparkles
      },
      {
        to: "/one-click/comments",
        label: "원클릭 대댓글 작성",
        description: "댓글 내용을 넣으면 자연스러운 상호 대댓글을 자동으로 작성합니다.",
        icon: MessageSquare
      }
    ]
  },
  {
    label: "숙련자용 메뉴",
    description: "키워드, 구조, 말투를 세밀하게 조정합니다.",
    items: [
      {
        to: "/optimized/blog",
        label: "SEO 최적화 블로그 글쓰기",
        description: "검색에 맞는 글 구조와 제목, 글 순서를 직접 조정합니다.",
        icon: Sparkles
      },
      {
        to: "/optimized/comments",
        label: "SEO 최적화 대댓글 작성",
        description: "키워드, 말투, CTA, 금지어까지 반영해 대댓글을 만듭니다.",
        icon: MessageSquare
      }
    ]
  },
  {
    label: "관리",
    description: "",
    items: [
      { to: "/storage", label: "보관함", description: "저장한 글 초안을 다시 봅니다.", icon: Archive },
      { to: "/settings", label: "설정", description: "접속과 고급 옵션을 확인합니다.", icon: Settings2 }
    ]
  }
];

export default function AppLayout({ children, accessSession, accessMessage = "", onLogout }) {
  const daysRemaining = accessSession?.expiresAt
    ? getAccessDaysRemaining(accessSession.expiresAt)
    : 0;

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="flex min-h-screen w-full flex-col lg:flex-row">
        <aside className="border-b border-line bg-[#262b2f] px-5 py-4 text-white lg:min-h-screen lg:w-80 lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-coral text-white">
              <Sparkles size={21} aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm text-white/65">a-blog-allinone</p>
              <h1 className="text-lg font-semibold">Blog All-in-One</h1>
            </div>
          </div>

          <nav className="mt-5 space-y-5">
            {navGroups.map((group) => (
              <section key={group.label}>
                <div className="mb-2">
                  <p className="text-xs font-bold text-white/55">{group.label}</p>
                  {group.description && (
                    <p className="mt-0.5 text-[11px] font-semibold leading-4 text-white/38">
                      {group.description}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;

                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                          [
                            "focus-ring flex min-h-[74px] items-start gap-3 rounded-md border px-3 py-3 text-left transition",
                            isActive
                              ? "border-white bg-white text-ink shadow-soft"
                              : "border-white/12 bg-white/[0.06] text-white/78 hover:border-white/30 hover:bg-white/12 hover:text-white"
                          ].join(" ")
                        }
                        title={item.label}
                      >
                        <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block text-sm font-bold leading-5">{item.label}</span>
                          <span className="mt-1 block text-xs font-semibold leading-5 opacity-70">
                            {item.description}
                          </span>
                        </span>
                      </NavLink>
                    );
                  })}
                </div>
              </section>
            ))}
          </nav>

          {accessSession && (
            <div className="mt-5 rounded-md border border-white/20 bg-white/10 p-3 text-sm">
              <div className="flex items-start gap-2">
                <ShieldCheck size={18} className="mt-0.5 shrink-0 text-white/70" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white/55">사용권</p>
                  <p className="mt-0.5 break-words font-bold text-white">{accessSession.label}</p>
                  <p className="mt-1 text-xs font-semibold text-white/65">
                    만료일: {accessSession.expiresAt}
                    {daysRemaining > 0 ? ` · ${daysRemaining}일 남음` : ""}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="focus-ring mt-3 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-md bg-white/10 px-3 text-xs font-bold text-white transition hover:bg-white hover:text-ink"
              >
                <LogOut size={14} aria-hidden="true" />
                코드 초기화
              </button>
            </div>
          )}
        </aside>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1480px]">
            <EnvironmentBanner />
            {accessMessage && (
              <p className="mb-4 rounded-md border border-moss/20 bg-moss/10 px-3 py-2 text-sm font-semibold text-moss">
                {accessMessage}
              </p>
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
