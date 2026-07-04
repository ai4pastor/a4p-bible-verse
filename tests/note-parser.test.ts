import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractVerseTexts } from "../src/note-parser";

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
