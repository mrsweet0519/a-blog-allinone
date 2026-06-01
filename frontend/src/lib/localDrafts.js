import { STORAGE_KEYS } from "../../../shared/mvpConfig.js";
import { resolveTargetLength } from "../../../shared/contentGenerator.js";

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
  const title = result.selectedTitle || result.titles?.[0] || form.keyword || "제목 없는 초안";
  const selectedTitleType = result.selectedTitleType || result.titleType || "미분류";
  const draft = {
    id: previousId || `draft-${Date.now()}`,
    form,
    result: {
      ...result,
      selectedTitleType
    },
    title,
    titleType: selectedTitleType,
    keyword: form.keyword,
    selectedTopic: result.selectedTopic || "",
    selectedTitle: result.selectedTitle || "",
    selectedTitleType,
    targetLength: resolveTargetLength(form),
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

export function loadCompanyDefaults() {
  return loadWritingProfiles()[0]?.values ?? null;
}

const isProfileEnvelope = (value) => Array.isArray(value?.profiles);

const isProfileItem = (value) => Boolean(value?.id && value?.values);

const createProfileId = () =>
  `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeWritingProfile = (profile, index = 0) => {
  if (isProfileItem(profile)) {
    return {
      id: profile.id,
      name: profile.name || `작성 프로필 ${index + 1}`,
      values: profile.values || {},
      createdAt: profile.createdAt || new Date().toISOString(),
      updatedAt: profile.updatedAt || profile.createdAt || new Date().toISOString()
    };
  }

  return {
    id: createProfileId(),
    name: index === 0 ? "기본 작성 프로필" : `작성 프로필 ${index + 1}`,
    values: profile || {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
};

export function loadWritingProfiles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.companyDefaults);
    const parsed = raw ? JSON.parse(raw) : null;

    if (!parsed) return [];

    if (isProfileEnvelope(parsed)) {
      return parsed.profiles.map(normalizeWritingProfile);
    }

    if (Array.isArray(parsed)) {
      return parsed.map(normalizeWritingProfile);
    }

    return [normalizeWritingProfile(parsed)];
  } catch {
    return [];
  }
}

export function saveCompanyDefaults(defaults) {
  const profile = saveWritingProfile("기본 작성 프로필", defaults);
  return profile.values;
}

export function clearCompanyDefaults() {
  clearWritingProfiles();
}

export function saveWritingProfile(name, values, previousId = "") {
  const profiles = loadWritingProfiles();
  const now = new Date().toISOString();
  const profileId = previousId || createProfileId();
  const previous = profiles.find((profile) => profile.id === profileId);
  const profile = {
    id: profileId,
    name: String(name || "").trim() || previous?.name || "작성 프로필",
    values,
    createdAt: previous?.createdAt || now,
    updatedAt: now
  };
  const nextProfiles = [
    profile,
    ...profiles.filter((item) => item.id !== profile.id)
  ].slice(0, 20);

  localStorage.setItem(STORAGE_KEYS.companyDefaults, JSON.stringify({ profiles: nextProfiles }));
  return profile;
}

export function deleteWritingProfile(profileId) {
  const nextProfiles = loadWritingProfiles().filter((profile) => profile.id !== profileId);
  localStorage.setItem(STORAGE_KEYS.companyDefaults, JSON.stringify({ profiles: nextProfiles }));
  return nextProfiles;
}

export function clearWritingProfiles() {
  localStorage.removeItem(STORAGE_KEYS.companyDefaults);
}
