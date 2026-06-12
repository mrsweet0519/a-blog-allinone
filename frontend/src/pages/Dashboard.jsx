import {
  ArrowRight,
  Check,
  MessageSquare,
  PackageSearch,
  PenLine,
  SearchCheck,
  Sparkles,
  WandSparkles
} from "lucide-react";
import { useNavigate } from "react-router-dom";

const mainCards = [
  {
    title: "네이버 블로그 글쓰기",
    description: "사진과 메모로 네이버 후기글 초안을 만들어요.",
    to: "/one-click/naver",
    icon: PackageSearch,
    surface: "bg-[#fffaf0]",
    iconSurface: "bg-[#f6c84c]"
  },
  {
    title: "티스토리 글쓰기",
    description: "키워드와 메모로 정보형 글 초안을 만들어요.",
    to: "/one-click/tistory",
    icon: WandSparkles,
    surface: "bg-[#f8fbf7]",
    iconSurface: "bg-[#f1df9a]"
  },
  {
    title: "대댓글 작성",
    description: "댓글 내용을 넣으면 자연스러운 답글을 만들어요.",
    to: "/one-click/comments",
    icon: MessageSquare,
    surface: "bg-white",
    iconSurface: "bg-[#f4ead1]"
  }
];

const optimizedLinks = [
  {
    title: "SEO 블로그 글쓰기",
    description: "키워드와 글 순서를 직접 조정해요.",
    to: "/optimized/blog",
    icon: SearchCheck
  },
  {
    title: "SEO 대댓글 작성",
    description: "키워드, 말투, CTA를 세밀하게 반영해요.",
    to: "/optimized/comments",
    icon: Sparkles
  }
];

const outputItems = [
  "추천 제목 3개",
  "본문 초안",
  "사진 삽입 위치",
  "썸네일 문구",
  "해시태그"
];

export default function Dashboard() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen overflow-hidden rounded-[2rem] bg-[#fffdf8]">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-2 py-5 sm:px-4">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="focus-ring inline-flex items-center gap-2 rounded-full px-2 py-1 text-left"
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[#f6c84c] text-ink">
            <PenLine size={18} aria-hidden="true" />
          </span>
          <span className="text-base font-bold">Blog All-in-One</span>
        </button>

        <nav className="hidden items-center gap-1 text-sm font-bold text-ink/58 md:flex">
          <button type="button" onClick={() => navigate("/one-click/naver")} className="focus-ring rounded-full px-3 py-2 transition hover:bg-[#fff4cf] hover:text-ink">
            네이버 글쓰기
          </button>
          <button type="button" onClick={() => navigate("/one-click/tistory")} className="focus-ring rounded-full px-3 py-2 transition hover:bg-[#fff4cf] hover:text-ink">
            티스토리
          </button>
          <button type="button" onClick={() => navigate("/one-click/comments")} className="focus-ring rounded-full px-3 py-2 transition hover:bg-[#fff4cf] hover:text-ink">
            대댓글
          </button>
          <button type="button" onClick={() => navigate("/settings")} className="focus-ring rounded-full px-3 py-2 transition hover:bg-[#fff4cf] hover:text-ink">
            설정
          </button>
        </nav>

        <button
          type="button"
          onClick={() => navigate("/one-click/naver")}
          className="focus-ring inline-flex min-h-10 items-center justify-center rounded-full bg-ink px-4 text-sm font-bold text-white transition hover:bg-[#3a3021]"
        >
          시작하기
        </button>
      </header>

      <main className="mx-auto max-w-7xl px-2 pb-10 pt-4 sm:px-4 lg:pb-12 lg:pt-7">
        <section className="relative mx-auto max-w-3xl text-center">
          <div className="pointer-events-none absolute left-1/2 top-0 z-0 h-40 w-40 -translate-x-1/2 rounded-full bg-[#f6c84c]/16 blur-3xl" />
          <p className="relative text-sm font-bold text-[#9a6a00]">원클릭 블로그 글쓰기 도구</p>
          <h2 className="relative mx-auto mt-3 max-w-3xl text-3xl font-bold leading-[1.16] tracking-normal text-ink sm:text-4xl lg:text-5xl">
            <span className="block">사진과 메모만 넣으면</span>
            <span className="block">블로그 글 초안이 완성됩니다</span>
          </h2>
          <p className="relative mx-auto mt-4 max-w-2xl text-sm font-semibold leading-7 text-ink/58 sm:text-base">
            네이버 블로그, 티스토리, 대댓글까지 한 번에 만드는 원클릭 글쓰기 도구
          </p>
        </section>

        <section className="mt-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-bold text-[#9a6a00]">어떤 작업을 시작할까요?</p>
              <h3 className="mt-1 text-2xl font-bold">필요한 글쓰기 메뉴를 선택하세요</h3>
            </div>
            <p className="max-w-xl text-sm font-semibold leading-6 text-ink/52">
              처음이라면 네이버 블로그 글쓰기부터 시작하면 가장 빠르게 결과를 확인할 수 있습니다.
            </p>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {mainCards.map((card) => {
              const Icon = card.icon;

              return (
                <button
                  type="button"
                  key={card.title}
                  onClick={() => navigate(card.to)}
                  className={`focus-ring group flex min-h-[215px] flex-col rounded-2xl border border-[#eadfc8] ${card.surface} p-5 text-left shadow-[0_14px_34px_rgba(68,52,22,0.06)] transition duration-300 hover:-translate-y-1 hover:border-[#d7ad32] hover:shadow-[0_22px_56px_rgba(68,52,22,0.1)]`}
                >
                  <span className={`grid h-12 w-12 place-items-center rounded-xl ${card.iconSurface} text-ink shadow-[0_8px_20px_rgba(68,52,22,0.1)]`}>
                    <Icon size={22} aria-hidden="true" />
                  </span>
                  <span className="mt-5">
                    <span className="block text-xl font-bold text-ink">{card.title}</span>
                    <span className="mt-2 block text-sm font-semibold leading-6 text-ink/58">
                      {card.description}
                    </span>
                  </span>
                  <span className="mt-auto inline-flex min-h-10 w-fit items-center justify-center gap-2 rounded-full bg-[#f6c84c] px-4 text-sm font-bold text-ink transition group-hover:bg-[#e8b72f]">
                    바로 시작하기
                    <ArrowRight size={16} className="transition group-hover:translate-x-1" aria-hidden="true" />
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-10 rounded-[1.75rem] border border-[#eadfc8] bg-white/80 p-5 shadow-[0_14px_36px_rgba(68,52,22,0.05)]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-bold text-[#9a6a00]">조금 더 세밀하게 쓰고 싶다면</p>
              <h3 className="mt-1 text-xl font-bold">숙련자용 최적화 메뉴</h3>
            </div>
            <p className="text-sm font-semibold leading-6 text-ink/52">
              키워드와 글 구조를 직접 조정하는 숙련자용 메뉴입니다.
            </p>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {optimizedLinks.map((item) => {
              const Icon = item.icon;

              return (
                <button
                  type="button"
                  key={item.title}
                  onClick={() => navigate(item.to)}
                  className="focus-ring flex items-center justify-between gap-4 rounded-2xl border border-[#eadfc8] bg-[#fffaf0] px-4 py-4 text-left transition hover:border-[#d7ad32] hover:bg-[#fff4d8]"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-[#9a6a00]">
                      <Icon size={19} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold text-ink">{item.title}</span>
                      <span className="mt-1 block text-sm font-semibold leading-5 text-ink/52">
                        {item.description}
                      </span>
                    </span>
                  </span>
                  <ArrowRight size={16} className="shrink-0 text-ink/35" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-10 rounded-[2rem] border border-[#eadfc8] bg-[#1f2428] p-6 text-white shadow-[0_24px_70px_rgba(31,36,40,0.16)] sm:p-7">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-md">
              <p className="text-sm font-bold text-[#f6c84c]">3초 안에 이해하는 결과물</p>
              <h3 className="mt-2 text-2xl font-bold">사진+메모만 준비하면 이렇게 바뀝니다</h3>
            </div>

            <div className="grid flex-1 gap-4 md:grid-cols-[0.85fr_1.15fr]">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-5">
                <p className="text-sm font-bold text-white/55">입력</p>
                <p className="mt-3 text-xl font-bold">사진 3장 + 짧은 메모</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white p-5 text-ink">
                <p className="text-sm font-bold text-[#9a6a00]">출력</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {outputItems.map((item) => (
                    <p key={item} className="flex items-center gap-2 text-sm font-bold">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#f6c84c]">
                        <Check size={13} aria-hidden="true" />
                      </span>
                      {item}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
