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

const navItems = [
  { to: "/product-review-maker", label: "사진으로 리뷰글 만들기", icon: PackageSearch },
  { to: "/maker", label: "키워드로 정보글 만들기", icon: WandSparkles },
  { to: "/comment-replies", label: "댓글 답변 만들기", icon: MessageSquare },
  { to: "/storage", label: "보관함", icon: Archive },
  { to: "/settings", label: "설정", icon: Settings2 }
];

export default function AppLayout({ children, accessSession, accessMessage = "", onLogout }) {
  const daysRemaining = accessSession?.expiresAt
    ? getAccessDaysRemaining(accessSession.expiresAt)
    : 0;

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="flex min-h-screen w-full flex-col lg:flex-row">
        <aside className="border-b border-line bg-[#262b2f] px-5 py-4 text-white lg:min-h-screen lg:w-72 lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-coral text-white">
              <Sparkles size={21} aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm text-white/65">a-blog-allinone</p>
              <h1 className="text-lg font-semibold">Blog All-in-One</h1>
            </div>
          </div>

          <nav className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-1">
            {navItems.map((item) => {
              const Icon = item.icon;

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    [
                      "focus-ring flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
                      isActive
                        ? "bg-white text-ink shadow-soft"
                        : "text-white/78 hover:bg-white/10 hover:text-white"
                    ].join(" ")
                  }
                  title={item.label}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
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
