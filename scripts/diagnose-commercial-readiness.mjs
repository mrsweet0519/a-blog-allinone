import { createHash, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_DIAGNOSTIC_TIMEOUT_MS,
  DEFAULT_PREVIEW_BRANCH,
  DEFAULT_PROJECT_NAME,
  buildGenerateBlogUrl,
  discoverLatestPreviewDeployment,
  fetchDiagnosticJson,
  formatDiagnosticAbortError,
  normalizePreviewUrl,
  parseArgs,
  parseTimeoutMs,
  summarizeDiagnosticResponse
} from "./diagnose-blog-preview.mjs";

export const COMMERCIAL_EXPORT_DIR = ".tmp-commercial-readiness";
export const DEFAULT_COMMERCIAL_CASES = 8;
const DEFAULT_WAIT_MS = 2500;

const text = (value) => String(value ?? "").trim();
const charCount = (value = "") => Array.from(String(value || "")).length;
const hashText = (value = "") => createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
const safeFilePart = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48) || "case";

const csvCell = (value = "") => `"${String(value ?? "").replace(/"/gu, '""')}"`;
const toCsvLine = (values = []) => values.map(csvCell).join(",");

const seedToNumber = (seed = "") => {
  let value = 2166136261;
  for (const char of String(seed || "commercial")) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
};

const createRng = (seed = "") => {
  let state = seedToNumber(seed);
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const pick = (rng, values = []) => values[Math.floor(rng() * values.length) % values.length];

const uniqueNameFactory = (seed = "") => {
  const rng = createRng(seed);
  const prefixes = ["하린", "도윤", "새온", "루하", "모아", "나린", "해온", "지안", "온유", "라움"];
  const middles = ["별", "담", "결", "솔", "온", "빛", "결", "담", "채", "율"];
  const suffixes = ["정", "상점", "랩", "하우스", "스튜디오", "클래스", "핏", "케어", "박스", "노트"];
  let index = 0;
  return (tail = "") => {
    index += 1;
    return `${pick(rng, prefixes)}${pick(rng, middles)}${pick(rng, suffixes)} ${String(seed).slice(0, 4)}-${index}${tail ? ` ${tail}` : ""}`;
  };
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
};

const createDiagnosticPng = ({ width = 640, height = 420, palette = "warm" } = {}) => {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const palettes = {
    restaurant: [[242, 217, 188], [145, 64, 45], [247, 246, 238], [78, 118, 80]],
    room: [[231, 226, 214], [112, 142, 166], [245, 245, 240], [120, 94, 75]],
    beauty: [[238, 230, 237], [178, 98, 124], [245, 245, 245], [92, 82, 93]],
    warm: [[235, 220, 194], [184, 110, 70], [249, 246, 238], [88, 114, 92]]
  };
  const colors = palettes[palette] || palettes.warm;

  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      const centerX = x - width / 2;
      const centerY = y - height / 2;
      const radius = Math.sqrt(centerX * centerX + centerY * centerY);
      let color = colors[0];
      if (palette === "restaurant" && radius < Math.min(width, height) * 0.28) color = colors[2];
      if (palette === "restaurant" && radius < Math.min(width, height) * 0.18) color = colors[1];
      if (palette === "room" && x > width * 0.12 && x < width * 0.88 && y > height * 0.34 && y < height * 0.74) color = colors[2];
      if (palette === "room" && x > width * 0.62 && y < height * 0.34) color = colors[1];
      if (palette === "beauty" && x > width * 0.35 && x < width * 0.65 && y > height * 0.18 && y < height * 0.82) color = colors[2];
      if (palette === "beauty" && x > width * 0.4 && x < width * 0.6 && y > height * 0.25 && y < height * 0.5) color = colors[1];
      if (x < width * 0.08 || y < height * 0.08 || x > width * 0.92 || y > height * 0.92) color = colors[3];
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
  return {
    mediaType: "image/png",
    width,
    height,
    size: png.length,
    buffer: png,
    dataUrl: `data:image/png;base64,${png.toString("base64")}`
  };
};

const makeImageContext = ({ caseId = "", palette = "warm", notes = [] } = {}) =>
  notes.map((note, index) => {
    const image = createDiagnosticPng({ palette });
    return {
      index: index + 1,
      name: `${caseId}-photo-${index + 1}.png`,
      source: "commercial-readiness",
      note,
      ocrText: note,
      mediaType: image.mediaType,
      size: image.size,
      width: image.width,
      height: image.height,
      dataUrl: image.dataUrl,
      __buffer: image.buffer
    };
  });

export const createCommercialReadinessInputs = ({ seed = randomUUID().slice(0, 8), skipImages = false } = {}) => {
  const makeName = uniqueNameFactory(seed);
  const restaurantName = makeName("성수 점심집");
  const productName = makeName("정리 트레이");
  const stayName = makeName("강릉 스테이");
  const className = makeName("실전 노션 강의");
  const beautyName = makeName("톤업 크림");
  const underwearName = makeName("심리스 브라렛");
  const infoName = makeName("동네 도서관 좌석 확인");
  const compareName = makeName("소형 공기청정기 비교");

  const imageOrEmpty = (args) => (skipImages ? [] : makeImageContext(args));

  return [
    {
      caseId: "restaurant-high-vision",
      category: "restaurant",
      informationLevel: "high",
      productName: restaurantName,
      mainKeyword: "성수 점심 맛집",
      subKeywords: "혼밥, 국물 메뉴",
      targetCharCount: 2200,
      experienceMemo: [
        `지난 수요일 오후 1시 20분쯤 ${restaurantName}에 혼자 점심을 먹으러 직접 방문했다.`,
        "회의가 길어져 오래 기다리지 않고 한 그릇으로 먹을 수 있는 곳을 찾던 상황이었다.",
        "입구 쪽에는 작은 대기 공간이 있었고 피크가 지나도 두 팀 정도가 메뉴판을 보고 있었다.",
        "좋았던 점은 혼자 앉아도 테이블 간격이 답답하지 않아 식사 중 시선 부담이 적었다는 점이다.",
        "또 좋았던 점은 국물 간이 세지 않아 오후 업무 전에 속이 무겁지 않았다는 점이다.",
        "사진으로는 둥근 그릇, 붉은 국물, 초록색 고명, 밝은 테이블이 확인된다.",
        "아쉬웠던 점은 입구 가까운 자리는 사람이 오갈 때 조금 분주하게 느껴졌다는 점이다.",
        "다음에는 동료와 함께 가서 다른 국물 메뉴도 비교해볼 의사가 있다.",
        "주문 전에는 혼밥 분위기와 메뉴가 단순한지를 가장 궁금하게 봤다.",
        "본문에는 방문 시간, 식사 상황, 사진에서 확인되는 시각 요소, 재방문 의사가 모두 들어가야 한다."
      ].join("\n"),
      imageContext: imageOrEmpty({
        caseId: "restaurant-high-vision",
        palette: "restaurant",
        notes: [
          "둥근 흰 그릇 안에 붉은 국물과 초록색 고명이 있고 밝은 나무색 테이블이 보인다.",
          "테이블 가장자리와 그릇이 위에서 내려다보이는 구도로 배치되어 있다."
        ]
      })
    },
    {
      caseId: "product-high-no-image",
      category: "product",
      informationLevel: "high",
      productName,
      mainKeyword: "생활용품 정리 트레이",
      subKeywords: "책상 정리, 재구매",
      targetCharCount: 2100,
      experienceMemo: [
        `${productName}는 지난 주말 집 책상 위 충전기와 문구류를 정리하려고 직접 사용했다.`,
        "사용 전에는 볼펜, 케이블, 영수증이 한쪽에 쌓여 노트북을 펼 때마다 자리를 옮겨야 했다.",
        "좋았던 점은 낮은 칸막이 덕분에 케이블 머리와 펜을 따로 두기 쉬웠다는 점이다.",
        "또 좋았던 점은 바닥이 미끄럽지 않아 서랍을 열 때 같이 밀리지 않았다는 점이다.",
        "아쉬웠던 점은 폭이 넓은 어댑터는 한 칸에 넣으면 옆 공간을 조금 침범했다는 점이다.",
        "3일 정도 사용해보니 매일 쓰는 물건을 올려두는 용도로는 다시 살 의사가 있다.",
        "다만 여행용 파우치처럼 들고 다니기보다 고정된 책상 위에서 쓰는 쪽이 맞았다.",
        "먼지가 잘 보이는 색상이라 주 1회 정도 닦아야 깔끔해 보였다.",
        "구매 전에는 칸 크기와 미끄럼 여부, 케이블 정리 가능성을 가장 궁금하게 봤다.",
        "본문에는 사용 전 문제, 실제 사용 상황, 장점 두 가지, 아쉬운 점, 재구매 의사가 들어가야 한다."
      ].join("\n"),
      imageContext: []
    },
    {
      caseId: "stay-medium-vision",
      category: "accommodation",
      informationLevel: "medium",
      productName: stayName,
      mainKeyword: "강릉 숙소 후기",
      subKeywords: "객실 컨디션, 재방문",
      targetCharCount: 1700,
      experienceMemo: [
        `${stayName}는 지난달 금요일 1박으로 직접 숙박했다.`,
        "도착 시간이 늦어서 체크인 동선이 복잡하지 않은지를 먼저 봤다.",
        "사진으로는 흰 침구, 낮은 침대, 창가 쪽 파란 면, 차분한 바닥색이 확인된다.",
        "좋았던 점은 캐리어를 펼칠 공간이 침대 옆에 남아 있었다는 점이다.",
        "또 좋았던 점은 밤에 조명이 너무 밝지 않아 짐 정리 후 쉬기 편했다는 점이다.",
        "아쉬웠던 점은 욕실 앞 수건걸이 쪽 공간이 좁아 두 사람이 동시에 움직이기는 애매했다.",
        "다음에도 늦은 체크인 일정이라면 다시 고려할 의사가 있다."
      ].join("\n"),
      imageContext: imageOrEmpty({
        caseId: "stay-medium-vision",
        palette: "room",
        notes: [
          "밝은 침구와 낮은 침대 형태가 보이고 창가 쪽에 푸른 색 면이 있다.",
          "객실 바닥은 차분한 톤이고 큰 가구가 많지 않은 단순한 배치다."
        ]
      })
    },
    {
      caseId: "education-high-no-image",
      category: "education",
      informationLevel: "high",
      productName: className,
      mainKeyword: "노션 강의 후기",
      subKeywords: "실습 과제, 피드백",
      targetCharCount: 2200,
      experienceMemo: [
        `${className}는 지난달 4주 과정 중 1주차와 2주차를 직접 수강했다.`,
        "수강 계기는 업무 메모와 프로젝트 기록이 흩어져 템플릿을 직접 만들고 싶었기 때문이다.",
        "첫 시간에는 데이터베이스 용어를 한꺼번에 설명하지 않고 할 일 목록 예시부터 실습했다.",
        "좋았던 점은 화면을 따라 하는 시간과 혼자 수정해보는 시간이 분리되어 있었다는 점이다.",
        "또 좋았던 점은 과제 피드백에서 완성본보다 왜 구조가 막히는지를 알려준 점이다.",
        "아쉬웠던 점은 실시간 질문 시간이 짧아 개인 업무 사례를 길게 설명하기 어려웠다는 점이다.",
        "수강 후에는 회의록과 할 일 목록을 같은 페이지에서 연결해보게 됐다.",
        "심화반에서 자동화 연결을 다룬다면 이어서 들을 의사가 있다.",
        "초보자 입장에서는 단축키보다 구조를 먼저 잡는 흐름이 더 도움이 됐다.",
        "본문에는 수강 계기, 수업 흐름, 장점 두 가지, 아쉬운 점, 이후 변화가 반영되어야 한다."
      ].join("\n"),
      imageContext: []
    },
    {
      caseId: "beauty-high-vision",
      category: "beauty",
      informationLevel: "high",
      productName: beautyName,
      mainKeyword: "톤업 크림 후기",
      subKeywords: "패키지, 사용감",
      targetCharCount: 2000,
      experienceMemo: [
        `${beautyName}는 지난주 아침 출근 전 베이스 단계에서 직접 사용했다.`,
        "처음에는 손등에 소량 덜어 펴보고 얼굴에는 얇게 한 번만 발랐다.",
        "사진으로는 연한 분홍색 패키지, 흰색 용기 면, 직사각형 라벨 영역이 확인된다.",
        "좋았던 점은 손으로 펴 바를 때 뭉침이 빠르게 생기지 않아 바쁜 아침에 쓰기 편했다는 점이다.",
        "또 좋았던 점은 파우치에 넣었을 때 뚜껑이 쉽게 열릴 것 같은 느낌이 적었다는 점이다.",
        "아쉬웠던 점은 양 조절을 많이 하면 코 옆에 밝게 남아 티슈로 한 번 눌러줘야 했다.",
        "실제 사용 후에는 짧은 외출용으로는 다시 사용할 의사가 있다.",
        "다만 커버력이나 피부 개선 효과는 사진이나 짧은 사용만으로 단정하지 않는다.",
        "구매 전에는 패키지 크기와 아침 사용감, 얇게 발리는지를 가장 궁금하게 봤다.",
        "본문에는 사진에서 보이는 패키지 요소와 실제 사용감만 분리해서 써야 한다."
      ].join("\n"),
      imageContext: imageOrEmpty({
        caseId: "beauty-high-vision",
        palette: "beauty",
        notes: ["연한 분홍색 배경 위에 흰색 직사각형 용기와 라벨처럼 보이는 면이 있다."]
      })
    },
    {
      caseId: "underwear-high-no-image",
      category: "underwear",
      informationLevel: "high",
      productName: underwearName,
      mainKeyword: "심리스 브라렛 후기",
      subKeywords: "착용감, 재구매",
      targetCharCount: 2100,
      experienceMemo: [
        `${underwearName}는 지난주 재택근무 날과 짧은 외출 날에 직접 착용했다.`,
        "구매 전에는 봉제선이 겉옷에 드러나는지와 장시간 앉아 있을 때 답답한지를 궁금하게 봤다.",
        "좋았던 점은 얇은 티셔츠 안에서도 선이 크게 도드라져 보이지 않았다는 점이다.",
        "또 좋았던 점은 어깨끈 길이를 다시 맞춘 뒤에는 오후까지 흘러내림이 적었다는 점이다.",
        "아쉬웠던 점은 처음 꺼냈을 때 컵 모양이 살짝 눌려 있어 손으로 정리해줘야 했다.",
        "세탁망에 넣어 한 번 세탁한 뒤에도 형태가 크게 틀어지지는 않았다.",
        "운동용보다는 재택근무나 가벼운 외출용에 더 맞는 느낌이었다.",
        "실제 착용 후에는 같은 색상보다 밝은 색 하나를 추가로 살 의사가 있다.",
        "피부 자극이나 보정 효과는 개인차가 있어서 단정하지 않는다.",
        "본문에는 착용 상황, 장점 두 가지, 아쉬운 점, 세탁 후 변화, 재구매 의사를 반영해야 한다."
      ].join("\n"),
      imageContext: []
    },
    {
      caseId: "information-low-no-image",
      category: "information",
      informationLevel: "low",
      productName: infoName,
      mainKeyword: "도서관 좌석 확인 방법",
      subKeywords: "운영 정보, 방문 전 확인",
      targetCharCount: 900,
      experienceMemo: [
        `${infoName}에 대해 아직 직접 방문하지 않았고 좌석 확인 방법만 알아보는 중이다.`,
        "현재 알고 있는 것은 도서관 이름과 방문 전 좌석 확인이 필요하다는 점뿐이다.",
        "실제 이용 후기처럼 쓰지 말고 부족한 정보는 짧게 정리해야 한다."
      ].join("\n"),
      imageContext: []
    },
    {
      caseId: "comparison-medium-no-image",
      category: "product",
      informationLevel: "medium",
      productName: compareName,
      mainKeyword: "소형 공기청정기 비교",
      subKeywords: "책상용, 선택 기준",
      targetCharCount: 1700,
      experienceMemo: [
        `${compareName}는 자취방 책상 위에 둘 제품을 고르려고 두 후보를 비교한 내용이다.`,
        "직접 구매 전 단계라 실제 사용 후기는 아니고, 크기와 필터 교체 방식, 소음 정보를 비교했다.",
        "좋게 본 점은 책상 위 공간을 많이 차지하지 않는 크기 후보가 있다는 점이다.",
        "또 좋게 본 점은 필터 교체 주기가 표시되어 유지비를 가늠하기 쉬웠다는 점이다.",
        "아쉬웠던 점은 소음 수치가 표기되어 있어도 실제 체감은 사용 전까지 알기 어렵다는 점이다.",
        "구매한다면 가격보다 책상 위 배치와 필터 교체 편의성을 먼저 보고 선택할 생각이다.",
        "허위 사용 경험 없이 비교 기준 중심으로 작성해야 한다."
      ].join("\n"),
      imageContext: []
    }
  ].map((input) => {
    const imageContext = input.imageContext || [];
    return {
      ...input,
      images: imageContext,
      photoMetadata: imageContext,
      imageCount: imageContext.length
    };
  });
};

const getPackage = (json = {}) => json.contentPackage || {};
const getBody = (json = {}) => text(json.body || getPackage(json).blogBody || "");
const getTitle = (json = {}) => text(json.finalTitle || json.selectedTitle || getPackage(json).finalRecommendedTitle || "");
const getTitleCandidates = (json = {}) => json.titleCandidates || json.titles || getPackage(json).titleCandidates || [];
const getFaqItems = (json = {}) => json.faq || json.faqItems || getPackage(json).faqItems || [];
const getHashtags = (json = {}) => json.hashtags || getPackage(json).hashtags || [];

const sumUsageObjects = (value = {}) => {
  if (!value || typeof value !== "object") return { input: 0, output: 0, total: 0 };
  const input = Number(value.input || value.prompt_tokens || value.input_tokens || 0) || 0;
  const output = Number(value.output || value.completion_tokens || value.output_tokens || 0) || 0;
  const total = Number(value.total || value.total_tokens || 0) || input + output;
  return { input, output, total };
};

const addUsage = (left, right) => ({
  input: Number(left.input || 0) + Number(right.input || 0),
  output: Number(left.output || 0) + Number(right.output || 0),
  total: Number(left.total || 0) + Number(right.total || 0)
});

const collectTokenUsage = (json = {}) => {
  let usage = sumUsageObjects(json.usage || getPackage(json).usage || getPackage(json).tokenUsage || json.tokenUsage);
  const stages = json.llmStages || getPackage(json).llmStages || {};
  [stages.writer, stages.judge, ...(Array.isArray(stages.revisions) ? stages.revisions : [])].forEach((stage) => {
    usage = addUsage(usage, sumUsageObjects(stage?.usage || stage?.tokenUsage));
  });
  return usage;
};

const titleChecks = ({ title = "", titleCandidates = [], primaryEntity = "", category = "" } = {}) => {
  const candidates = Array.isArray(titleCandidates) ? titleCandidates.map(text).filter(Boolean) : [];
  const includesEntity = (value = "") => primaryEntity && value.replace(/\s+/gu, "").includes(primaryEntity.replace(/\s+/gu, ""));
  const duplicateCount = candidates.length - new Set(candidates.map((item) => item.replace(/\s+/gu, ""))).size;
  const bannedPattern = /정보\s*정리|포인트까지\s*정리|식사로\s*본\s*점|실제\s*후기\s*사용\s*후기|해당\s*제품|대표\s*메뉴/u;
  const categoryLeak =
    category === "product" ? candidates.some((item) => /방문|예약|주차/u.test(item)) :
      category === "restaurant" ? candidates.some((item) => /착용감|발림|수강/u.test(item)) :
        false;
  const titleLength = charCount(title);
  return {
    candidateCount: candidates.length,
    candidatesWithPrimaryEntity: candidates.filter(includesEntity).length,
    finalTitleHasPrimaryEntity: includesEntity(title),
    titleLength,
    titleLengthRecommended: titleLength >= 25 && titleLength <= 42,
    duplicateCount,
    bannedTitlePattern: candidates.some((item) => bannedPattern.test(item)) || bannedPattern.test(title),
    categoryLeak,
    pass:
      candidates.length === 5 &&
      candidates.filter(includesEntity).length >= 4 &&
      includesEntity(title) &&
      duplicateCount === 0 &&
      !categoryLeak &&
      !(candidates.some((item) => bannedPattern.test(item)) || bannedPattern.test(title))
  };
};

const faqChecks = (faq = [], category = "") => {
  const list = Array.isArray(faq) ? faq : [];
  const invalid = list.filter((item) => {
    const source = `${item?.question || ""} ${item?.answer || ""}`;
    if (/글\s*작성|사진\s*배치|\[확인 필요\]|확인\s*필요/u.test(source)) return true;
    if (category === "product" && /방문|예약|주차/u.test(source)) return true;
    if (/효과/u.test(source) && !/사용감|느낌/u.test(source)) return true;
    return false;
  });
  return {
    count: list.length,
    invalidCount: invalid.length,
    pass: list.length <= 2 && invalid.length === 0
  };
};

const detectFalseExperience = ({ input = {}, body = "" } = {}) => {
  if (input.informationLevel !== "low" && !/구매 전 단계|직접 구매 전/u.test(input.experienceMemo || "")) return false;
  if (/직접\s*(?:방문|사용|구매|착용|수강)(?:하지\s*않|한\s*것은\s*아니|전\s*단계)|아직\s*직접|구매\s*전\s*단계|실제\s*사용\s*후기는\s*아니/u.test(body)) {
    return false;
  }
  return /직접\s*(?:방문|사용|구매|착용|수강)|다녀왔|먹어봤|사용해봤|써봤|묵었|숙박했다/u.test(body);
};

const classifyFailure = (summary = {}) => {
  const codes = summary.issueCodes || [];
  if (summary.primaryEntityCoverage !== true || codes.some((code) => /PRIMARY_ENTITY|TITLE_MISSING/u.test(code))) return "entity extraction";
  if (codes.some((code) => /CATEGORY|INTENT|TITLE-INTENTS|RESTAURANT/u.test(code))) return "category/searchIntent";
  if (codes.some((code) => /EXPERIENCE|CONTRADICT/u.test(code))) return "experienceStatus";
  if (Number(summary.inputFactCoverage || 0) < 0.9 || codes.some((code) => /MISSING_FACT|FACT/u.test(code))) return "Fact Map";
  if (summary.imageExpected && summary.visionMode !== "vision") return "Vision";
  if (codes.some((code) => /TARGET_LENGTH|LENGTH/u.test(code))) return "target length";
  if (codes.some((code) => /JUDGE|HASHTAGS|GUIDE|META/u.test(code))) return "Judge";
  if (summary.revisionUsed && Number(summary.qualityScore || 0) < 95) return "Revision";
  if (codes.some((code) => /DUPLICATE|CLAIMLEDGER/u.test(code))) return "post-processing";
  return "Writer prompt";
};

const evaluateCommercialCase = ({ input = {}, summary = {}, titleCheck = {}, faqCheck = {}, falseExperience = false, previousTopicContamination = false } = {}) => {
  const highOrMedium = input.informationLevel !== "low";
  const targetRatio = Number(summary.targetComplianceRatio || 0);
  const commonChecks = {
    engine: summary.engine === "llm",
    judgeEngine: summary.judgeEngine === "llm",
    isMock: summary.isMock === false,
    writerSuccess: summary.writerSuccess === true,
    judgeSuccess: highOrMedium ? summary.judgeSuccess === true : true,
    primaryEntityCoverage: summary.primaryEntityCoverage === true,
    unsupportedClaimCount: Number(summary.unsupportedClaimCount || 0) === 0,
    categoryContaminationCount: Number(summary.categoryContaminationCount || 0) === 0,
    metaGuidanceCount: Number(summary.metaGuidanceCount || 0) === 0,
    josaErrorCount: Number(summary.josaErrorCount || 0) === 0,
    genericFillerRatio: Number(summary.genericFillerRatio || 0) <= 0.1,
    falseExperience: !falseExperience,
    previousTopicContamination: !previousTopicContamination,
    faqPolicy: faqCheck.pass
  };

  const pass = highOrMedium
    ? Object.values(commonChecks).every(Boolean) &&
      Number(summary.inputFactCoverage || 0) >= 0.9 &&
      targetRatio >= 0.85 &&
      targetRatio <= 1.1 &&
      Number(summary.qualityScore || 0) >= 95 &&
      summary.publishReady === true &&
      titleCheck.pass === true
    : ["llm", "fallback"].includes(summary.engine) &&
      ["honest_draft", "fallback_draft"].includes(summary.resultMode) &&
      commonChecks.unsupportedClaimCount &&
      commonChecks.categoryContaminationCount &&
      commonChecks.metaGuidanceCount &&
      commonChecks.falseExperience &&
      commonChecks.previousTopicContamination;

  const failedChecks = Object.entries({
    ...commonChecks,
    inputFactCoverage: highOrMedium ? Number(summary.inputFactCoverage || 0) >= 0.9 : true,
    targetComplianceRatio: highOrMedium ? targetRatio >= 0.85 && targetRatio <= 1.1 : true,
    qualityScore: highOrMedium ? Number(summary.qualityScore || 0) >= 95 : true,
    publishReady: highOrMedium ? summary.publishReady === true : true,
    titlePolicy: highOrMedium ? titleCheck.pass === true : true
  }).filter(([, passed]) => !passed).map(([key]) => key);

  return {
    pass,
    failedChecks
  };
};

const percentile = (values = [], p = 0.5) => {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index];
};

const summarizeAggregate = (cases = []) => {
  const highMedium = cases.filter((item) => item.informationLevel !== "low");
  const scores = highMedium.map((item) => Number(item.qualityScore || 0));
  const coverages = highMedium.map((item) => Number(item.inputFactCoverage || 0));
  const latencies = cases.map((item) => Number(item.latencyMs || 0));
  const fallbackHighMedium = highMedium.filter((item) => item.engine !== "llm").length;
  const falseExperienceCount = cases.filter((item) => item.falseExperience).length;
  const previousTopicContaminationCount = cases.filter((item) => item.previousTopicContamination).length;
  const automaticPass =
    highMedium.length > 0 &&
    highMedium.every((item) => item.publishReady === true && item.caseResult === "PASS") &&
    (scores.reduce((total, score) => total + score, 0) / Math.max(1, scores.length)) >= 95 &&
    Math.min(...scores) >= 90 &&
    (coverages.reduce((total, value) => total + value, 0) / Math.max(1, coverages.length)) >= 0.95 &&
    fallbackHighMedium === 0 &&
    falseExperienceCount === 0 &&
    previousTopicContaminationCount === 0 &&
    cases.every((item) => Number(item.categoryContaminationCount || 0) === 0);

  const usage = cases.reduce((total, item) => addUsage(total, item.tokenUsage || {}), { input: 0, output: 0, total: 0 });
  return {
    automaticResult: automaticPass ? "PASS" : "FAIL",
    recommendation: automaticPass ? "CONDITIONAL" : "REJECT",
    recommendationReason: automaticPass ? "Automatic checks passed; human blind review is still required before main merge." : "One or more automatic commercial readiness checks failed.",
    highMediumCount: highMedium.length,
    publishReadyHighMedium: highMedium.filter((item) => item.publishReady).length,
    fallbackHighMedium,
    falseExperienceCount,
    previousTopicContaminationCount,
    averageQualityScore: scores.length ? Number((scores.reduce((total, score) => total + score, 0) / scores.length).toFixed(2)) : 0,
    minQualityScore: scores.length ? Math.min(...scores) : 0,
    averageFactCoverage: coverages.length ? Number((coverages.reduce((total, value) => total + value, 0) / coverages.length).toFixed(2)) : 0,
    averageLatencyMs: latencies.length ? Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length) : 0,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    writerCalls: cases.reduce((total, item) => total + Number(item.retryCounts?.writer || 0), 0),
    judgeCalls: cases.reduce((total, item) => total + Number(item.retryCounts?.judge || 0), 0),
    revisionCalls: cases.reduce((total, item) => total + Number(item.revisionCallCount || 0), 0),
    tokenUsage: usage,
    averageTokenUsage: {
      input: cases.length ? Math.round(usage.input / cases.length) : 0,
      output: cases.length ? Math.round(usage.output / cases.length) : 0,
      total: cases.length ? Math.round(usage.total / cases.length) : 0
    }
  };
};

const summarizeForConsole = (item = {}) => ({
  caseId: item.caseId,
  category: item.category,
  informationSufficiency: item.informationSufficiency,
  visionMode: item.visionMode,
  engine: item.engine,
  judgeEngine: item.judgeEngine,
  writerSuccess: item.writerSuccess,
  judgeSuccess: item.judgeSuccess,
  revisionCallCount: item.revisionCallCount,
  qualityAttempts: item.qualityAttempts,
  attemptScores: item.attemptScores,
  requestedTargetCharCount: item.requestedTargetCharCount,
  actualCharCount: item.actualCharCount,
  targetComplianceRatio: item.targetComplianceRatio,
  inputFactCoverage: item.inputFactCoverage,
  qualityScore: item.qualityScore,
  publishReady: item.publishReady,
  unsupportedClaimCount: item.unsupportedClaimCount,
  categoryContaminationCount: item.categoryContaminationCount,
  metaGuidanceCount: item.metaGuidanceCount,
  josaErrorCount: item.josaErrorCount,
  genericFillerRatio: item.genericFillerRatio,
  latencyMs: item.latencyMs,
  tokenUsage: item.tokenUsage,
  caseResult: item.caseResult,
  failedChecks: item.failedChecks,
  failureCategory: item.failureCategory
});

const writeImageAssets = async ({ dir = "", caseId = "", imageContext = [] } = {}) => {
  const imageDir = join(dir, "blind", "images");
  await mkdir(imageDir, { recursive: true });
  const assets = [];
  for (const [index, image] of imageContext.entries()) {
    const buffer = image.__buffer || Buffer.from(String(image.dataUrl || "").split(",")[1] || "", "base64");
    const fileName = `${caseId}-photo-${index + 1}.png`;
    const relativePath = `images/${fileName}`;
    await writeFile(join(imageDir, fileName), buffer);
    assets.push({
      name: image.name || fileName,
      path: relativePath,
      mediaType: image.mediaType,
      width: image.width || 0,
      height: image.height || 0,
      objectFit: "contain",
      ratioPreserved: true,
      note: image.note || ""
    });
  }
  return assets;
};

const createBlindMarkdown = ({ input = {}, title = "", titleCandidates = [], body = "", faq = [], hashtags = [], images = [] } = {}) => [
  `# ${input.caseId}`,
  "",
  "## 입력 요약",
  `- 카테고리: ${input.category}`,
  `- 주제: ${input.productName}`,
  `- 메인 키워드: ${input.mainKeyword}`,
  `- 서브 키워드: ${input.subKeywords}`,
  `- 목표 글자수: ${input.targetCharCount}`,
  `- 정보 수준: ${input.informationLevel}`,
  "",
  "## 최종 제목",
  title,
  "",
  "## 제목 후보",
  ...titleCandidates.map((candidate, index) => `${index + 1}. ${candidate}`),
  "",
  "## 사진 미리보기",
  ...(images.length ? images.map((image) => `- ${image.path} (${image.objectFit})`) : ["- N/A"]),
  "",
  "## 본문",
  body,
  "",
  "## FAQ",
  ...(faq.length ? faq.flatMap((item) => [`Q. ${item.question}`, `A. ${item.answer}`, ""]) : ["N/A"]),
  "",
  "## 해시태그",
  hashtags.join(" ")
].join("\n");

const createReviewSheet = (cases = []) => {
  const headers = [
    "caseId",
    "category",
    "titleUsableYN",
    "openingNatural1to5",
    "humanLike1to5",
    "factReflection1to5",
    "inventedExperienceYN",
    "sectionNewInfo1to5",
    "photoConnection1to5OrNA",
    "publishWithin3MinYN",
    "reuseIntent1to5",
    "needsFix"
  ];
  return [
    toCsvLine(headers),
    ...cases.map((item) => toCsvLine([item.caseId, item.category, "", "", "", "", "", "", item.imageExpected ? "" : "N/A", "", "", ""]))
  ].join("\n");
};

const writeCommercialExport = async ({ runId = "", cases = [], exportRoot = COMMERCIAL_EXPORT_DIR, referenceInfo = null } = {}) => {
  const dir = join(exportRoot, runId);
  const blindDir = join(dir, "blind");
  const metadataDir = join(dir, "metadata");
  await mkdir(blindDir, { recursive: true });
  await mkdir(metadataDir, { recursive: true });

  for (const item of cases) {
    const prefix = `${item.caseId}-${safeFilePart(item.category)}`;
    const images = await writeImageAssets({ dir, caseId: item.caseId, imageContext: item.inputImageContext || [] });
    const blind = {
      caseId: item.caseId,
      inputSummary: {
        category: item.category,
        productName: item.inputSummary.productName,
        mainKeyword: item.inputSummary.mainKeyword,
        subKeywords: item.inputSummary.subKeywords,
        targetCharCount: item.requestedTargetCharCount,
        informationLevel: item.informationLevel
      },
      finalTitle: item.finalTitle,
      titleCandidates: item.titleCandidates,
      body: item.body,
      faq: item.faq,
      hashtags: item.hashtags,
      images
    };
    await writeFile(join(blindDir, `${prefix}.json`), `${JSON.stringify(blind, null, 2)}\n`, "utf8");
    await writeFile(join(blindDir, `${prefix}.md`), `${createBlindMarkdown({
      input: { ...item.inputSummary, caseId: item.caseId, category: item.category, informationLevel: item.informationLevel },
      title: item.finalTitle,
      titleCandidates: item.titleCandidates,
      body: item.body,
      faq: item.faq,
      hashtags: item.hashtags,
      images
    })}\n`, "utf8");
    const { body, finalTitle, titleCandidates, faq, hashtags, inputImageContext, ...metadata } = item;
    await writeFile(join(metadataDir, `${prefix}.json`), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  }

  await writeFile(join(dir, "review-sheet.csv"), `${createReviewSheet(cases)}\n`, "utf8");
  if (referenceInfo) {
    await writeFile(join(dir, "reference-info.json"), `${JSON.stringify(referenceInfo, null, 2)}\n`, "utf8");
  }
  return dir;
};

const inspectReferenceDir = async (referenceDir = "") => {
  const dir = text(referenceDir);
  if (!dir) return null;
  try {
    const info = await stat(dir);
    if (!info.isDirectory()) return { provided: true, usable: false, reason: "not-directory" };
    const files = (await readdir(dir)).filter((name) => /\.(txt|md|json)$/iu.test(name));
    const samples = [];
    for (const file of files.slice(0, 16)) {
      const content = await readFile(join(dir, file), "utf8");
      samples.push({ file: basename(file), hash: hashText(content), charCount: charCount(content) });
    }
    return { provided: true, usable: files.length > 0, fileCount: files.length, samples };
  } catch (error) {
    return { provided: true, usable: false, reason: error.message };
  }
};

export const runCommercialDiagnostics = async ({
  previewUrl = "",
  timeoutMs = 240_000,
  cases = DEFAULT_COMMERCIAL_CASES,
  exportResults = false,
  skipImages = false,
  seed = randomUUID().slice(0, 8),
  referenceDir = ""
} = {}) => {
  const baseUrl = normalizePreviewUrl(previewUrl);
  const url = buildGenerateBlogUrl(baseUrl);
  const inputs = createCommercialReadinessInputs({ seed, skipImages }).slice(0, Math.max(1, Math.min(8, Number(cases) || DEFAULT_COMMERCIAL_CASES)));
  const summaries = [];
  const allEntities = inputs.map((input) => input.productName);

  for (const [index, input] of inputs.entries()) {
    const startedAt = Date.now();
    const { status, json } = await fetchDiagnosticJson(url, input, { timeoutMs });
    const latencyMs = Date.now() - startedAt;
    const base = summarizeDiagnosticResponse({ url, status, json, imageExpected: input.imageCount > 0 });
    const packageData = getPackage(json);
    const llmStages = json.llmStages || {};
    const revisionDiagnostics = base.qualityDiagnostics || {};
    const titleCandidates = getTitleCandidates(json);
    const finalTitle = getTitle(json);
    const body = getBody(json);
    const faq = getFaqItems(json);
    const hashtags = getHashtags(json);
    const primaryEntity = packageData.primaryEntity || input.productName;
    const titleCheck = titleChecks({ title: finalTitle, titleCandidates, primaryEntity, category: input.category });
    const faqCheck = faqChecks(faq, input.category);
    const falseExperience = detectFalseExperience({ input, body });
    const previousTopicContamination = allEntities
      .filter((entity) => entity !== input.productName)
      .some((entity) => body.includes(entity) || finalTitle.includes(entity));
    const summary = {
      caseId: input.caseId,
      category: input.category,
      informationLevel: input.informationLevel,
      seed,
      engine: base.engine,
      judgeEngine: base.judgeEngine,
      isMock: base.isMock,
      visionMode: base.visionMode,
      imageExpected: input.imageCount > 0,
      visibleElementsCount: base.visibleElementsCount,
      writerSuccess: llmStages.writer?.success === true,
      judgeSuccess: llmStages.judge?.success === true,
      revisionUsed: Boolean(revisionDiagnostics.revisionUsed),
      revisionCallCount: Number(revisionDiagnostics.revisionCallCount || 0),
      qualityAttempts: Number(base.qualityAttempts || 0),
      attemptScores: revisionDiagnostics.attemptScores || [],
      selectedAttempt: revisionDiagnostics.selectedAttempt || 0,
      informationSufficiency: base.informationSufficiency || "unknown",
      resultMode: base.resultMode || "unknown",
      requestedTargetCharCount: base.requestedTargetCharCount || input.targetCharCount,
      actualCharCount: base.actualCharCount ?? charCount(body),
      targetComplianceRatio: base.targetComplianceRatio ?? 0,
      inputFactCoverage: base.inputFactCoverage ?? 0,
      primaryEntityCoverage: base.primaryEntityCoverage === true,
      unsupportedClaimCount: base.unsupportedClaimCount || 0,
      categoryContaminationCount: base.categoryContaminationCount || 0,
      metaGuidanceCount: base.metaGuidanceCount || 0,
      josaErrorCount: base.josaErrorCount || 0,
      genericFillerRatio: base.genericFillerRatio || 0,
      qualityScore: base.qualityScore || 0,
      publishReady: base.publishReady,
      hardFail: base.hardFail,
      issueCodes: base.issueCodes || [],
      latencyMs,
      tokenUsage: collectTokenUsage(json),
      retryCounts: {
        writer: llmStages.writer?.attempts || 0,
        judge: llmStages.judge?.attempts || 0,
        revisions: (llmStages.revisions || []).map((stage) => stage.attempts || 0)
      },
      titleCheck,
      faqCheck,
      falseExperience,
      previousTopicContamination,
      contentHash: hashText(`${finalTitle}\n${body}`),
      inputSummary: {
        productName: input.productName,
        mainKeyword: input.mainKeyword,
        subKeywords: input.subKeywords
      },
      inputImageContext: input.imageContext || [],
      finalTitle,
      titleCandidates,
      body,
      faq,
      hashtags
    };
    const evaluation = evaluateCommercialCase({
      input,
      summary,
      titleCheck,
      faqCheck,
      falseExperience,
      previousTopicContamination
    });
    summary.caseResult = evaluation.pass ? "PASS" : "FAIL";
    summary.failedChecks = evaluation.failedChecks;
    summary.failureCategory = evaluation.pass ? "" : classifyFailure(summary);
    summaries.push(summary);
    if (index < inputs.length - 1) await wait(DEFAULT_WAIT_MS);
  }

  const aggregate = summarizeAggregate(summaries);
  const failureCategories = summaries
    .filter((item) => item.caseResult !== "PASS" || item.hardFail)
    .reduce((acc, item) => {
      const key = item.failureCategory || (item.hardFail ? "hardFail" : "unknown");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  const commonFailureCategories = Object.entries(failureCategories)
    .filter(([, count]) => count >= 3)
    .map(([category, count]) => ({ category, count }));
  const referenceInfo = await inspectReferenceDir(referenceDir);
  const runId = `commercial-readiness-${new Date().toISOString().replace(/[:.]/gu, "-")}-${seed}`;
  const exportPath = exportResults ? await writeCommercialExport({ runId, cases: summaries, referenceInfo }) : "";

  return {
    previewUrl: baseUrl,
    runId,
    seed,
    exported: Boolean(exportResults),
    exportPath,
    ...aggregate,
    caseCount: summaries.length,
    visionCaseCount: summaries.filter((item) => item.imageExpected).length,
    actualVisionCount: summaries.filter((item) => item.imageExpected && item.visionMode === "vision").length,
    tokenUsageAvailable: summaries.some((item) => Number(item.tokenUsage?.total || 0) > 0),
    commonFailureCategories,
    hardFailCount: summaries.filter((item) => item.hardFail).length,
    cases: summaries.map(summarizeForConsole),
    humanReview: {
      required: true,
      status: "PENDING",
      reviewCommand: exportPath ? `npm.cmd run review:commercial -- --dir="${exportPath}"` : "npm.cmd run review:commercial"
    },
    referenceComparison: referenceInfo || { provided: false },
    mainMerge: {
      recommendation: aggregate.recommendation,
      reason: aggregate.recommendationReason,
      mainPush: false,
      mainMerge: false,
      pullRequestCreated: false
    }
  };
};

export const runAutoCommercialDiagnostics = async ({
  projectName = DEFAULT_PROJECT_NAME,
  branch = DEFAULT_PREVIEW_BRANCH,
  timeoutMs = 240_000,
  cases = DEFAULT_COMMERCIAL_CASES,
  exportResults = false,
  skipImages = false,
  seed = randomUUID().slice(0, 8),
  referenceDir = ""
} = {}) => {
  const auto = await discoverLatestPreviewDeployment({ projectName, branch });
  const diagnostics = await runCommercialDiagnostics({
    previewUrl: auto.deployment.Deployment,
    timeoutMs,
    cases,
    exportResults,
    skipImages,
    seed,
    referenceDir
  });
  return {
    ...auto,
    diagnostics
  };
};

export const formatCommercialSummary = ({
  projectName = DEFAULT_PROJECT_NAME,
  branch = DEFAULT_PREVIEW_BRANCH,
  source = "",
  deployment = {},
  diagnostics = {}
} = {}) =>
  [
    "=== Commercial Readiness Auto Discovery ===",
    `project: ${projectName}`,
    `branch: ${branch}`,
    `localSource: ${source || "unknown"}`,
    `deploymentSource: ${deployment.Source || "unknown"}`,
    `deploymentId: ${deployment.Id || "unknown"}`,
    `previewUrl: ${deployment.Deployment || diagnostics.previewUrl || "unknown"}`,
    "",
    "=== Commercial Readiness Diagnostics ===",
    JSON.stringify(diagnostics, null, 2)
  ].join("\n");

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const timeoutMs = parseTimeoutMs(args["timeout-ms"], 240_000);
  const cases = Math.max(1, Math.min(8, Number(args.cases || DEFAULT_COMMERCIAL_CASES) || DEFAULT_COMMERCIAL_CASES));
  const exportResults = Boolean(args.export);
  const skipImages = Boolean(args["skip-images"]);
  const seed = text(args.seed) || randomUUID().slice(0, 8);
  const referenceDir = text(args["reference-dir"]);

  if (args.auto) {
    const autoResult = await runAutoCommercialDiagnostics({
      projectName: args.project || DEFAULT_PROJECT_NAME,
      branch: args.branch || DEFAULT_PREVIEW_BRANCH,
      timeoutMs,
      cases,
      exportResults,
      skipImages,
      seed,
      referenceDir
    });
    console.log(formatCommercialSummary(autoResult));
    process.exitCode = autoResult.diagnostics.automaticResult === "PASS" ? 0 : 1;
    return;
  }

  const previewUrl = args.url || process.env.BLOG_PREVIEW_URL || "";
  const diagnostics = await runCommercialDiagnostics({
    previewUrl,
    timeoutMs,
    cases,
    exportResults,
    skipImages,
    seed,
    referenceDir
  });
  console.log(JSON.stringify(diagnostics, null, 2));
  process.exitCode = diagnostics.automaticResult === "PASS" ? 0 : 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    if ((error?.name === "AbortError" || error?.code === "ABORT_ERR") && error.requestUrl) {
      console.error(formatDiagnosticAbortError(error));
      process.exitCode = 1;
      return;
    }
    console.error(`commercial-diagnostic-error: ${error.message}`);
    process.exitCode = 1;
  });
}
