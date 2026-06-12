import {
  ArrowRight,
  MessageSquare,
  PackageSearch,
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
    accent: "bg-moss text-white",
    surface: "bg-[#f1faf6]"
  },
  {
    title: "티스토리 글쓰기",
    description: "키워드와 메모로 정보형 글 초안을 만들어요.",
    to: "/one-click/tistory",
    icon: WandSparkles,
    accent: "bg-[#8b7cf6] text-white",
    surface: "bg-[#f5f2ff]"
  },
  {
    title: "대댓글 작성",
    description: "댓글 내용을 넣으면 자연스러운 답글을 만들어요.",
    to: "/one-click/comments",
    icon: MessageSquare,
    accent: "bg-ink text-white",
    surface: "bg-white"
  }
];

const optimizedLinks = [
  {
    title: "SEO 블로그 글쓰기",
    description: "키워드, 제목, 글 순서를 세밀하게 조정해요.",
    to: "/optimized/blog",
    icon: SearchCheck
  },
  {
    title: "SEO 대댓글 작성",
    description: "키워드, 말투, CTA, 금지어를 반영해요.",
    to: "/optimized/comments",
    icon: Sparkles
  }
];

export default function Dashboard() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-6xl flex-col justify-center py-8">
      <section className="text-center">
        <p className="text-sm font-bold text-moss">사진과 메모만 준비하면 초안까지 한 번에</p>
        <h2 className="mx-auto mt-4 max-w-3xl text-4xl font-bold leading-tight tracking-normal text-ink sm:text-5xl">
          어떤 블로그 글을 만들어볼까요?
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-base font-semibold leading-7 text-ink/55">
          네이버 후기글, 티스토리 정보글, 댓글 답글 중 필요한 작업을 고르면 바로 글쓰기 화면으로 이동합니다.
        </p>
      </section>

      <section className="mt-12 grid gap-5 lg:grid-cols-3">
        {mainCards.map((card) => {
          const Icon = card.icon;

          return (
            <button
              type="button"
              key={card.title}
              onClick={() => navigate(card.to)}
              className={`focus-ring group flex min-h-[230px] flex-col justify-between rounded-3xl border border-line/70 ${card.surface} p-6 text-left shadow-[0_16px_40px_rgba(31,36,40,0.06)] transition hover:-translate-y-1 hover:border-moss/30 hover:shadow-[0_22px_50px_rgba(31,36,40,0.09)]`}
            >
              <span className={`grid h-12 w-12 place-items-center rounded-2xl ${card.accent}`}>
                <Icon size={23} aria-hidden="true" />
              </span>
              <span>
                <span className="block text-xl font-bold text-ink">{card.title}</span>
                <span className="mt-3 block text-sm font-semibold leading-6 text-ink/58">
                  {card.description}
                </span>
              </span>
              <span className="inline-flex items-center gap-2 text-sm font-bold text-moss">
                바로 시작하기
                <ArrowRight size={16} className="transition group-hover:translate-x-1" aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </section>

      <section className="mt-10 rounded-3xl border border-line/70 bg-white p-5 shadow-[0_12px_32px_rgba(31,36,40,0.05)]">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold text-[#8b7cf6]">더 세밀하게 쓰고 싶다면</p>
            <h3 className="mt-1 text-lg font-bold">최적화 글쓰기</h3>
          </div>
          <p className="text-sm font-semibold leading-6 text-ink/52">
            키워드와 구조를 직접 조정하는 숙련자용 메뉴입니다.
          </p>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {optimizedLinks.map((item) => {
            const Icon = item.icon;

            return (
              <button
                type="button"
                key={item.title}
                onClick={() => navigate(item.to)}
                className="focus-ring flex items-center justify-between gap-4 rounded-2xl border border-line/70 bg-[#fbfaf6] px-4 py-4 text-left transition hover:border-moss/30 hover:bg-[#f1faf6]"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-moss">
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
    </div>
  );
}
