import { STORAGE_KEYS } from "@shared/mvpConfig.js";

const emptyDrafts = [];

export function loadDrafts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.drafts);
    return raw ? JSON.parse(raw) : emptyDrafts;
  } catch {
    return emptyDrafts;
  }
}

export function findDraft(draftId) {
  return loadDrafts().find((draft) => draft.id === draftId) ?? null;
}

export function saveDraft(form, result, previousId) {
  const drafts = loadDrafts();
  const now = new Date().toISOString();
  const title = result.titles?.[0] || form.keyword || "제목 없는 초안";
  const draft = {
    id: previousId || `draft-${Date.now()}`,
    form,
    result,
    title,
    keyword: form.keyword,
    summary: result.body?.slice(0, 120) ?? "",
    updatedAt: now,
    createdAt: drafts.find((item) => item.id === previousId)?.createdAt ?? now
  };

  const nextDrafts = [draft, ...drafts.filter((item) => item.id !== draft.id)].slice(0, 50);
  localStorage.setItem(STORAGE_KEYS.drafts, JSON.stringify(nextDrafts));
  return draft;
}

export function deleteDraft(draftId) {
  const nextDrafts = loadDrafts().filter((draft) => draft.id !== draftId);
  localStorage.setItem(STORAGE_KEYS.drafts, JSON.stringify(nextDrafts));
  return nextDrafts;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  return settings;
}
