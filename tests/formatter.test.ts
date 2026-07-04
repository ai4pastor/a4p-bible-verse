import { describe, expect, it } from "vitest";
import { formatVerses, verseRuns } from "../src/formatter";
import { VerseData } from "../src/types";

const verse = (n: number, text: string): VerseData => ({
  verse: n,
  linkTarget: `요3_${n}`,
  texts: { 새번역: text, 개역개정: `개역 ${n}` },
});

const baseOpts = {
  bookName: "요한복음",
  chapter: 3,
  version: "새번역" as const,
  wholeChapter: false,
  merge: true,
};

describe("verseRuns", () => {
  it("연속 구간 병합", () => {
    expect(verseRuns([16, 17, 18, 20])).toBe("16-18, 20");
  });
  it("단일", () => {
    expect(verseRuns([16])).toBe("16");
  });
  it("모두 불연속", () => {
    expect(verseRuns([1, 3, 5])).toBe("1, 3, 5");
  });
});

describe("formatVerses — 단일 절", () => {
  it("확정 스펙 형식", () => {
    const out = formatVerses([verse(16, "하나님이 세상을 이처럼 사랑하셔서")], baseOpts);
    expect(out).toBe(
      "> [!quote] [[요3_16|요한복음 3:16]] (새번역)\n> 하나님이 세상을 이처럼 사랑하셔서\n",
    );
  });
  it("여러 줄 본문은 줄마다 인용", () => {
    const out = formatVerses([verse(16, "첫 줄\n둘째 줄")], baseOpts);
    expect(out).toContain("> 첫 줄\n> 둘째 줄");
  });
});

describe("formatVerses — 범위 병합", () => {
  it("헤더는 첫 절 링크 + 범위 표기, 절마다 개별 링크", () => {
    const out = formatVerses([verse(16, "가"), verse(17, "나"), verse(18, "다")], baseOpts);
    expect(out).toBe(
      "> [!quote] [[요3_16|요한복음 3:16-18]] (새번역)\n" +
        "> [[요3_16|16]] 가\n" +
        "> [[요3_17|17]] 나\n" +
        "> [[요3_18|18]] 다\n",
    );
  });
  it("불연속 선택은 콤마 표기", () => {
    const out = formatVerses([verse(16, "가"), verse(18, "다"), verse(19, "라")], baseOpts);
    expect(out).toContain("[[요3_16|요한복음 3:16, 18-19]]");
  });
  it("여러 줄 본문은 한 줄로 정리", () => {
    const out = formatVerses([verse(16, "첫 줄\n둘째 줄"), verse(17, "나")], baseOpts);
    expect(out).toContain("> [[요3_16|16]] 첫 줄 둘째 줄\n");
  });
  it("장 전체는 편/장 표기", () => {
    const psalm = (n: number): VerseData => ({
      verse: n,
      linkTarget: `시23_${n}`,
      texts: { 새번역: `본문 ${n}` },
    });
    const out = formatVerses([psalm(1), psalm(2)], {
      ...baseOpts,
      bookName: "시편",
      chapter: 23,
      wholeChapter: true,
    });
    expect(out).toContain("[[시23_1|시편 23편]] (새번역)");
  });
});

describe("formatVerses — 절별 콜아웃 (merge=false)", () => {
  it("절마다 독립 콜아웃", () => {
    const out = formatVerses([verse(16, "가"), verse(17, "나")], {
      ...baseOpts,
      merge: false,
    });
    expect(out).toBe(
      "> [!quote] [[요3_16|요한복음 3:16]] (새번역)\n> 가\n" +
        "\n" +
        "> [!quote] [[요3_17|요한복음 3:17]] (새번역)\n> 나\n",
    );
  });
});
