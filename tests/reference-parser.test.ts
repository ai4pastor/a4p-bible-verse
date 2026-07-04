import { describe, expect, it } from "vitest";
import { parseReference, formatReference } from "../src/reference-parser";

function ok(input: string) {
  const r = parseReference(input);
  if (!r.ok) throw new Error(`파싱 실패: "${input}" → ${r.reason}`);
  return r.ref;
}

function fail(input: string) {
  const r = parseReference(input);
  expect(r.ok, `"${input}"는 실패해야 함`).toBe(false);
  return r.ok ? "" : r.reason;
}

describe("단일 절", () => {
  it("요3:16", () => {
    expect(ok("요3:16")).toMatchObject({
      abbrev: "요",
      bookName: "요한복음",
      chapter: 3,
      verseStart: 16,
      verseEnd: 16,
    });
  });
  it("요3_16 (파일명 형식)", () => {
    expect(ok("요3_16")).toMatchObject({ abbrev: "요", chapter: 3, verseStart: 16 });
  });
  it("요3장16절", () => {
    expect(ok("요3장16절")).toMatchObject({ chapter: 3, verseStart: 16 });
  });
  it("요한복음 3장 16절", () => {
    expect(ok("요한복음 3장 16절")).toMatchObject({ abbrev: "요", chapter: 3, verseStart: 16 });
  });
  it("요 3:16 (책과 장 사이 공백)", () => {
    expect(ok("요 3:16")).toMatchObject({ abbrev: "요", chapter: 3, verseStart: 16 });
  });
  it("시23:1", () => {
    expect(ok("시23:1")).toMatchObject({ abbrev: "시", bookName: "시편", chapter: 23, verseStart: 1 });
  });
  it("시편 23편 1절", () => {
    expect(ok("시편 23편 1절")).toMatchObject({ abbrev: "시", chapter: 23, verseStart: 1 });
  });
  it("고전13:4", () => {
    expect(ok("고전13:4")).toMatchObject({ abbrev: "고전", bookName: "고린도전서", chapter: 13, verseStart: 4 });
  });
  it("앞뒤 공백 허용", () => {
    expect(ok("  요3:16  ")).toMatchObject({ chapter: 3, verseStart: 16 });
  });
});

describe("절 범위", () => {
  it("요3:16-20", () => {
    expect(ok("요3:16-20")).toMatchObject({ verseStart: 16, verseEnd: 20 });
  });
  it("요3:16~20 (물결)", () => {
    expect(ok("요3:16~20")).toMatchObject({ verseStart: 16, verseEnd: 20 });
  });
  it("요3:16–20 (en dash)", () => {
    expect(ok("요3:16–20")).toMatchObject({ verseStart: 16, verseEnd: 20 });
  });
  it("요한복음 3장 16-20절", () => {
    expect(ok("요한복음 3장 16-20절")).toMatchObject({ chapter: 3, verseStart: 16, verseEnd: 20 });
  });
  it("요3_16-20", () => {
    expect(ok("요3_16-20")).toMatchObject({ verseStart: 16, verseEnd: 20 });
  });
});

describe("장 전체", () => {
  it("요3", () => {
    const ref = ok("요3");
    expect(ref).toMatchObject({ abbrev: "요", chapter: 3 });
    expect(ref.verseStart).toBeUndefined();
  });
  it("요3장", () => {
    expect(ok("요3장").verseStart).toBeUndefined();
  });
  it("시23편", () => {
    expect(ok("시23편")).toMatchObject({ abbrev: "시", chapter: 23 });
    expect(ok("시23편").verseStart).toBeUndefined();
  });
  it("요한복음 3장", () => {
    expect(ok("요한복음 3장").verseStart).toBeUndefined();
  });
});

describe("책 약자 최장 일치 (충돌 케이스)", () => {
  it("요일4:9 → 요한1서 (요+일로 쪼개지지 않음)", () => {
    expect(ok("요일4:9")).toMatchObject({ abbrev: "요일", bookName: "요한1서", chapter: 4, verseStart: 9 });
  });
  it("요이1:3 → 요한2서", () => {
    expect(ok("요이1:3")).toMatchObject({ abbrev: "요이" });
  });
  it("요삼1:2 → 요한3서", () => {
    expect(ok("요삼1:2")).toMatchObject({ abbrev: "요삼" });
  });
  it("요나3:1 → 요나 (욘)", () => {
    expect(ok("요나3:1")).toMatchObject({ abbrev: "욘", bookName: "요나" });
  });
  it("욘3:1 → 요나", () => {
    expect(ok("욘3:1")).toMatchObject({ abbrev: "욘" });
  });
  it("사사기2:1 → 사사기 (이사야 아님)", () => {
    expect(ok("사사기2:1")).toMatchObject({ abbrev: "삿", bookName: "사사기" });
  });
  it("사1:1 → 이사야", () => {
    expect(ok("사1:1")).toMatchObject({ abbrev: "사", bookName: "이사야" });
  });
  it("삼상17:45 → 사무엘상", () => {
    expect(ok("삼상17:45")).toMatchObject({ abbrev: "삼상" });
  });
  it("살전5:16 → 데살로니가전서", () => {
    expect(ok("살전5:16")).toMatchObject({ abbrev: "살전" });
  });
  it("아가1:2 → 아가", () => {
    expect(ok("아가1:2")).toMatchObject({ abbrev: "아", bookName: "아가" });
  });
  it("계시록1:1 → 요한계시록 (별칭)", () => {
    expect(ok("계시록1:1")).toMatchObject({ abbrev: "계", bookName: "요한계시록" });
  });
  it("요한일서4:9 → 요한1서 (별칭)", () => {
    expect(ok("요한일서4:9")).toMatchObject({ abbrev: "요일" });
  });
});

describe("오류 처리", () => {
  it("빈 입력", () => {
    fail("");
  });
  it("모르는 책 이름", () => {
    expect(fail("욮3:16")).toContain("책 이름");
  });
  it("장·절 없음", () => {
    expect(fail("요한복음")).toContain("장·절");
  });
  it("장 경계 범위 미지원", () => {
    expect(fail("요3:36-4:2")).toContain("장을 넘는 범위");
  });
  it("끝 절 < 시작 절", () => {
    expect(fail("요3:20-16")).toContain("앞설 수 없습니다");
  });
  it("절 시작 없이 범위", () => {
    fail("요3-4");
  });
  it("0절", () => {
    fail("요3:0");
  });
});

describe("formatReference", () => {
  it("단일 절", () => {
    expect(formatReference(ok("요3:16"))).toBe("요한복음 3:16");
  });
  it("범위", () => {
    expect(formatReference(ok("요3:16-20"))).toBe("요한복음 3:16-20");
  });
  it("장 전체 — 일반 책", () => {
    expect(formatReference(ok("요3장"))).toBe("요한복음 3장");
  });
  it("장 전체 — 시편은 편", () => {
    expect(formatReference(ok("시23편"))).toBe("시편 23편");
  });
});
