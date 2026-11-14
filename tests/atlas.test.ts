import { describe, expect, it } from "vitest";
import { BOOKS, BOOK_BY_ABBREV } from "../src/books";
import {
  CHAPTER_COUNT,
  GENRES,
  agoLabel,
  aggregate,
  booksInGenre,
  buildSermons,
  canonIndex,
  departments,
  emptyBooksByGenre,
  filterSermons,
  formatDateKey,
  heatLevel,
  lastByGenre,
  parsePassageText,
  passageLabel,
  sermonsForBook,
  sinceKeyFor,
  summarize,
  verseFromName,
  type AtlasInputNote,
} from "../src/atlas";

const note = (
  basename: string,
  opts: Partial<Omit<AtlasInputNote, "basename">> = {},
): AtlasInputNote => ({
  path: opts.path ?? `300. Sermons/${opts.group ?? "기타"}/${basename}.md`,
  basename,
  group: opts.group,
  propertyVerses: opts.propertyVerses ?? [],
  linkedVerses: opts.linkedVerses ?? opts.propertyVerses ?? [],
});

const TODAY = { y: 2026, m: 11, d: 14 };

describe("정경 순서·장르", () => {
  it("신약 order가 1부터 다시 시작해도 정경 전체 순서는 1~66", () => {
    expect(canonIndex(BOOK_BY_ABBREV.get("창")!)).toBe(1);
    expect(canonIndex(BOOK_BY_ABBREV.get("말")!)).toBe(39);
    expect(canonIndex(BOOK_BY_ABBREV.get("마")!)).toBe(40);
    expect(canonIndex(BOOK_BY_ABBREV.get("계")!)).toBe(66);
  });

  it("장 수 표 — 66권 약자와 같고 합계 1,189장", () => {
    expect(Object.keys(CHAPTER_COUNT).sort()).toEqual(BOOKS.map((b) => b.abbrev).sort());
    expect(Object.values(CHAPTER_COUNT).reduce((a, b) => a + b, 0)).toBe(1189);
    expect(CHAPTER_COUNT["시"]).toBe(150);
  });

  it("장르 10묶음이 66권을 겹치지 않고 모두 담는다 — 구약 장르엔 구약 책만", () => {
    const seen = new Set<string>();
    for (const g of GENRES) {
      for (const b of booksInGenre(g)) {
        expect(b.testament).toBe(g.testament);
        expect(seen.has(b.abbrev)).toBe(false);
        seen.add(b.abbrev);
      }
    }
    expect(seen.size).toBe(66);
    expect(BOOKS.length).toBe(66);
    expect(booksInGenre(GENRES.find((g) => g.name === "소선지서")!).map((b) => b.abbrev)).toHaveLength(12);
    expect(booksInGenre(GENRES.find((g) => g.name === "사복음서")!).map((b) => b.abbrev)).toEqual([
      "마",
      "막",
      "눅",
      "요",
    ]);
  });
});

describe("이름 읽기", () => {
  it("절 노트 이름 — 66권 약자만, 자모가 분리된(NFD) 이름도", () => {
    expect(verseFromName("요3_16")).toEqual({ book: "요", chapter: 3, verse: 16 });
    expect(verseFromName("요3_16".normalize("NFD"))).toEqual({ book: "요", chapter: 3, verse: 16 });
    expect(verseFromName("요한3_16")).toBeNull();
    expect(verseFromName("2026-11-14")).toBeNull();
  });

  it("parseSermonName의 본문 표기를 구조로 되돌린다", () => {
    expect(parsePassageText("고후 8:9, 고전 15장")).toEqual([
      { book: "고후", chapter: 8, verseStart: 9, verseEnd: undefined },
      { book: "고전", chapter: 15, verseStart: undefined, verseEnd: undefined },
    ]);
    expect(parsePassageText("롬 8:33-39")[0]).toMatchObject({ book: "롬", chapter: 8, verseStart: 33, verseEnd: 39 });
    expect(parsePassageText("시 23편")[0]).toMatchObject({ book: "시", chapter: 23 });
    expect(passageLabel({ book: "시", chapter: 23 })).toBe("시 23편");
    expect(passageLabel({ book: "창", chapter: 1, verseStart: 1, verseEnd: 5 })).toBe("창 1:1-5");
  });
});

describe("buildSermons — 설교 한 편으로 묶기", () => {
  const notes = [
    note("260125_청_사도신경 강해10_죽으시고_고후8_9", {
      group: "청소년부",
      propertyVerses: ["고후8_9", "빌2_7"],
      linkedVerses: ["고후8_9", "빌2_7", "요1_14"],
    }),
    // 같은 날·같은 부서·같은 본문의 다른 판(꼬리표 hm)
    note("260125_청_사도신경 강해10_죽으시고_고후8_9_hm", { group: "청소년부" }),
    // 같은 날·같은 부서지만 본문이 다른 설교
    note("260125_청_저녁 설교_롬1_1", { group: "청소년부" }),
    // 이름에 본문이 없고 속성에만 — 속성 첫 절로 추정
    note("250216_어_예수님과 성전.", { group: "어린이부", propertyVerses: ["요2_16", "말3_1"] }),
    // 날짜도 본문도 없음
    note("고전 15장 강해설교", { group: "대예배" }),
    // 폴더 부서 없음 → 파일 이름의 부서 표시
    note("260201_청_빛과 소금_마5_13"),
    // 오늘 이후(미리 써 둔 원고)
    note("261129_어_홍해를 건너다_출14_13-14", { group: "어린이부" }),
  ];
  const sermons = buildSermons(notes);

  it("같은 날·같은 부서·같은 본문은 한 편, 본문이 다르면 따로", () => {
    expect(sermons).toHaveLength(6);
    const kang = sermons.find((s) => s.title.includes("사도신경"))!;
    expect(kang.paths).toHaveLength(2);
    expect(kang.paths[0]).toContain("고후8_9.md"); // 꼬리표 없는 판이 대표
    expect(sermons.find((s) => s.title.includes("저녁 설교"))!.main[0]).toMatchObject({ book: "롬", chapter: 1 });
  });

  it("주 본문은 이름 끝 — 없으면 속성 첫 절로 추정, 둘 다 없으면 본문 미상", () => {
    const kang = sermons.find((s) => s.title.includes("사도신경"))!;
    expect(kang.main).toEqual([{ book: "고후", chapter: 8, verseStart: 9, verseEnd: undefined }]);
    expect(kang.estimated).toBe(false);
    const temple = sermons.find((s) => s.title.includes("성전"))!;
    expect(temple.main).toEqual([{ book: "요", chapter: 2, verseStart: 16 }]);
    expect(temple.estimated).toBe(true);
    const nodate = sermons.find((s) => s.title.includes("강해설교"))!;
    expect(nodate.main).toEqual([]);
    expect(nodate.dateKey).toBe(0);
  });

  it("부서는 폴더 먼저, 없으면 파일 이름의 부서 표시", () => {
    expect(sermons.find((s) => s.title.includes("사도신경"))!.dept).toBe("청소년부");
    expect(sermons.find((s) => s.title.includes("빛과 소금"))!.dept).toBe("청");
  });

  it("인용은 주 본문 + 속성 + 본문 링크 — 판이 여러 개면 합친다", () => {
    const kang = sermons.find((s) => s.title.includes("사도신경"))!;
    expect(new Set(kang.citedBooks)).toEqual(new Set(["고후", "빌", "요"]));
    expect(kang.citedChapters).toContain("요|1");
  });

  it("파일 이름에 날짜가 없으면 속성 날짜로 보충", () => {
    const [s] = buildSermons([
      { ...note("부활 설교 원본_고전15_3-8", { group: "대예배" }), propertyDate: { y: 2024, m: 3, d: 31 } },
    ]);
    expect(s.dateKey).toBe(20240331);
    expect(s.main[0]).toMatchObject({ book: "고전", chapter: 15, verseStart: 3, verseEnd: 8 });
  });

  it("최신순 — 날짜 없는 설교는 맨 뒤", () => {
    expect(sermons[0].dateKey).toBe(20261129);
    expect(sermons[sermons.length - 1].dateKey).toBe(0);
  });

  it("집계 — 주 본문 기준과 인용 포함 기준", () => {
    const main = aggregate(sermons, "main");
    expect(main.books.get("고후")).toBe(1);
    expect(main.books.get("빌")).toBeUndefined();
    expect(main.chapters.get("출|14")).toBe(1);
    expect(main.last.get("출")).toBe(20261129);
    const all = aggregate(sermons, "all");
    expect(all.books.get("빌")).toBe(1);
    expect(all.books.get("말")).toBe(1); // 추정 설교의 속성 인용
    expect(sermonsForBook(sermons, "빌", "main")).toHaveLength(0);
    expect(sermonsForBook(sermons, "빌", "all")).toHaveLength(1);
  });

  it("거르기 — 부서·기간(날짜 없는 설교는 기간을 고르면 빠짐)", () => {
    expect(filterSermons(sermons, { mode: "main", dept: "어린이부" })).toHaveLength(2);
    const recent = filterSermons(sermons, { mode: "main", sinceKey: sinceKeyFor(1, TODAY) });
    expect(recent.every((s) => s.dateKey >= 20251114)).toBe(true);
    expect(recent.some((s) => s.dateKey === 0)).toBe(false);
    expect(sinceKeyFor(3, TODAY)).toBe(20231114);
  });

  it("부서 목록 — 많은 순(같으면 가나다순), 빈칸 부서 제외", () => {
    // 청소년부 2편(사도신경·저녁 설교) = 어린이부 2편 → 가나다순으로 어린이부가 앞
    expect(departments(sermons)).toEqual(["어린이부", "청소년부", "대예배", "청"]);
  });

  it("진단 — 비어 있는 책·장르별 마지막 설교·요약", () => {
    const agg = aggregate(sermons, "main");
    const empty = emptyBooksByGenre(agg);
    expect(empty.find((e) => e.genre.name === "소선지서")!.empty).toHaveLength(12);
    expect(empty.find((e) => e.genre.name === "바울서신")!.empty).toHaveLength(11); // 롬·고후만 있음
    const last = lastByGenre(agg);
    expect(last.find((l) => l.genre.name === "토라")!.last).toBe(20261129);
    expect(last.find((l) => l.genre.name === "소선지서")!.last).toBe(0);
    const sum = summarize(sermons, agg);
    expect(sum).toMatchObject({ sermons: 6, withMain: 5, unknown: 1 });
    expect(sum.otShare + sum.ntShare).toBe(100);
  });
});

describe("표시 도우미", () => {
  it("진하기 0~4 — 설교가 있으면 최소 1", () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 24)).toBe(1);
    expect(heatLevel(1, 10)).toBe(2);
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(3, 0)).toBe(4);
  });

  it("얼마나 지났는지 — 오늘 이후는 예정", () => {
    expect(agoLabel(0, TODAY)).toBe("없음");
    expect(agoLabel(20261129, TODAY)).toBe("예정");
    expect(agoLabel(20261101, TODAY)).toBe("이번 달");
    expect(agoLabel(20260614, TODAY)).toBe("5달 전");
    expect(agoLabel(20211219, TODAY)).toBe("4년 전");
    expect(formatDateKey(20260329)).toBe("2026.03.29");
    expect(formatDateKey(0)).toBe("날짜 없음");
  });
});
