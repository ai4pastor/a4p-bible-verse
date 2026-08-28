import { describe, expect, it } from "vitest";
import {
  bookFolderMissingReason,
  buildCommentaryIndex,
  isUnderFolder,
  matchBookFolders,
  normalizeFolderPath,
  parseCommentaryFileName,
} from "../src/paths";
import { BOOKS, bookByFolderName } from "../src/books";

describe("normalizeFolderPath", () => {
  it("앞뒤 공백과 슬래시를 제거한다", () => {
    expect(normalizeFolderPath("  /100. notes/170. 성경/  ")).toBe("100. notes/170. 성경");
    expect(normalizeFolderPath("성경/")).toBe("성경");
    expect(normalizeFolderPath("/성경")).toBe("성경");
  });

  it("역슬래시와 연속 슬래시를 정리한다", () => {
    expect(normalizeFolderPath("100. notes\\170. 성경")).toBe("100. notes/170. 성경");
    expect(normalizeFolderPath("100. notes//170. 성경")).toBe("100. notes/170. 성경");
  });

  it('"./" 접두를 제거한다', () => {
    expect(normalizeFolderPath("./성경")).toBe("성경");
    expect(normalizeFolderPath("././성경")).toBe("성경");
  });

  it("빈 입력은 빈 문자열", () => {
    expect(normalizeFolderPath("")).toBe("");
    expect(normalizeFolderPath("   ")).toBe("");
    expect(normalizeFolderPath("/")).toBe("");
  });
});

describe("isUnderFolder", () => {
  it("자기 자신과 하위 경로를 매칭한다", () => {
    expect(isUnderFolder("성경/구약/01.창세기/창1_1.md", "성경")).toBe(true);
    expect(isUnderFolder("성경", "성경")).toBe(true);
  });

  it('형제 폴더("300. Sermons2")를 매칭하지 않는다', () => {
    expect(isUnderFolder("300. Sermons2/note.md", "300. Sermons")).toBe(false);
  });

  it("folder가 빈 값이면 false", () => {
    expect(isUnderFolder("아무거나.md", "")).toBe(false);
  });
});

describe("parseCommentaryFileName", () => {
  it("표준 파일명을 파싱한다", () => {
    expect(parseCommentaryFileName("로마서 5장 통합주석.md")).toEqual({
      bookName: "로마서",
      chapter: 5,
    });
    expect(parseCommentaryFileName("요한1서 3장 통합주석.md")).toEqual({
      bookName: "요한1서",
      chapter: 3,
    });
  });

  it("형식이 다르면 null", () => {
    expect(parseCommentaryFileName("로마서 5장.md")).toBeNull();
    expect(parseCommentaryFileName("로마서 통합주석.md")).toBeNull();
    expect(parseCommentaryFileName("일반노트.md")).toBeNull();
  });
});

describe("bookByFolderName", () => {
  it("NFD(자모 분리) 폴더명도 인식한다", () => {
    expect(bookByFolderName("04.요한복음".normalize("NFD"))?.abbrev).toBe("요");
    expect(bookByFolderName("요한복음".normalize("NFD"))?.abbrev).toBe("요");
    expect(bookByFolderName("계시록".normalize("NFD"))?.abbrev).toBe("계");
  });
});

describe("matchBookFolders", () => {
  it("NN접두 유무·별칭 폴더명을 모두 매칭한다", () => {
    const { byAbbrev, duplicates } = matchBookFolders([
      { path: "성경/구약/01.창세기", name: "01.창세기" },
      { path: "성경/구약/19. 시편", name: "19. 시편" },
      { path: "성경/신약/요한일서", name: "요한일서" },
      { path: "성경/기타", name: "기타" },
    ]);
    expect(byAbbrev.get("창")).toBe("성경/구약/01.창세기");
    expect(byAbbrev.get("시")).toBe("성경/구약/19. 시편");
    expect(byAbbrev.get("요일")).toBe("성경/신약/요한일서");
    expect(byAbbrev.size).toBe(3);
    expect(duplicates).toEqual([]);
  });

  it("중복 매칭은 첫 폴더를 유지하고 duplicates에 기록한다", () => {
    const { byAbbrev, duplicates } = matchBookFolders([
      { path: "성경/구약/01.창세기", name: "01.창세기" },
      { path: "백업/창세기", name: "창세기" },
    ]);
    expect(byAbbrev.get("창")).toBe("성경/구약/01.창세기");
    expect(duplicates).toEqual(["창세기"]);
  });

  it("66권 전수 매칭", () => {
    const folders = BOOKS.map((b) => ({
      path: `성경/${b.testament}/${String(b.order).padStart(2, "0")}.${b.name}`,
      name: `${String(b.order).padStart(2, "0")}.${b.name}`,
    }));
    const { byAbbrev, duplicates } = matchBookFolders(folders);
    expect(byAbbrev.size).toBe(66);
    expect(duplicates).toEqual([]);
  });
});

describe("buildCommentaryIndex", () => {
  it("구약/신약 층이 있는 배치를 인식한다", () => {
    const index = buildCommentaryIndex([
      { path: "주석/신약/06.로마서/로마서 5장 통합주석.md", name: "로마서 5장 통합주석.md" },
      { path: "주석/구약/01.창세기/창세기 1장 통합주석.md", name: "창세기 1장 통합주석.md" },
    ]);
    expect(index.get("로마서|5")).toBe("주석/신약/06.로마서/로마서 5장 통합주석.md");
    expect(index.get("창세기|1")).toBe("주석/구약/01.창세기/창세기 1장 통합주석.md");
  });

  it("평면 배치·혼합 배치도 파일명만으로 인식한다", () => {
    const index = buildCommentaryIndex([
      { path: "주석/요한복음 3장 통합주석.md", name: "요한복음 3장 통합주석.md" },
      { path: "주석/깊은/폴더/시편 23장 통합주석.md", name: "시편 23장 통합주석.md" },
      { path: "주석/기타노트.md", name: "기타노트.md" },
    ]);
    expect(index.get("요한복음|3")).toBe("주석/요한복음 3장 통합주석.md");
    expect(index.get("시편|23")).toBe("주석/깊은/폴더/시편 23장 통합주석.md");
    expect(index.size).toBe(2);
  });

  it("별칭 책이름을 정식명 키로 정규화한다", () => {
    const index = buildCommentaryIndex([
      { path: "주석/요한일서 1장 통합주석.md", name: "요한일서 1장 통합주석.md" },
      { path: "주석/계시록 1장 통합주석.md", name: "계시록 1장 통합주석.md" },
    ]);
    expect(index.get("요한1서|1")).toBe("주석/요한일서 1장 통합주석.md");
    expect(index.get("요한계시록|1")).toBe("주석/계시록 1장 통합주석.md");
  });

  it("성경 책이 아닌 이름은 무시한다", () => {
    const index = buildCommentaryIndex([
      { path: "주석/도마복음 1장 통합주석.md", name: "도마복음 1장 통합주석.md" },
    ]);
    expect(index.size).toBe(0);
  });
});

describe("bookFolderMissingReason", () => {
  const abbrevsOf = (testament: "구약" | "신약") =>
    new Set(BOOKS.filter((b) => b.testament === testament).map((b) => b.abbrev));
  const FALLBACK_창 = "볼트에서 창세기 폴더를 찾지 못했습니다.";

  it("신약만 등록된 볼트에서 구약 구절 → 구약 미등록 안내", () => {
    const reason = bookFolderMissingReason("창", "창세기", {
      cachedAbbrevs: abbrevsOf("신약"),
      otPathSet: false,
      ntPathSet: true,
    });
    expect(reason).toBe(
      "구약 성경 폴더가 등록되어 있지 않습니다. 설정 → A4P 성경구절에서 구약 성경 폴더를 선택해주세요.",
    );
  });

  it("구약만 등록된 볼트에서 신약 구절 → 신약 미등록 안내", () => {
    const reason = bookFolderMissingReason("요", "요한복음", {
      cachedAbbrevs: abbrevsOf("구약"),
      otPathSet: true,
      ntPathSet: false,
    });
    expect(reason).toBe(
      "신약 성경 폴더가 등록되어 있지 않습니다. 설정 → A4P 성경구절에서 신약 성경 폴더를 선택해주세요.",
    );
  });

  it("오탐 방지 — 경로가 빈 값이어도 그 testament 책이 캐시에 있으면 일반 문구", () => {
    // otPath 하나에 구약·신약이 다 들어 있는 배치: ntPathSet=false지만 신약 책이 잡혀 있음
    const cached = new Set([...abbrevsOf("구약"), "요", "마"]);
    const reason = bookFolderMissingReason("계", "요한계시록", {
      cachedAbbrevs: cached,
      otPathSet: true,
      ntPathSet: false,
    });
    expect(reason).toBe("볼트에서 요한계시록 폴더를 찾지 못했습니다.");
  });

  it("경로가 설정돼 있으면 책 폴더 누락이어도 일반 문구", () => {
    const reason = bookFolderMissingReason("창", "창세기", {
      cachedAbbrevs: abbrevsOf("신약"),
      otPathSet: true,
      ntPathSet: true,
    });
    expect(reason).toBe(FALLBACK_창);
  });

  it("미지의 약자는 일반 문구로 폴백", () => {
    const reason = bookFolderMissingReason("없음", "없는책", {
      cachedAbbrevs: new Set<string>(),
      otPathSet: false,
      ntPathSet: true,
    });
    expect(reason).toBe("볼트에서 없는책 폴더를 찾지 못했습니다.");
  });
});
