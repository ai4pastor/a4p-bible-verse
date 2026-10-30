import { BOOK_BY_ABBREV } from "./books";
import type { SearchHit } from "./search";

/**
 * 본문 키워드 검색 결과 필터 — obsidian 미의존 순수 모듈.
 *
 * 이미 찾은 결과(완전 일치 전부 + 유사 상위 N절)를 범위(구약·신약) › 권 › 장으로 좁혀 볼 뿐
 * 다시 검색하지 않는다 — 칩의 숫자와 그 칩을 눌렀을 때 나오는 줄 수가 늘 같아야 하기 때문.
 * (범위마다 다시 검색하면 유사 결과 상한이 범위마다 새로 채워져 모든 권 칩이 "+50" 안팎이 된다)
 */

export type Testament = "구약" | "신약";

export interface ResultFilter {
  /** null = 구약·신약 전체 */
  testament: Testament | null;
  /** 책 약자 (예: "고전"). null = 모든 권 */
  book: string | null;
  /** 권을 골랐을 때만 의미가 있다. null = 모든 장 */
  chapter: number | null;
  /** 검색어의 모든 단어가 들어 있는 절(exact)만 */
  exactOnly: boolean;
}

export const NO_FILTER: ResultFilter = {
  testament: null,
  book: null,
  chapter: null,
  exactOnly: false,
};

export interface BookFacet {
  abbrev: string;
  name: string;
  count: number;
}

export interface ChapterFacet {
  chapter: number;
  count: number;
}

/** 칩 숫자 — 각 칩은 자기 차원만 빼고 나머지 필터를 반영해 센다 */
export interface Facets {
  /** 「모든 단어만」을 반영한 전체 수 (범위 [전체] 칩) */
  total: number;
  /** 「모든 단어만」만 반영 */
  testaments: Record<Testament, number>;
  /** 범위·「모든 단어만」 반영, 정경 순. 0건인 권은 빠지되 고른 권은 0이어도 남는다 */
  books: BookFacet[];
  /** 권을 골랐을 때만 — 그 권과 「모든 단어만」 반영, 장 순. 고른 장은 0이어도 남는다 */
  chapters: ChapterFacet[];
  /** 범위·권·장 안의 완전 일치 수 (「모든 단어만」 칩) */
  exact: number;
  /** 결과 전체에 완전 일치와 유사가 함께 있는가 — 「모든 단어만」 칩을 보여 줄 조건 */
  mixedTiers: boolean;
}

/** 권의 정경 순서 1~66 — IndexEntry.sortKey의 권 자리 (verse-index makeSortKey) */
function canonOrder(hit: SearchHit): number {
  return Math.floor(hit.entry.sortKey / 1_000_000);
}

function testamentOf(hit: SearchHit): Testament {
  return (
    BOOK_BY_ABBREV.get(hit.entry.abbrev)?.testament ?? (canonOrder(hit) > 39 ? "신약" : "구약")
  );
}

/** 범위·권·장·「모든 단어만」 중 하나라도 걸려 있는가 */
export function isFiltered(f: ResultFilter): boolean {
  return f.testament !== null || f.book !== null || f.exactOnly;
}

/** 필터를 통과한 결과 — 원래 순서(완전 일치 정경 순 → 유사 관련성 순)를 그대로 둔다 */
export function applyFilter(hits: readonly SearchHit[], f: ResultFilter): SearchHit[] {
  if (!isFiltered(f)) return hits.slice();
  return hits.filter(
    (hit) =>
      (!f.exactOnly || hit.tier === "exact") &&
      (!f.testament || testamentOf(hit) === f.testament) &&
      (!f.book || hit.entry.abbrev === f.book) &&
      (!f.book || f.chapter === null || hit.entry.chapter === f.chapter),
  );
}

export function facetCounts(hits: readonly SearchHit[], f: ResultFilter): Facets {
  const testaments: Record<Testament, number> = { 구약: 0, 신약: 0 };
  const books = new Map<string, BookFacet & { order: number }>();
  const chapters = new Map<number, number>();
  let total = 0;
  let exact = 0;
  let anyExact = false;
  let anyPartial = false;

  for (const hit of hits) {
    if (hit.tier === "exact") anyExact = true;
    else if (hit.tier === "partial") anyPartial = true;

    const testament = testamentOf(hit);
    const tierOk = !f.exactOnly || hit.tier === "exact";
    const testamentOk = !f.testament || testament === f.testament;
    const bookOk = !f.book || hit.entry.abbrev === f.book;
    const chapterOk = !f.book || f.chapter === null || hit.entry.chapter === f.chapter;

    if (tierOk) {
      total++;
      testaments[testament]++;
    }
    if (tierOk && testamentOk) {
      const { abbrev, bookName } = hit.entry;
      const book = books.get(abbrev);
      if (book) book.count++;
      else books.set(abbrev, { abbrev, name: bookName, count: 1, order: canonOrder(hit) });
    }
    if (f.book && tierOk && bookOk) {
      chapters.set(hit.entry.chapter, (chapters.get(hit.entry.chapter) ?? 0) + 1);
    }
    if (hit.tier === "exact" && testamentOk && bookOk && chapterOk) exact++;
  }

  // 고른 권·장이 이 결과에 없더라도(역본 전환 등) 칩은 남겨야 풀 수 있다
  if (f.book && !books.has(f.book)) {
    const info = BOOK_BY_ABBREV.get(f.book);
    const order = info ? (info.testament === "신약" ? info.order + 39 : info.order) : 0;
    books.set(f.book, { abbrev: f.book, name: info?.name ?? f.book, count: 0, order });
  }
  if (f.book && f.chapter !== null && !chapters.has(f.chapter)) chapters.set(f.chapter, 0);

  return {
    total,
    testaments,
    books: Array.from(books.values())
      .sort((a, b) => a.order - b.order)
      .map(({ abbrev, name, count }) => ({ abbrev, name, count })),
    chapters: Array.from(chapters, ([chapter, count]) => ({ chapter, count })).sort(
      (a, b) => a.chapter - b.chapter,
    ),
    exact,
    mixedTiers: anyExact && anyPartial,
  };
}

/** 범위 칩 — 같은 범위를 다시 누르면 전체. 다른 범위로 가면 그 범위 밖의 권·장 선택은 풀린다 */
export function selectTestament(f: ResultFilter, testament: Testament | null): ResultFilter {
  const next = f.testament === testament ? null : testament;
  const keepBook =
    f.book !== null && (next === null || BOOK_BY_ABBREV.get(f.book)?.testament === next);
  return {
    ...f,
    testament: next,
    book: keepBook ? f.book : null,
    chapter: keepBook ? f.chapter : null,
  };
}

/** 권 칩 — 같은 권을 다시 누르면 모든 권. 장 선택은 늘 풀린다 */
export function selectBook(f: ResultFilter, book: string | null): ResultFilter {
  return { ...f, book: f.book === book ? null : book, chapter: null };
}

/** 장 칩 — 같은 장을 다시 누르면 모든 장. 권 없이 장만 고를 수는 없다 */
export function selectChapter(f: ResultFilter, chapter: number | null): ResultFilter {
  if (!f.book) return f;
  return { ...f, chapter: f.chapter === chapter ? null : chapter };
}

/**
 * 칩이 limit개를 넘을 때 접힌 상태에서 보일 칩 — 결과가 많은 것부터 limit개를 고르되
 * 원래 순서(정경·장 순)는 그대로 두고, 고른 칩(isKept)은 늘 넣는다. limit 이하면 전부.
 */
export function collapseChips<T extends { count: number }>(
  items: readonly T[],
  limit: number,
  isKept: (item: T) => boolean = () => false,
): T[] {
  if (items.length <= limit) return items.slice();
  const chosen = new Set(
    items
      .map((item, i) => ({ count: item.count, i }))
      .sort((a, b) => b.count - a.count || a.i - b.i)
      .slice(0, limit)
      .map((r) => r.i),
  );
  return items.filter((item, i) => chosen.has(i) || isKept(item));
}
