import { describe, expect, it } from "vitest";
import { formatPlainVerses, formatVerses, verseRuns } from "../src/formatter";
import { VerseData } from "../src/types";

const verse = (n: number, text: string): VerseData => ({
  chapter: 3,
  verse: n,
  linkTarget: `요3_${n}`,
  texts: { 새번역: text, 개역개정: `개역 ${n}` },
});

const baseOpts = {
  bookName: "요한복음",
  chapter: 3,
  version: "새번역" as const,
  wholeChapter: false,
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
      chapter: 23,
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
    chapter: 3,
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
    const noEn: VerseData = { chapter: 3, verse: 17, linkTarget: "요3_17", texts: { 새번역: "한글만" } };
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
      chapter: 23,
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
      chapter: 3,
      verse: 16,
      linkTarget: "요3_16",
      texts: { 새번역: "한글", NIV: "English" },
    };
    const out = formatPlainVerses([dual], { ...baseOpts, secondaryVersion: "NIV" });
    expect(out).toBe("요한복음 3:16 (새번역 · NIV)\n한글\nEnglish\n");
  });
});

describe("formatVerses — 장 경계 범위", () => {
  const cross = (ch: number, v: number, text: string): VerseData => ({
    chapter: ch,
    verse: v,
    linkTarget: `요${ch}_${v}`,
    texts: { 새번역: text },
  });

  it("헤더는 장:절-장:절, 절 번호는 장:절 표기", () => {
    const out = formatVerses(
      [cross(3, 36, "가"), cross(4, 1, "나"), cross(4, 2, "다")],
      baseOpts,
    );
    expect(out).toBe(
      "> [!quote] [[요3_36|요한복음 3:36-4:2]] (새번역)\n" +
        "> [[요3_36|3:36]] 가\n" +
        "> [[요4_1|4:1]] 나\n" +
        "> [[요4_2|4:2]] 다\n",
    );
  });

  it("플레인 복사도 장:절 표기", () => {
    const out = formatPlainVerses([cross(3, 36, "가"), cross(4, 1, "나")], baseOpts);
    expect(out).toBe("요한복음 3:36-4:1 (새번역)\n3:36 가\n4:1 나\n");
  });
});

describe("formatVerses — 일반 텍스트 (format=text)", () => {
  const textOpts = { ...baseOpts, format: "text" as const };

  it("단일 절 — 콜아웃 없이 wikilink 헤더 + 본문", () => {
    const out = formatVerses([verse(16, "하나님이 세상을")], textOpts);
    expect(out).toBe("[[요3_16|요한복음 3:16]] (새번역)\n하나님이 세상을\n");
  });

  it("단일 절 여러 줄 본문 유지", () => {
    const out = formatVerses([verse(16, "첫 줄\n둘째 줄")], textOpts);
    expect(out).toBe("[[요3_16|요한복음 3:16]] (새번역)\n첫 줄\n둘째 줄\n");
  });

  it("범위 병합 — 헤더 + 절별 wikilink 번호", () => {
    const out = formatVerses([verse(16, "가"), verse(17, "나")], textOpts);
    expect(out).toBe(
      "[[요3_16|요한복음 3:16-17]] (새번역)\n" +
        "[[요3_16|16]] 가\n" +
        "[[요3_17|17]] 나\n",
    );
  });

  it("병렬 역본은 이탤릭 줄로 따라감", () => {
    const dual: VerseData = {
      chapter: 3,
      verse: 16,
      linkTarget: "요3_16",
      texts: { 새번역: "하나님이 세상을", NIV: "For God so loved" },
    };
    const out = formatVerses([dual], { ...textOpts, secondaryVersion: "NIV" });
    expect(out).toBe(
      "[[요3_16|요한복음 3:16]] (새번역 · NIV)\n" +
        "하나님이 세상을\n" +
        "_For God so loved_\n",
    );
  });

  it("장 경계 범위는 절 번호를 장:절로 표기", () => {
    const cross = (ch: number, v: number, text: string): VerseData => ({
      chapter: ch,
      verse: v,
      linkTarget: `요${ch}_${v}`,
      texts: { 새번역: text },
    });
    const out = formatVerses([cross(3, 36, "가"), cross(4, 1, "나")], textOpts);
    expect(out).toBe(
      "[[요3_36|요한복음 3:36-4:1]] (새번역)\n" +
        "[[요3_36|3:36]] 가\n" +
        "[[요4_1|4:1]] 나\n",
    );
  });

  it("format 미지정은 기존 콜아웃 그대로", () => {
    const out = formatVerses([verse(16, "가")], baseOpts);
    expect(out.startsWith("> [!quote]")).toBe(true);
  });
});

describe("formatVerses — 절 이어붙임 (verseNewline=false)", () => {
  it("텍스트 모드 — 헤더 다음 한 문단으로 이어 붙임", () => {
    const out = formatVerses([verse(16, "가"), verse(17, "나"), verse(18, "다")], {
      ...baseOpts,
      format: "text" as const,
      verseNewline: false,
    });
    expect(out).toBe(
      "[[요3_16|요한복음 3:16-18]] (새번역)\n" +
        "[[요3_16|16]] 가 [[요3_17|17]] 나 [[요3_18|18]] 다\n",
    );
  });

  it("콜아웃 모드 — 콜아웃 안에서 한 줄로 이어 붙임", () => {
    const out = formatVerses([verse(16, "가"), verse(17, "나")], {
      ...baseOpts,
      verseNewline: false,
    });
    expect(out).toBe(
      "> [!quote] [[요3_16|요한복음 3:16-17]] (새번역)\n" +
        "> [[요3_16|16]] 가 [[요3_17|17]] 나\n",
    );
  });

  it("여러 줄 본문은 한 줄로 눌러서 이어 붙임", () => {
    const out = formatVerses([verse(16, "첫 줄\n둘째 줄"), verse(17, "나")], {
      ...baseOpts,
      format: "text" as const,
      verseNewline: false,
    });
    expect(out).toBe(
      "[[요3_16|요한복음 3:16-17]] (새번역)\n" +
        "[[요3_16|16]] 첫 줄 둘째 줄 [[요3_17|17]] 나\n",
    );
  });

  it("병렬 역본은 각 절 뒤에 이탤릭으로 이어짐", () => {
    const dual = (n: number, ko: string, en: string): VerseData => ({
      chapter: 3,
      verse: n,
      linkTarget: `요3_${n}`,
      texts: { 새번역: ko, NIV: en },
    });
    const out = formatVerses([dual(16, "한글16", "En16"), dual(17, "한글17", "En17")], {
      ...baseOpts,
      secondaryVersion: "NIV" as const,
      verseNewline: false,
    });
    expect(out).toBe(
      "> [!quote] [[요3_16|요한복음 3:16-17]] (새번역 · NIV)\n" +
        "> [[요3_16|16]] 한글16 _En16_ [[요3_17|17]] 한글17 _En17_\n",
    );
  });

  it("단일 절에는 영향 없음", () => {
    const out = formatVerses([verse(16, "가")], {
      ...baseOpts,
      format: "text" as const,
      verseNewline: false,
    });
    expect(out).toBe("[[요3_16|요한복음 3:16]] (새번역)\n가\n");
  });

  it("verseNewline 미지정은 기존 절별 줄바꿈 그대로", () => {
    const out = formatVerses([verse(16, "가"), verse(17, "나")], baseOpts);
    expect(out).toBe(
      "> [!quote] [[요3_16|요한복음 3:16-17]] (새번역)\n" +
        "> [[요3_16|16]] 가\n> [[요3_17|17]] 나\n",
    );
  });
});
