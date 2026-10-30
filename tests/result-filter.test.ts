import { describe, expect, it } from "vitest";
import { BOOK_BY_ABBREV } from "../src/books";
import {
  NO_FILTER,
  ResultFilter,
  applyFilter,
  collapseChips,
  facetCounts,
  isFiltered,
  selectBook,
  selectChapter,
  selectTestament,
} from "../src/result-filter";
import { SearchHit } from "../src/search";

/** 합성 검색 결과 (실제 역본 텍스트 아님) — sortKey는 verse-index makeSortKey와 같은 규칙 */
function hit(linkTarget: string, tier: SearchHit["tier"]): SearchHit {
  const m = linkTarget.match(/^([가-힣]+)(\d+)_(\d+)$/)!;
  const book = BOOK_BY_ABBREV.get(m[1])!;
  const order = book.testament === "신약" ? book.order + 39 : book.order;
  const chapter = parseInt(m[2], 10);
  const verse = parseInt(m[3], 10);
  return {
    entry: {
      abbrev: book.abbrev,
      bookName: book.name,
      sortKey: order * 1_000_000 + chapter * 1_000 + verse,
      chapter,
      verse,
      linkTarget,
      path: `성경/${linkTarget}.md`,
      texts: { 새번역: "가짜 문장" },
    },
    version: "새번역",
    score: 1,
    tier,
    matchedRanges: [],
  };
}

// searchVerses의 출력 모양: 완전 일치(정경 순) 뒤에 유사(관련성 순 — 정경 순 아님)
const HITS: SearchHit[] = [
  hit("시23_1", "exact"),
  hit("롬8_10", "exact"),
  hit("고전1_4", "exact"),
  hit("고전15_10", "exact"),
  hit("고전15_22", "exact"),
  hit("갈2_20", "exact"),
  hit("골2_11", "partial"),
  hit("엡2_6", "partial"),
  hit("고전1_5", "partial"),
  hit("왕상6_19", "partial"),
  hit("요14_25", "partial"),
  hit("갈5_6", "partial"),
];

const links = (hits: SearchHit[]) => hits.map((h) => h.entry.linkTarget);
const f = (patch: Partial<ResultFilter>): ResultFilter => ({ ...NO_FILTER, ...patch });

describe("applyFilter", () => {
  it("필터가 없으면 전부, 원래 순서 그대로 (새 배열)", () => {
    const out = applyFilter(HITS, NO_FILTER);
    expect(links(out)).toEqual(links(HITS));
    expect(out).not.toBe(HITS);
  });

  it("범위 — 완전 일치 → 유사 순서를 유지", () => {
    expect(links(applyFilter(HITS, f({ testament: "구약" })))).toEqual(["시23_1", "왕상6_19"]);
    expect(applyFilter(HITS, f({ testament: "신약" })).length).toBe(10);
  });

  it("권 · 권+장", () => {
    expect(links(applyFilter(HITS, f({ book: "고전" })))).toEqual([
      "고전1_4",
      "고전15_10",
      "고전15_22",
      "고전1_5",
    ]);
    expect(links(applyFilter(HITS, f({ book: "고전", chapter: 15 })))).toEqual([
      "고전15_10",
      "고전15_22",
    ]);
  });

  it("권 없이 남은 장 값은 무시", () => {
    expect(applyFilter(HITS, f({ chapter: 15 })).length).toBe(HITS.length);
  });

  it("모든 단어만 = 완전 일치만", () => {
    expect(applyFilter(HITS, f({ exactOnly: true })).every((h) => h.tier === "exact")).toBe(true);
    expect(links(applyFilter(HITS, f({ book: "갈", exactOnly: true })))).toEqual(["갈2_20"]);
  });
});

describe("facetCounts", () => {
  it("필터 없음 — 범위·권(정경 순)·완전 일치 수", () => {
    const facets = facetCounts(HITS, NO_FILTER);
    expect(facets.total).toBe(12);
    expect(facets.testaments).toEqual({ 구약: 2, 신약: 10 });
    // 유사 결과가 관련성 순으로 섞여 있어도 권은 정경 순
    expect(facets.books.map((b) => `${b.name} ${b.count}`)).toEqual([
      "열왕기상 1",
      "시편 1",
      "요한복음 1",
      "로마서 1",
      "고린도전서 4",
      "갈라디아서 2",
      "에베소서 1",
      "골로새서 1",
    ]);
    expect(facets.chapters).toEqual([]); // 권을 골라야 장이 나온다
    expect(facets.exact).toBe(6);
    expect(facets.mixedTiers).toBe(true);
  });

  it("범위 칩은 자기 차원을 빼고 센다 — 신약을 골라도 구약 숫자는 그대로", () => {
    const facets = facetCounts(HITS, f({ testament: "신약" }));
    expect(facets.testaments).toEqual({ 구약: 2, 신약: 10 });
    expect(facets.books.map((b) => b.abbrev)).toEqual(["요", "롬", "고전", "갈", "엡", "골"]);
    expect(facets.books.reduce((n, b) => n + b.count, 0)).toBe(10);
    expect(facets.exact).toBe(5);
  });

  it("권 칩은 권·장 선택을 빼고, 장 칩은 장 선택을 빼고 센다", () => {
    const facets = facetCounts(HITS, f({ book: "고전", chapter: 15 }));
    expect(facets.books.length).toBe(8);
    expect(facets.books.find((b) => b.abbrev === "고전")!.count).toBe(4);
    expect(facets.chapters).toEqual([
      { chapter: 1, count: 2 },
      { chapter: 15, count: 2 },
    ]);
    expect(facets.exact).toBe(2); // 고전 15장의 완전 일치
  });

  it("모든 단어만 — 범위·권·장 숫자가 완전 일치 기준으로", () => {
    const facets = facetCounts(HITS, f({ exactOnly: true, book: "고전" }));
    expect(facets.total).toBe(6);
    expect(facets.testaments).toEqual({ 구약: 1, 신약: 5 });
    expect(facets.books.map((b) => `${b.abbrev} ${b.count}`)).toEqual([
      "시 1",
      "롬 1",
      "고전 3",
      "갈 1",
    ]);
    expect(facets.chapters).toEqual([
      { chapter: 1, count: 1 },
      { chapter: 15, count: 2 },
    ]);
    expect(facets.exact).toBe(3);
  });

  it("고른 권·장이 결과에 없어도(역본 전환) 0으로 남아 풀 수 있다", () => {
    const facets = facetCounts(HITS, f({ book: "요일", chapter: 4 }));
    const last = facets.books[facets.books.length - 1];
    expect(last).toEqual({ abbrev: "요일", name: "요한1서", count: 0 }); // 정경 순 자리(골로새서 뒤)
    expect(facets.chapters).toEqual([{ chapter: 4, count: 0 }]);
    expect(facets.exact).toBe(0);
  });

  it("단일 단어·오타 보정 결과에는 모든 단어만 칩이 없다", () => {
    expect(facetCounts(HITS.slice(0, 6), NO_FILTER).mixedTiers).toBe(false);
    const fuzzy = [hit("시23_1", "fuzzy"), hit("요3_16", "fuzzy")];
    const facets = facetCounts(fuzzy, NO_FILTER);
    expect(facets.mixedTiers).toBe(false);
    expect(facets.total).toBe(2);
    expect(facets.exact).toBe(0);
  });

  it("한쪽 성경만 등록한 볼트 — 반대쪽 범위는 0", () => {
    const otOnly = [hit("창1_1", "exact"), hit("시23_1", "exact")];
    expect(facetCounts(otOnly, NO_FILTER).testaments).toEqual({ 구약: 2, 신약: 0 });
  });

  it("빈 결과", () => {
    const facets = facetCounts([], NO_FILTER);
    expect(facets.total).toBe(0);
    expect(facets.books).toEqual([]);
  });

  it("입력 배열을 바꾸지 않는다", () => {
    const before = links(HITS);
    facetCounts(HITS, f({ book: "고전" }));
    applyFilter(HITS, f({ testament: "구약" }));
    expect(links(HITS)).toEqual(before);
  });
});

describe("칩 전이", () => {
  it("범위를 반대쪽으로 바꾸면 그 범위 밖의 권·장은 풀린다", () => {
    const cor = f({ book: "고전", chapter: 15 });
    expect(selectTestament(cor, "구약")).toEqual(f({ testament: "구약" }));
    expect(selectTestament(cor, "신약")).toEqual(f({ testament: "신약", book: "고전", chapter: 15 }));
    expect(selectTestament(cor, null)).toEqual(cor);
  });

  it("같은 범위를 다시 누르면 전체", () => {
    expect(selectTestament(f({ testament: "구약" }), "구약").testament).toBeNull();
  });

  it("권 — 같은 권을 다시 누르면 해제, 장 선택은 늘 풀림", () => {
    const cor = selectBook(NO_FILTER, "고전");
    expect(cor).toEqual(f({ book: "고전" }));
    expect(selectBook(f({ book: "고전", chapter: 15 }), "갈")).toEqual(f({ book: "갈" }));
    expect(selectBook(cor, "고전").book).toBeNull();
    expect(selectBook(f({ book: "고전", chapter: 15 }), null)).toEqual(NO_FILTER);
  });

  it("장 — 같은 장을 다시 누르면 해제, 권 없이는 못 고름", () => {
    const cor = f({ book: "고전" });
    expect(selectChapter(cor, 15).chapter).toBe(15);
    expect(selectChapter(f({ book: "고전", chapter: 15 }), 15).chapter).toBeNull();
    expect(selectChapter(f({ book: "고전", chapter: 15 }), null).chapter).toBeNull();
    expect(selectChapter(NO_FILTER, 3)).toEqual(NO_FILTER);
  });

  it("전이는 늘 새 객체 — 원래 필터를 바꾸지 않는다", () => {
    const base = f({ book: "고전" });
    selectChapter(base, 15);
    selectTestament(base, "구약");
    expect(base).toEqual(f({ book: "고전" }));
  });

  it("isFiltered", () => {
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered(f({ testament: "신약" }))).toBe(true);
    expect(isFiltered(f({ book: "롬" }))).toBe(true);
    expect(isFiltered(f({ exactOnly: true }))).toBe(true);
  });
});

describe("collapseChips", () => {
  const items = [
    { key: "a", count: 5 },
    { key: "b", count: 1 },
    { key: "c", count: 3 },
    { key: "d", count: 1 },
    { key: "e", count: 4 },
  ];
  const keys = (xs: { key: string }[]) => xs.map((x) => x.key).join("");

  it("한도 이하면 전부", () => {
    expect(keys(collapseChips(items, 5))).toBe("abcde");
  });

  it("많은 것부터 고르되 원래 순서 유지", () => {
    expect(keys(collapseChips(items, 3))).toBe("ace");
  });

  it("같은 수면 앞의 것", () => {
    expect(keys(collapseChips(items, 4))).toBe("abce");
  });

  it("고른 칩은 한도 밖이어도 넣는다", () => {
    expect(keys(collapseChips(items, 3, (x) => x.key === "d"))).toBe("acde");
  });
});
