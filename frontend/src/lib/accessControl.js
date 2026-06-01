import { accessCodes } from "../data/accessCodes.js";

export const ACCESS_SESSION_STORAGE_KEY = "a-blog-allinone:access-session";

export const ACCESS_MESSAGES = {
  invalid: "유효하지 않은 접속코드입니다.",
  expired: "사용 기간이 종료되었습니다. 연장을 원하시면 문의해주세요.",
  inactive: "사용이 중지된 코드입니다.",
  verified: "접속이 확인되었습니다. M.GO 블로그 올인원을 사용할 수 있습니다."
};

export const normalizeAccessCode = (value = "") => String(value).trim().toUpperCase();

const safeLocalStorage = () => {
  if (typeof window === "undefined" || !window.localStorage) return null;

  return window.localStorage;
};

const parseDateOnly = (value = "") => {
  const [year, month, day] = String(value).split("-").map((part) => Number.parseInt(part, 10));

  if (!year || !month || !day) return null;

  return new Date(year, month - 1, day, 23, 59, 59, 999);
};

export const isAccessExpired = (expiresAt, now = new Date()) => {
  const expiresAtEnd = parseDateOnly(expiresAt);

  if (!expiresAtEnd) return true;

  return expiresAtEnd.getTime() < now.getTime();
};

export const getAccessDaysRemaining = (expiresAt, now = new Date()) => {
  const expiresAtEnd = parseDateOnly(expiresAt);

  if (!expiresAtEnd) return 0;

  const diff = expiresAtEnd.getTime() - now.getTime();

  return Math.max(0, Math.ceil(diff / 86400000));
};

export function validateAccessCode(inputCode, codeList = accessCodes, now = new Date()) {
  const normalizedCode = normalizeAccessCode(inputCode);

  if (!normalizedCode) {
    return {
      ok: false,
      reason: "not_found",
      message: ACCESS_MESSAGES.invalid
    };
  }

  const license = codeList.find((item) => normalizeAccessCode(item.code) === normalizedCode);

  if (!license) {
    return {
      ok: false,
      reason: "not_found",
      message: ACCESS_MESSAGES.invalid
    };
  }

  if (license.active !== true) {
    return {
      ok: false,
      reason: "inactive",
      message: ACCESS_MESSAGES.inactive,
      license
    };
  }

  if (isAccessExpired(license.expiresAt, now)) {
    return {
      ok: false,
      reason: "expired",
      message: ACCESS_MESSAGES.expired,
      license
    };
  }

  return {
    ok: true,
    reason: "valid",
    message: ACCESS_MESSAGES.verified,
    license: {
      code: normalizedCode,
      label: license.label,
      expiresAt: license.expiresAt,
      active: license.active
    }
  };
}

export const createAccessSession = (license, now = new Date()) => ({
  code: normalizeAccessCode(license.code),
  label: license.label,
  expiresAt: license.expiresAt,
  verifiedAt: now.toISOString()
});

export const saveAccessSession = (session) => {
  const storage = safeLocalStorage();

  if (!storage) return;

  storage.setItem(ACCESS_SESSION_STORAGE_KEY, JSON.stringify(session));
};

export const clearAccessSession = () => {
  const storage = safeLocalStorage();

  if (!storage) return;

  storage.removeItem(ACCESS_SESSION_STORAGE_KEY);
};

export function loadAccessSession(now = new Date()) {
  const storage = safeLocalStorage();

  if (!storage) return null;

  try {
    const stored = JSON.parse(storage.getItem(ACCESS_SESSION_STORAGE_KEY) || "null");

    if (!stored?.code) return null;

    const validation = validateAccessCode(stored.code, accessCodes, now);

    if (!validation.ok) {
      clearAccessSession();
      return null;
    }

    const verifiedAtTime = Date.parse(stored.verifiedAt || "");
    const verifiedAt = Number.isFinite(verifiedAtTime) ? new Date(verifiedAtTime) : now;

    return createAccessSession(validation.license, verifiedAt);
  } catch (_error) {
    clearAccessSession();
    return null;
  }
}
