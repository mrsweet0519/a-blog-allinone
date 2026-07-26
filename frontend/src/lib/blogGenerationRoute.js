export const SIMPLE_BLOG_FAILURE_MESSAGE =
  "글 생성에 실패했습니다. 입력한 내용은 유지되어 있습니다. 잠시 후 다시 시도해주세요.";

export const resolveBlogGenerationRoute = (search = "") => {
  const params = new URLSearchParams(String(search || "").replace(/^[^?]*\?/u, ""));
  const legacy = params.get("engine") === "legacy";

  return {
    endpoint: legacy ? "/api/generate-blog" : "/api/generate-blog-simple",
    allowLocalFallback: legacy
  };
};

export const fetchBlogDraftWithPolicy = async ({
  payload,
  search = "",
  fetchImpl = globalThis.fetch,
  legacyFallback
} = {}) => {
  const route = resolveBlogGenerationRoute(search);

  try {
    const response = await fetchImpl(route.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload || {})
    });

    if (!response.ok) {
      throw new Error("blog-writer-api-unavailable");
    }

    return {
      draft: await response.json(),
      fallbackUsed: false,
      route
    };
  } catch (error) {
    if (route.allowLocalFallback && typeof legacyFallback === "function") {
      return {
        draft: await legacyFallback(error),
        fallbackUsed: true,
        route
      };
    }
    throw error;
  }
};
