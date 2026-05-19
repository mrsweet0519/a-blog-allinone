import { LockKeyhole, PlugZap, Save, Server, ToggleLeft } from "lucide-react";
import { useState } from "react";
import { makerOptions } from "@shared/mvpConfig.js";
import { checkBackendHealth, getApiBaseLabel, isBackendApiEnabled } from "../lib/backendApi.js";
import { loadSettings, saveSettings } from "../lib/localDrafts.js";

const defaultSettings = {
  blogName: "",
  defaultCategory: makerOptions.categories[0],
  defaultTone: makerOptions.tones[0]
};

export default function Settings() {
  const [settings, setSettings] = useState(() => ({ ...defaultSettings, ...loadSettings() }));
  const [saved, setSaved] = useState(false);
  const [backendStatus, setBackendStatus] = useState(isBackendApiEnabled() ? "확인 전" : "미설정");

  const updateSettings = (key, value) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const persist = () => {
    saveSettings(settings);
    setSaved(true);
  };

  const checkBackend = async () => {
    if (!isBackendApiEnabled()) {
      setBackendStatus("미설정");
      return;
    }

    setBackendStatus("확인 중");
    try {
      const health = await checkBackendHealth();
      setBackendStatus(health.ok ? "연결됨" : "응답 확인 필요");
    } catch {
      setBackendStatus("연결 실패");
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-coral">확장 슬롯</p>
          <h2 className="mt-1 text-3xl font-bold tracking-normal">고급 설정</h2>
        </div>
        <button
          type="button"
          onClick={persist}
          className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white transition hover:bg-[#3a4046]"
        >
          <Save size={18} aria-hidden="true" />
          저장
        </button>
      </header>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-lg font-bold">기본 정보</h3>
          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-sm font-semibold">블로그 이름</span>
              <input
                value={settings.blogName}
                onChange={(event) => updateSettings("blogName", event.target.value)}
                className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
                placeholder="내 블로그"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">기본 업종/주제</span>
              <select
                value={settings.defaultCategory}
                onChange={(event) => updateSettings("defaultCategory", event.target.value)}
                className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
              >
                {makerOptions.categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-semibold">기본 말투</span>
              <select
                value={settings.defaultTone}
                onChange={(event) => updateSettings("defaultTone", event.target.value)}
                className="focus-ring mt-2 min-h-11 w-full rounded-md border border-line bg-paper px-3 text-sm"
              >
                {makerOptions.tones.map((tone) => (
                  <option key={tone} value={tone}>
                    {tone}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {saved && <p className="mt-4 text-sm font-semibold text-moss">저장됨</p>}
        </div>

        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-lg font-bold">향후 확장</h3>
          <div className="mt-5 space-y-3">
            <ExtensionSlot
              icon={Server}
              title={`백엔드 API ${getApiBaseLabel() || "미설정"}`}
              status={backendStatus}
              action={isBackendApiEnabled() ? checkBackend : null}
            />
            <ExtensionSlot
              icon={LockKeyhole}
              title="Gemini API 연결"
              status="2차 MVP"
            />
            <ExtensionSlot
              icon={PlugZap}
              title="댓글/대댓글 자동화 브리지"
              status="미구현"
            />
            <ExtensionSlot
              icon={ToggleLeft}
              title="외부 블로그 발행 자동화"
              status="미구현"
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function ExtensionSlot({ icon: Icon, title, status, action }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-paper p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-md bg-white text-moss">
          <Icon size={18} aria-hidden="true" />
        </div>
        <p className="min-w-0 break-all font-semibold">{title}</p>
      </div>
      {action ? (
        <button
          type="button"
          onClick={action}
          className="focus-ring shrink-0 rounded-md bg-white px-2.5 py-1 text-xs font-bold text-ink/55 transition hover:text-moss"
        >
          {status}
        </button>
      ) : (
        <span className="shrink-0 rounded-md bg-white px-2.5 py-1 text-xs font-bold text-ink/55">
          {status}
        </span>
      )}
    </div>
  );
}
