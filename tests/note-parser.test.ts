import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractHeadingSection,
  extractVerseTexts,
  stripAnnotations,
} from "../src/note-parser";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "fixtures", name), "utf-8");

describe("extractVerseTexts — 실제 볼트 노트", () => {
  it("요3_16.md: 5개 역본 전부 추출", () => {
    const texts = extractVerseTexts(fixture("요3_16.md"));
    expect(Object.keys(texts).sort()).toEqual(
      ["KJV", "NIV", "개역개정", "새번역", "쉬운성경"].sort(),
    );
    expect(texts["새번역"]).toContain("하나님이 세상을 이처럼 사랑하셔서");
    expect(texts["KJV"]).toContain("For God so loved the world");
  });

  it("시23_1.md: 소제목이 섞인 본문도 추출", () => {
    const texts = extractVerseTexts(fixture("시23_1.md"));
    expect(texts["새번역"]).toBeTruthy();
    expect(texts["개역개정"]).toBeTruthy();
  });

  it("창1_1.md: 보강 섹션(원어 핵심어 등)이 있어도 본문만 추출", () => {
    const texts = extractVerseTexts(fixture("창1_1.md"));
    expect(Object.keys(texts).length).toBe(5);
    expect(texts["개역개정"]).toContain("태초에 하나님이 천지를 창조하시니라");
    // 본문 섹션 밖의 텍스트가 섞여 들어오지 않아야 함
    for (const text of Object.values(texts)) {
      expect(text).not.toContain("##");
      expect(text).not.toContain("관련구절");
    }
  });
});

describe("stripAnnotations — 각주·소제목 정리", () => {
  it("소제목 <...> 제거", () => {
    expect(stripAnnotations("<다윗의 노래> 주는 나의 목자시니")).toBe("주는 나의 목자시니");
  });
  it("각주 마커 a) 제거", () => {
    expect(stripAnnotations("영생을 얻게 하려는 것이다. g) 본문")).toBe(
      "영생을 얻게 하려는 것이다. 본문",
    );
  });
  it("각주 본문 (a. ...) 제거", () => {
    expect(stripAnnotations("끝이다. (g. 해석자에 따라 15절에서 인용을 끝내기도 함)")).toBe(
      "끝이다.",
    );
  });
  it("일반 영문 본문은 훼손하지 않음", () => {
    const kjv = "For God so loved the world, that he gave his only begotten Son";
    expect(stripAnnotations(kjv)).toBe(kjv);
  });
  it("복합 케이스", () => {
    expect(stripAnnotations("<천지창조> a) 태초에 (a. 또는 창조하실 때에) 하나님이")).toBe(
      "태초에 하나님이",
    );
  });
});

describe("extractHeadingSection — 미리보기용 섹션 슬라이스", () => {
  const md = `# 제목

## 3:1-8 - 니고데모
내용 A
### 소스별 핵심
내용 A2

## 3:14-17 - 하나님의 사랑
내용 B

## 3:18-21 - 빛과 어두움
내용 C
`;

  it("헤딩부터 다음 같은 레벨 헤딩 전까지", () => {
    const out = extractHeadingSection(md, "3:14-17 - 하나님의 사랑");
    expect(out).toContain("내용 B");
    expect(out).not.toContain("내용 A");
    expect(out).not.toContain("내용 C");
  });

  it("하위 헤딩(###)은 섹션에 포함", () => {
    const out = extractHeadingSection(md, "3:1-8 - 니고데모");
    expect(out).toContain("내용 A2");
    expect(out).not.toContain("내용 B");
  });

  it("마지막 섹션은 끝까지", () => {
    const out = extractHeadingSection(md, "3:18-21 - 빛과 어두움");
    expect(out).toContain("내용 C");
  });

  it("헤딩을 못 찾으면 전체 반환", () => {
    expect(extractHeadingSection(md, "없는 헤딩")).toBe(md);
  });
});

describe("extractVerseTexts — 엣지 케이스", () => {
  it("본문 섹션이 없으면 빈 객체", () => {
    expect(extractVerseTexts("# 제목\n\n내용")).toEqual({});
  });

  it("역본 일부 누락 시 있는 것만", () => {
    const content = `## 📜 본문

> [!quote] 새번역
> 본문입니다.

> [!quote] NIV
> The text.
`;
    const texts = extractVerseTexts(content);
    expect(texts["새번역"]).toBe("본문입니다.");
    expect(texts["NIV"]).toBe("The text.");
    expect(texts["개역개정"]).toBeUndefined();
  });

  it("여러 줄 콜아웃은 개행 유지로 수집", () => {
    const content = `## 📜 본문

> [!quote] 새번역
> 첫 줄
> 둘째 줄
`;
    expect(extractVerseTexts(content)["새번역"]).toBe("첫 줄\n둘째 줄");
  });

  it("알 수 없는 콜아웃 라벨은 무시", () => {
    const content = `## 📜 본문

> [!quote] 개역한글
> 무시되어야 함

> [!quote] 새번역
> 유효한 본문
`;
    const texts = extractVerseTexts(content);
    expect(texts["새번역"]).toBe("유효한 본문");
    expect(Object.keys(texts).length).toBe(1);
  });

  it("다음 헤딩 이후 콜아웃은 무시", () => {
    const content = `## 📜 본문

> [!quote] 새번역
> 본문

## 🔗 관련구절

> [!quote] NIV
> 이건 본문 아님
`;
    const texts = extractVerseTexts(content);
    expect(texts["새번역"]).toBe("본문");
    expect(texts["NIV"]).toBeUndefined();
  });
});
