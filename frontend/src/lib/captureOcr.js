const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const createResult = (overrides = {}) => ({
  ok: false,
  provider: "none",
  text: "",
  confidence: 0,
  warnings: [],
  message: "",
  ...overrides
});

const normalizeOcrText = (value = "") =>
  String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const fallbackImageTextExtractor = {
  id: "manual-fallback",
  name: "Manual fallback",
  async extract() {
    return createResult({
      provider: this.id,
      warnings: [
        "이미지에서 댓글을 자동으로 읽지 못했습니다. 오른쪽 텍스트 영역에 댓글을 붙여넣거나 직접 수정해주세요."
      ],
      message: "사용 가능한 OCR 엔진이 없어 수동 보정 모드로 전환했습니다."
    });
  }
};

const tesseractImageTextExtractor = {
  id: "tesseract-js",
  name: "Tesseract.js OCR",
  async extract(file, options = {}) {
    try {
      const { recognize } = await import("tesseract.js");
      const result = await recognize(file, options.lang || "kor+eng", {
        logger: options.logger
      });
      const text = normalizeOcrText(result?.data?.text || "");
      const confidence = Number(result?.data?.confidence || 0) / 100;

      if (!text) {
        return createResult({
          provider: this.id,
          confidence,
          warnings: [
            "이미지에서 댓글을 자동으로 읽지 못했습니다. 오른쪽 텍스트 영역에 댓글을 붙여넣거나 직접 수정해주세요."
          ],
          message: "OCR은 실행됐지만 읽을 수 있는 텍스트를 찾지 못했습니다."
        });
      }

      return createResult({
        ok: true,
        provider: this.id,
        text,
        confidence,
        warnings:
          confidence > 0 && confidence < 0.62
            ? ["OCR 신뢰도가 낮습니다. 추출 결과를 꼭 확인하고 수정해주세요."]
            : [],
        message: `${file?.name || "캡처 이미지"}에서 텍스트를 추출했습니다.`
      });
    } catch (error) {
      return createResult({
        provider: this.id,
        warnings: [
          "이미지에서 댓글을 자동으로 읽지 못했습니다. 오른쪽 텍스트 영역에 댓글을 붙여넣거나 직접 수정해주세요.",
          error.message
        ],
        message: "OCR 엔진 실행에 실패했습니다."
      });
    }
  }
};

export const captureOcrAdapters = [tesseractImageTextExtractor, fallbackImageTextExtractor];

export async function extractCaptureTextFromImage(file, options = {}) {
  const adapters = options.adapter ? [options.adapter] : captureOcrAdapters;

  if (!file) {
    return createResult({
      message: "이미지 파일이 선택되지 않았습니다."
    });
  }

  if (!SUPPORTED_IMAGE_TYPES.has(String(file.type || "").toLowerCase())) {
    return createResult({
      warnings: ["PNG, JPG, WEBP 형식의 이미지 파일만 사용할 수 있습니다."],
      message: "지원하지 않는 파일 형식입니다."
    });
  }

  for (const adapter of adapters) {
    const result = await adapter.extract(file, options);
    if (result.ok || adapter.id === fallbackImageTextExtractor.id) return result;
  }

  return fallbackImageTextExtractor.extract(file, options);
}
