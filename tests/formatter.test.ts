import { describe, expect, it } from "vitest";
import { formatPlainVerses, formatVerses, verseRuns } from "../src/formatter";
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

describe("formatVerses — 병렬 역본 (secondaryVersion)", () => {
  const dual = (n: number, ko: string, en: string): VerseData => ({
    verse: n,
    linkTarget: `요3_${n}`,
    texts: { 새번역: ko, NIV: en },
  });
  const dualOpts = { ...baseOpts, secondaryVersion: "NIV" as const };

  it("단일 절: 헤더에 두 역본, 본문 아래 이탤릭 병렬", () => {
    const out = formatVerses([dual(16, "하나님이 세상을", "For God so loved")], dualOpts);
    expect(out).toBe(
      "> [!quote] [[요3_16|요한복음 3:16]] (새번역 · NIV)\n" +
        "> 하나님이 세상을\n" +
        "> _For God so loved_\n",
    );
  });

  it("범위 병합: 절마다 한글 다음 줄에 영문 교차", () => {
    const out = formatVerses(
      [dual(16, "하나님이", "For God"), dual(17, "하나님께서", "For God did not")],
      dualOpts,
    );
    expect(out).toBe(
      "> [!quote] [[요3_16|요한복음 3:16-17]] (새번역 · NIV)\n" +
        "> [[요3_16|16]] 하나님이\n" +
        "> _For God_\n" +
        "> [[요3_17|17]] 하나님께서\n" +
        "> _For God did not_\n",
    );
  });

  it("병렬 역본 본문이 없는 절은 그 절만 이탤릭 생략", () => {
    const noEn: VerseData = { verse: 17, linkTarget: "요3_17", texts: { 새번역: "한글만" } };
    const out = formatVerses([dual(16, "하나님이", "For God"), noEn], dualOpts);
    expect(out).toContain("> [[요3_16|16]] 하나님이\n> _For God_\n");
    expect(out).toContain("> [[요3_17|17]] 한글만\n");
    expect(out.match(/_For God_/g)?.length).toBe(1);
  });

  it("병렬 역본의 여러 줄 본문은 한 줄로", () => {
    const out = formatVerses([dual(16, "한글", "line one\nline two")], dualOpts);
    expect(out).toContain("> _line one line two_\n");
  });

  it("secondaryVersion 없으면 기존 형식 그대로", () => {
    const out = formatVerses([verse(16, "본문")], baseOpts);
    expect(out).not.toContain("·");
    expect(out).not.toMatch(/^> _.*_$/m);
  });
});

describe("formatPlainVerses — 클립보드 복사용", () => {
  it("단일 절: 헤더 + 본문, 절 번호 없음, wikilink 없음", () => {
    const out = formatPlainVerses([verse(16, "하나님이 세상을")], baseOpts);
    expect(out).toBe("요한복음 3:16 (새번역)\n하나님이 세상을\n");
    expect(out).not.toContain("[[");
    expect(out).not.toContain(">");
  });

  it("범위: 절 번호 접두 + 여러 줄 본문 한 줄화", () => {
    const out = formatPlainVerses(
      [verse(16, "첫 줄\n둘째 줄"), verse(17, "나")],
      baseOpts,
    );
    expect(out).toBe("요한복음 3:16-17 (새번역)\n16 첫 줄 둘째 줄\n17 나\n");
  });

  it("장 전체는 편/장 표기", () => {
    const psalm = (n: number): VerseData => ({
      verse: n,
      linkTarget: `시23_${n}`,
      texts: { 새번역: `본문 ${n}` },
    });
    const out = formatPlainVerses([psalm(1), psalm(2)], {
      ...baseOpts,
      bookName: "시편",
      chapter: 23,
      wholeChapter: true,
    });
    expect(out.startsWith("시편 23편 (새번역)\n")).toBe(true);
  });

  it("병렬 역본은 이탤릭 마커 없이 다음 줄", () => {
    const dual: VerseData = {
      verse: 16,
      linkTarget: "요3_16",
      texts: { 새번역: "한글", NIV: "English" },
    };
    const out = formatPlainVerses([dual], { ...baseOpts, secondaryVersion: "NIV" });
    expect(out).toBe("요한복음 3:16 (새번역 · NIV)\n한글\nEnglish\n");
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
