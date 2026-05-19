const trimTrailingSlash = (value) => String(value || "").replace(/\/+$/u, "");

const configuredApiBaseUrl = trimTrailingSlash(import.meta.env.VITE_API_BASE_URL);
const useSameOriginApi = !configuredApiBaseUrl && import.meta.env.PROD;

export const API_BASE_URL = configuredApiBaseUrl;

export const getApiBaseLabel = () => API_BASE_URL || (useSameOriginApi ? "same-origin" : "");

export const isBackendApiEnabled = () => Boolean(API_BASE_URL || useSameOriginApi);

export async function requestBackend(path, options = {}) {
  if (!API_BASE_URL && !useSameOriginApi) {
    throw new Error("VITE_API_BASE_URL is not configured.");
  }

  const response = await fetch(`${API_BASE_URL || ""}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    throw new Error(`Backend request failed: ${response.status}`);
  }

  return response.json();
}

export const postBackend = (path, payload) =>
  requestBackend(path, {
    method: "POST",
    body: JSON.stringify(payload)
  });

export const checkBackendHealth = () => requestBackend("/api/health");
