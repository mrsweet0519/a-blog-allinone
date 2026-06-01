import { CheckCircle2, KeyRound, LockKeyhole } from "lucide-react";
import { useState } from "react";
import {
  ACCESS_MESSAGES,
  createAccessSession,
  saveAccessSession,
  validateAccessCode
} from "../lib/accessControl.js";

export default function AccessGate({ onAuthenticated }) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("idle");

  const submitCode = (event) => {
    event.preventDefault();

    const validation = validateAccessCode(code);

    setMessage(validation.message);
    setMessageType(validation.ok ? "success" : "error");

    if (!validation.ok) return;

    const session = createAccessSession(validation.license);

    saveAccessSession(session);
    onAuthenticated(session, ACCESS_MESSAGES.verified);
  };

  return (
    <div className="min-h-screen bg-paper px-4 py-8 text-ink">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-xl items-center">
        <section className="w-full rounded-lg border border-line bg-white p-6 shadow-soft sm:p-8">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-coral text-white">
              <LockKeyhole size={22} aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink/55">M.GO 블로그 올인원</p>
              <h1 className="text-xl font-bold">접속코드 확인</h1>
            </div>
          </div>

          <p className="mt-4 text-sm leading-6 text-ink/65">
            발급받은 접속코드를 입력하면 사용권 만료일까지 콘텐츠 메이커와 댓글 응답 관리 기능을 사용할 수 있습니다.
          </p>

          <form className="mt-6 space-y-4" onSubmit={submitCode}>
            <label className="block">
              <span className="text-sm font-bold text-ink/70">접속코드</span>
              <div className="mt-2 flex min-h-12 items-center rounded-md border border-line bg-paper px-3 focus-within:ring-2 focus-within:ring-moss focus-within:ring-offset-2 focus-within:ring-offset-paper">
                <KeyRound size={18} className="mr-2 shrink-0 text-moss" aria-hidden="true" />
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className="min-h-11 flex-1 border-0 bg-transparent text-base font-semibold uppercase outline-none"
                  placeholder="예: MGO-TEST7"
                  autoComplete="one-time-code"
                />
              </div>
            </label>

            {message && (
              <p
                className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                  messageType === "success"
                    ? "border-moss/20 bg-moss/10 text-moss"
                    : "border-coral/20 bg-coral/10 text-coral"
                }`}
              >
                {message}
              </p>
            )}

            <button
              type="submit"
              className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-moss px-4 text-sm font-bold text-white transition hover:bg-[#456b61]"
            >
              <CheckCircle2 size={18} aria-hidden="true" />
              접속 확인
            </button>
          </form>

          <div className="mt-5 rounded-md border border-line bg-paper px-3 py-3 text-xs leading-5 text-ink/55">
            현재 접속 제어는 정적 베타와 1차 판매용 간단 인증입니다. 사용권 관리용으로 동작하며,
            정식 판매 확대 시 서버 검증 방식으로 교체할 수 있습니다.
          </div>
        </section>
      </div>
    </div>
  );
}
