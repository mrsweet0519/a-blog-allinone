import {
  Archive,
  LayoutDashboard,
  MessageSquare,
  Settings2,
  Sparkles,
  WandSparkles
} from "lucide-react";
import { NavLink } from "react-router-dom";

const navItems = [
  { to: "/", label: "대시보드", icon: LayoutDashboard },
  { to: "/maker", label: "콘텐츠 메이커", icon: WandSparkles },
  { to: "/comment-replies", label: "댓글 응답 관리", icon: MessageSquare },
  { to: "/storage", label: "내 보관함", icon: Archive },
  { to: "/settings", label: "고급 설정", icon: Settings2 }
];

export default function AppLayout({ children }) {
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
        </aside>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1480px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
