const text = (value) => String(value ?? "").trim();

const compact = (value) =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}_-]/gu, "");

const splitCommaList = (value = "", limit = 10) =>
  (Array.isArray(value) ? value.join(",") : text(value))
    .split(/[,\n/|]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);

const uniqueText = (values = []) => {
  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    const cleaned = text(value).replace(/\s+/g, " ");
    const key = compact(cleaned).toLowerCase();
    if (!cleaned || seen.has(key)) return;
    seen.add(key);
    result.push(cleaned);
  });

  return result;
};

const REVIEW_TAIL_PATTERN =
  /\s*(?:내돈내산\s*)?(?:솔직\s*)?(?:방문\s*후기|사용\s*후기|체험\s*후기|구매\s*후기|이용\s*후기|숙박\s*후기|방문기|사용기|후기|리뷰|추천|정리|방법|가이드|알아보기)$/u;

const ENTITY_SUFFIX_PATTERN = /본점|지점|분점|점|센터|거래소|강의|학원|매장|식당|카페|본사|브랜드/u;
const BROAD_SEARCH_PATTERN =
  /맛집|카페|추천|근처|가볼만한|갈만한|후기|리뷰|정리|방법|정보|비교|체크|아이랑|가족|여행|지역|메뉴|강의|수업/u;
const RESTAURANT_MENU_PATTERN =
  /[가-힣A-Za-z0-9]+(?:짬뽕|탕|국밥|파스타|스테이크|커피|브런치|디저트|냉면|칼국수|라멘|초밥|피자|버거)|짬뽕|탕수육|짜장|국물/u;
const LOCAL_SEARCH_PATTERN =
  /([가-힣A-Za-z0-9]+(?:도|시|군|구|동|역|해변|공항|터미널|대교|시장|단지|거리|로|길)\s*(?:근처\s*)?(?:맛집|카페|숙소|병원|학원|매장|여행|가볼만한곳))/u;

export const BLOG_WRITER_CATEGORIES = [
  "restaurant",
  "cafe",
  "accommodation",
  "travel",
  "kids-place",
  "product",
  "beauty",
  "fashion",
  "underwear",
  "experience",
  "store",
  "education",
  "hospital",
  "service",
  "information",
  "comparison",
  "other",
  "seasonal",
  "flowers"
];

export const normalizeBlogKeyword = (value = "") => {
  let current = text(value).replace(/\s+/g, " ");

  for (let index = 0; index < 3; index += 1) {
    const next = current.replace(REVIEW_TAIL_PATTERN, "").trim();
    if (next === current) break;
    current = next;
  }

  return current
    .replace(/\s*(?:방문|식사|참여|사용|숙박|수강|구매|이용|알아보기|알아본)$/u, "")
    .replace(/\s+/g, " ")
    .trim();
};

export const extractPrimaryEntityFromTopic = (value = "") => {
  const cleaned = normalizeBlogKeyword(value)
    .replace(/\s*(?:직접\s*)?(?:써본|사용해본|다녀온|방문한|참여한)\s*$/u, "")
    .trim();

  if (!cleaned) return "";

  const branchMatch = cleaned.match(/^(.+?(?:본점|지점|분점|점|센터|거래소|강의|학원|매장|식당|카페))(?:\s+.+)?$/u);
  if (branchMatch?.[1]) return branchMatch[1].trim();

  const withoutRestaurantDescriptor = cleaned.replace(/\s+맛집$/u, "").trim();
  if (withoutRestaurantDescriptor && /\s/u.test(withoutRestaurantDescriptor)) {
    return withoutRestaurantDescriptor;
  }

  return cleaned;
};

export const isBroadSearchKeyword = (value = "") => {
  const cleaned = normalizeBlogKeyword(value);
  if (!cleaned) return false;
  if (ENTITY_SUFFIX_PATTERN.test(cleaned)) return false;

  const compacted = compact(cleaned);
  if (/^[가-힣]+도맛집$/u.test(compacted) || /^[가-힣]+시맛집$/u.test(compacted)) return true;
  if (/^[가-힣]+구맛집$/u.test(compacted) || /^[가-힣]+동맛집$/u.test(compacted)) return true;

  return BROAD_SEARCH_PATTERN.test(cleaned);
};

export const looksLikeSpecificEntity = (value = "") => {
  const cleaned = normalizeBlogKeyword(value);
  if (!cleaned) return false;
  if (ENTITY_SUFFIX_PATTERN.test(cleaned)) return true;
  if (isBroadSearchKeyword(cleaned)) return false;
  if (RESTAURANT_MENU_PATTERN.test(cleaned)) return false;
  return /\s/u.test(cleaned) && compact(cleaned).length >= 5;
};

export const shouldUseTopicEntityAsMain = ({ inputKeyword = "", topicKeyword = "", topic = "" } = {}) => {
  const input = normalizeBlogKeyword(inputKeyword);
  const entity = normalizeBlogKeyword(topicKeyword || extractPrimaryEntityFromTopic(topic));
  if (!entity) return false;
  if (!input) return true;

  const inputKey = compact(input).toLowerCase();
  const entityKey = compact(entity).toLowerCase();
  if (!inputKey || inputKey === entityKey) return false;

  if (
    entityKey.includes(inputKey) &&
    entityKey.length > inputKey.length + 2 &&
    (inputKey.length <= 4 || ENTITY_SUFFIX_PATTERN.test(entity))
  ) {
    return true;
  }

  return isBroadSearchKeyword(input) && looksLikeSpecificEntity(entity);
};

export const inferBlogWriterCategory = (form = {}) => {
  const source = `${text(form.category)} ${text(form.productName)} ${text(form.mainKeyword || form.keyword)} ${text(form.experienceMemo || form.memo || form.productInfoText)}`;

  if (/비교|추천|고르는\s*법|구매\s*전|장단점|체크포인트|선택\s*기준/u.test(source)) return "comparison";
  if (/병원|의원|피부관리|시술|진료|치과|한의원|피부과|검진/u.test(source)) return "hospital";
  if (/숙소|호텔|펜션|리조트|모텔|게스트하우스|체크인|객실|1박|숙박|묵었/u.test(source)) return "accommodation";
  if (/여행|숙소|호텔|펜션|리조트|조식|체크인|객실|코스|바다|관광/u.test(source)) return "travel";
  if (/서비스|신청|예약|견적|설치|수리|청소|대행|렌탈|컨설팅/u.test(source)) return "service";
  if (/강의|수업|커리큘럼|입찰|공매|교육|강사/u.test(source)) return "education";
  if (/매입|거래소|매장|상담|사장님|안경원|문구점|서점|편집샵|쇼룸|판매점|전문점|공방/u.test(source)) return "store";
  if (/맛집|식당|짬뽕|탕수육|파스타|스테이크|식사|외식|회식/u.test(source)) return "restaurant";
  if (/카페|커피|디저트|브런치/u.test(source)) return "cafe";
  if (/아이|키즈|체험관|놀이터|실내체험|가족/u.test(source)) return "kids-place";
  if (/속옷|언더웨어|이너웨어|브라|브래지어|팬티|보정속옷|보정\s*웨어|심리스|브라렛/u.test(source)) return "underwear";
  if (/화장품|크림|세럼|앰플|패드|팩|샴푸|드라이샴푸|피부|보습|향/u.test(source)) return "beauty";
  if (/패션|의류|신발|가방|착용|자켓|셔츠|원피스|니트/u.test(source)) return "fashion";
  if (/텀블러|물병|보틀|립밤|가방|제품|사용|휴대|패키지|가전|용품/u.test(source)) return "product";
  if (/꽃|꽃집|화분|플라워/u.test(source)) return "flowers";
  if (/시즌|계절|명절|여름|겨울|봄|가을/u.test(source)) return "seasonal";
  if (/방법|정보|체크|처음|초보/u.test(source)) return "information";
  if (/체험|방문|참여/u.test(source)) return "experience";

  return "other";
};

export const collectBlogSubKeywords = (form = {}, resolvedMainKeyword = "") => {
  const memoText = text(form.experienceMemo || form.memo || form.productInfoText);
  const topicText = text(form.productName || form.topic);
  const primary = resolvedMainKeyword || extractPrimaryEntityFromTopic(topicText);
  const rawKeywords = uniqueText([
    ...splitCommaList(form.mainKeyword || form.keyword, 8),
    ...splitCommaList(form.subKeywords, 8)
  ]).map(normalizeBlogKeyword).filter(Boolean);

  const localSearchKeyword = text(`${topicText} ${memoText}`).match(LOCAL_SEARCH_PATTERN)?.[1] || "";
  const contextual = [
    localSearchKeyword,
    /여행/u.test(`${topicText} ${memoText}`) ? "가족여행" : /외식/u.test(memoText) ? "가족 외식" : /가족/u.test(memoText) ? "가족 식사" : "",
    /아이/u.test(memoText) ? "아이랑" : "",
    RESTAURANT_MENU_PATTERN.test(`${topicText} ${memoText}`)
      ? (text(`${topicText} ${memoText}`).match(RESTAURANT_MENU_PATTERN)?.[0] || "")
      : ""
  ];

  return uniqueText([...rawKeywords, ...contextual]).filter((keyword) => {
    const keywordKey = compact(keyword).toLowerCase();
    const mainKey = compact(primary).toLowerCase();
    return keywordKey && keywordKey !== mainKey;
  });
};

export const analyzeBlogWritingInput = (form = {}) => {
  const topic = text(form.productName || form.topic);
  const topicEntity = extractPrimaryEntityFromTopic(topic);
  const keywordParts = uniqueText([
    ...splitCommaList(form.mainKeyword || form.keyword, 8),
    ...splitCommaList(form.subKeywords, 8)
  ]).map(normalizeBlogKeyword);
  const firstKeyword = keywordParts[0] || "";
  const mainKeyword = shouldUseTopicEntityAsMain({
    inputKeyword: firstKeyword,
    topicKeyword: topicEntity,
    topic
  })
    ? topicEntity
    : firstKeyword || topicEntity || "상품 후기";
  const subKeywords = collectBlogSubKeywords(form, mainKeyword).slice(0, 8);

  return {
    category: inferBlogWriterCategory(form),
    topic,
    primaryEntity: topicEntity || mainKeyword,
    mainKeyword,
    broadKeyword: isBroadSearchKeyword(firstKeyword) ? firstKeyword : "",
    subKeywords,
    memoText: text(form.experienceMemo || form.memo || form.productInfoText),
    entityCorrected: Boolean(firstKeyword && mainKeyword && compact(firstKeyword) !== compact(mainKeyword))
  };
};
