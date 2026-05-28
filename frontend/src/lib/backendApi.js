import { getRuntimeInfo, isStaticBetaMode } from "./runtimeMode.js";

const trimTrailingSlash = (value) => String(value || "").replace(/\/+$/u, "");

const configuredApiBaseUrl = trimTrailingSlash(import.meta.env.VITE_API_BASE_URL);
const staticBeta = isStaticBetaMode();
const devApiBaseUrl = import.meta.env.DEV && !staticBeta ? "http://localhost:4000" : "";
const useSameOriginApi = !staticBeta && !configuredApiBaseUrl && import.meta.env.PROD;

export const API_BASE_URL = configuredApiBaseUrl || devApiBaseUrl;

export const getApiBaseLabel = () => API_BASE_URL || (useSameOriginApi ? "same-origin" : "");

export const isBackendApiEnabled = () => !staticBeta && Boolean(API_BASE_URL || useSameOriginApi);

export const getBackendModeLabel = () =>
  isBackendApiEnabled() ? getApiBaseLabel() : `${getRuntimeInfo().label} / API 비활성`;

export async function requestBackend(path, options = {}) {
  if (!isBackendApiEnabled()) {
    throw new Error("Backend API is disabled in this runtime.");
  }

  const response = await fetch(`${API_BASE_URL || ""}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const raw = await response.text();
  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }
  }

  if (!response.ok) {
    const error = new Error(data?.message || `Backend request failed: ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data || {};
}

export const postBackend = (path, payload) =>
  requestBackend(path, {
    method: "POST",
    body: JSON.stringify(payload)
  });

export const checkBackendHealth = () => requestBackend("/api/health");
