import { describe, expect, it } from "vitest";
import {
  bigramOverlap,
  normalizeText,
  searchVerses,
  tokenize,
} from "../src/search";
import { IndexEntry, Version } from "../src/types";

/** 합성 테스트용 엔트리 (실제 역본 텍스트 아님 — 저작권 없는 가짜 문장) */
function entry(
  sortKey: number,
  linkTarget: string,
  texts: Partial<Record<Version, string>>,
): IndexEntry {
  const m = linkTarget.match(/^([가-힣]+)(\d+)_(\d+)$/)!;
  return {
    abbrev: m[1],
    bookName: m[1],
    sortKey,
    chapter: parseInt(m[2], 10),
    verse: parseInt(m[3], 10),
    linkTarget,
    path: `성경/${linkTarget}.md`,
    texts,
  };
}

// 정경 순으로 정렬된 상태를 흉내낸 코퍼스
const ENTRIES: IndexEntry[] = [
  entry(1_001_001, "창1_1", {
    새번역: "태초에 하나님이 하늘과 땅을 만드셨다",
    NIV: "In the beginning God created the heavens and the earth",
  }),
  entry(19_023_001, "시23_1", {
    새번역: "주님은 나의 목자시니 부족함이 없다",
  }),
  entry(43_003_016, "요3_16", {
    새번역: "하나님이 세상을 이처럼 사랑하셔서 외아들을 주셨다",
    NIV: "For God so loved the world that he gave his one and only Son",
  }),
  entry(43_003_017, "요3_17", {
    새번역: "세상을 심판하려는 것이 아니라 구원하려는 것이다",
  }),
  entry(62_004_008, "요일4_8", {
    새번역: "사랑하지 않는 사람은 하나님을 알지 못한다 하나님은 사랑이시다",
  }),
];

const OPTS = { versions: ["새번역"] as Version[] };

describe("tokenize / normalizeText", () => {
  it("공백 분리와 빈 토큰 제거", () => {
    expect(tokenize("  사랑   은혜  ")).toEqual(["사랑", "은혜"]);
  });
  it("영문 소문자화", () => {
    expect(tokenize("God LOVED")).toEqual(["god", "loved"]);
  });
  it("NFC 정규화 (자모 분해형 입력)", () => {
    expect(tokenize("사랑")).toEqual(["사랑"]);
  });
  it("normalizeText: 개행·연속 공백 → 공백 하나", () => {
    expect(normalizeText("하늘과\n  땅을")).toBe("하늘과 땅을");
  });
});

describe("Tier 1 — exact (전 토큰 AND)", () => {
  it("단일 토큰: 조사·활용이 붙은 형태도 substring으로 매칭", () => {
    const { hits } = searchVerses(ENTRIES, "사랑", OPTS);
    expect(hits.map((h) => h.entry.linkTarget)).toEqual(["요3_16", "요일4_8"]);
    expect(hits.every((h) => h.tier === "exact")).toBe(true);
  });
  it("다중 토큰 AND: 둘 다 있는 절만 exact", () => {
    const { hits } = searchVerses(ENTRIES, "하나님 사랑", OPTS);
    const exact = hits.filter((h) => h.tier === "exact");
    expect(exact.map((h) => h.entry.linkTarget)).toEqual(["요3_16", "요일4_8"]);
    // "하나님"만 있는 창1_1은 partial로 exact 뒤에 온다
    const partial = hits.filter((h) => h.tier === "partial");
    expect(partial.map((h) => h.entry.linkTarget)).toEqual(["창1_1"]);
  });
  it("정경 순(sortKey) 정렬: 구약이 신약보다 앞", () => {
    const { hits } = searchVerses(ENTRIES, "하나님", OPTS);
    const keys = hits.map((h) => h.entry.sortKey);
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
    expect(hits[0].entry.linkTarget).toBe("창1_1");
  });
  it("영어 대소문자 무시", () => {
    const { hits } = searchVerses(ENTRIES, "GOD loved", { versions: ["NIV"] });
    const exact = hits.filter((h) => h.tier === "exact");
    expect(exact.map((h) => h.entry.linkTarget)).toEqual(["요3_16"]);
  });
  it("limit 절단 시에도 exactTotal은 전체 수", () => {
    const { hits, exactTotal } = searchVerses(ENTRIES, "하나님", {
      ...OPTS,
      limit: 2,
    });
    expect(hits.length).toBe(2);
    expect(exactTotal).toBe(3);
  });
  it("matchedRanges가 실제 매칭 위치를 가리킴", () => {
    const { hits } = searchVerses(ENTRIES, "사랑", OPTS);
    const hit = hits.find((h) => h.entry.linkTarget === "요3_16")!;
    const text = hit.entry.texts["새번역"]!;
    for (const [s, e] of hit.matchedRanges) {
      expect(text.slice(s, e)).toBe("사랑");
    }
  });
  it("같은 토큰 다회 등장 시 범위 병합·정렬", () => {
    const { hits } = searchVerses(ENTRIES, "하나님", OPTS);
    const hit = hits.find((h) => h.entry.linkTarget === "요일4_8")!;
    expect(hit.matchedRanges.length).toBe(2);
    expect(hit.matchedRanges[0][0]).toBeLessThan(hit.matchedRanges[1][0]);
  });
});

describe("Tier 2 — partial (관련성 순)", () => {
  it("일부 토큰만 매칭된 절이 exact 뒤에 옴", () => {
    const { hits } = searchVerses(ENTRIES, "세상 심판", OPTS);
    // exact: 요3_17(세상+심판), partial: 요3_16(세상만)
    expect(hits[0].entry.linkTarget).toBe("요3_17");
    expect(hits[0].tier).toBe("exact");
    expect(hits[1].entry.linkTarget).toBe("요3_16");
    expect(hits[1].tier).toBe("partial");
  });
  it("매칭 토큰 수가 많은 절이 먼저", () => {
    const extra = [
      ...ENTRIES,
      entry(66_001_001, "계1_1", { 새번역: "목자" }),
      entry(66_001_002, "계1_2", { 새번역: "목자 부족함" }),
    ];
    const { hits } = searchVerses(extra, "목자 부족함 없다", OPTS);
    const partials = hits.filter((h) => h.tier === "partial");
    expect(partials[0].entry.linkTarget).toBe("계1_2"); // 2토큰 > 1토큰
    expect(partials[1].entry.linkTarget).toBe("계1_1");
  });
  it("단일 토큰 질의에는 partial이 없다", () => {
    const { hits } = searchVerses(ENTRIES, "외아들", OPTS);
    expect(hits.every((h) => h.tier === "exact")).toBe(true);
  });
});

describe("Tier 3 — fuzzy (bigram 포함률)", () => {
  it("bigramOverlap: 동일 문자열 = 1, 무관 = 0", () => {
    expect(bigramOverlap("사랑", "사랑")).toBe(1);
    expect(bigramOverlap("사랑", "심판")).toBe(0);
  });
  it("bigramOverlap: 근사 문자열은 부분 점수", () => {
    // "사랑하시" bigram = {사랑, 랑하, 하시}; "사랑하셔서" 안에 {사랑, 랑하} 존재
    const score = bigramOverlap("사랑하시", "하나님이 세상을 이처럼 사랑하셔서");
    expect(score).toBeCloseTo(2 / 3);
  });
  it("exact·partial 0건일 때만 fuzzy 발동", () => {
    const { hits } = searchVerses(ENTRIES, "사랑하시니", OPTS);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.tier === "fuzzy")).toBe(true);
    expect(hits.map((h) => h.entry.linkTarget)).toContain("요3_16");
  });
  it("포함률이 임계 미만이면 결과 없음", () => {
    const { hits } = searchVerses(ENTRIES, "전혀무관한질의어", OPTS);
    expect(hits).toEqual([]);
  });
});

describe("역본 범위", () => {
  it("현재 역본에 없는 본문은 매칭 안 됨", () => {
    const { hits } = searchVerses(ENTRIES, "목자", { versions: ["NIV"] });
    expect(hits).toEqual([]);
  });
  it("여러 역본 검색 시 매칭 역본이 SearchHit.version에 담김", () => {
    const { hits } = searchVerses(ENTRIES, "loved", {
      versions: ["새번역", "NIV"],
    });
    expect(hits.length).toBe(1);
    expect(hits[0].version).toBe("NIV");
  });
  it("빈 질의·빈 역본 배열은 빈 결과", () => {
    expect(searchVerses(ENTRIES, "   ", OPTS).hits).toEqual([]);
    expect(searchVerses(ENTRIES, "사랑", { versions: [] }).hits).toEqual([]);
  });
});
