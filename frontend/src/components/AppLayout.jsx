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
    label: "초보자용",
    items: [
      {
        to: "/one-click/naver",
        label: "네이버 글쓰기",
        icon: PackageSearch
      },
      {
        to: "/one-click/tistory",
        label: "티스토리 글쓰기",
        icon: WandSparkles
      },
      {
        to: "/one-click/comments",
        label: "대댓글 작성",
        icon: MessageSquare
      }
    ]
  },
  {
    label: "최적화용",
    items: [
      {
        to: "/optimized/blog",
        label: "SEO 블로그 글쓰기",
        icon: Sparkles
      },
      {
        to: "/optimized/comments",
        label: "SEO 대댓글 작성",
        icon: MessageSquare
      }
    ]
  },
  {
    label: "관리",
    items: [
      { to: "/storage", label: "보관함", icon: Archive },
      { to: "/settings", label: "설정", icon: Settings2 },
      { to: "/license", label: "사용권", icon: ShieldCheck }
    ]
  }
];

export default function AppLayout({ children, accessSession, accessMessage = "", onLogout }) {
  const daysRemaining = accessSession?.expiresAt
    ? getAccessDaysRemaining(accessSession.expiresAt)
    : 0;

  return (
    <div className="min-h-screen bg-[#fbfaf6] text-ink">
      <div className="flex min-h-screen w-full flex-col lg:flex-row">
        <aside className="border-b border-line bg-white/90 px-4 py-4 text-ink lg:min-h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-moss text-white">
              <Sparkles size={18} aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-semibold text-ink/45">사진+메모 글쓰기</p>
              <h1 className="text-lg font-bold">Blog All-in-One</h1>
            </div>
          </div>

          <nav className="mt-7 space-y-6">
            {navGroups.map((group) => (
              <section key={group.label}>
                <div className="mb-2">
                  <p className="px-2 text-[11px] font-bold tracking-wide text-ink/40">{group.label}</p>
                </div>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-3 lg:grid-cols-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;

                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                          [
                            "focus-ring flex min-h-10 items-center gap-2.5 rounded-md border-l-4 px-2.5 py-2 text-left text-sm transition",
                            isActive
                              ? "border-l-moss bg-moss/10 font-bold text-moss"
                              : "border-l-transparent text-ink/62 hover:bg-paper hover:text-ink"
                          ].join(" ")
                        }
                        title={item.label}
                      >
                        <Icon size={15} className="shrink-0" aria-hidden="true" />
                        <span className="min-w-0 truncate">{item.label}</span>
                      </NavLink>
                    );
                  })}
                </div>
              </section>
            ))}
          </nav>

          {accessSession && (
            <div className="mt-7 rounded-lg border border-line bg-paper/70 p-3 text-sm">
              <div className="flex items-start gap-2">
                <ShieldCheck size={17} className="mt-0.5 shrink-0 text-moss" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink/45">사용권</p>
                  <p className="mt-0.5 break-words font-bold text-ink">{accessSession.label}</p>
                  <p className="mt-1 text-xs font-semibold text-ink/55">
                    만료일: {accessSession.expiresAt}
                    {daysRemaining > 0 ? ` · ${daysRemaining}일 남음` : ""}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="focus-ring mt-3 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-md bg-white px-3 text-xs font-bold text-ink/60 transition hover:bg-ink hover:text-white"
              >
                <LogOut size={14} aria-hidden="true" />
                코드 초기화
              </button>
            </div>
          )}
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-7 lg:px-10 lg:py-9">
          <div className="mx-auto w-full max-w-[1360px]">
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
