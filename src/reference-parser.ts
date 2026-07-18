import { BOOK_BY_ABBREV, BOOK_TOKENS, BOOKS } from "./books";
import { BibleReference, ParseResult } from "./types";

/** 장·절 부분 문법: "3" / "3장" / "23편" / "3:16" / "3_16" / "3장 16절" / "3:16-20" */
const CHAPTER_VERSE_RE =
  /^(\d+)(?:\s*[장편:._]|\s)?\s*(\d+)?\s*절?\s*(?:[-~–—]\s*(\d+)\s*절?)?$/;

/** 장 경계를 넘는 범위: "3:36-4:2", "3장 36절-4장 2절" */
const CROSS_CHAPTER_RE =
  /^(\d+)\s*[장:._]\s*(\d+)\s*절?\s*[-~–—]\s*(\d+)\s*[장:._]\s*(\d+)\s*절?$/;

/**
 * 참조 문자열을 파싱한다.
 * 지원: "요3:16", "요3_16", "요3장16절", "요한복음 3장 16절", "요3:16-20",
 *       "요3"/"요3장"/"시23편"(장 전체)
 */
export function parseReference(input: string): ParseResult {
  const query = input.trim();
  if (!query) return { ok: false, reason: "", kind: "reference" };

  // 1) 책 토큰 최장 일치 (요일4:9가 요+일로 쪼개지지 않도록 길이 내림차순)
  const matched = BOOK_TOKENS.find(([token]) => query.startsWith(token));
  if (!matched) {
    const suggestion = suggestBook(query);
    return {
      ok: false,
      reason: suggestion
        ? `책 이름을 인식하지 못했습니다. 혹시 "${suggestion}"인가요?`
        : "책 이름을 인식하지 못했습니다 (예: 요3:16, 시23편)",
      kind: "unrecognized",
    };
  }
  const [token, book] = matched;

  // 2) 나머지에서 장·절 파싱
  const rest = query.slice(token.length).replace(/^[\s.]+/, "");
  if (!rest) {
    return { ok: false, reason: "장·절을 입력해주세요 (예: 요3:16, 시23편)", kind: "reference" };
  }

  const cross = rest.match(CROSS_CHAPTER_RE);
  if (cross) {
    const chapter = parseInt(cross[1], 10);
    const verseStart = parseInt(cross[2], 10);
    const chapterEnd = parseInt(cross[3], 10);
    const verseEnd = parseInt(cross[4], 10);
    if (chapterEnd < chapter) {
      return { ok: false, reason: "끝 장이 시작 장보다 앞설 수 없습니다", kind: "reference" };
    }
    if (chapterEnd === chapter) {
      if (verseEnd < verseStart) {
        return { ok: false, reason: "끝 절이 시작 절보다 앞설 수 없습니다", kind: "reference" };
      }
      return {
        ok: true,
        ref: { abbrev: book.abbrev, bookName: book.name, chapter, verseStart, verseEnd },
      };
    }
    if (chapter < 1 || verseStart < 1 || verseEnd < 1) {
      return { ok: false, reason: "장·절은 1 이상이어야 합니다", kind: "reference" };
    }
    return {
      ok: true,
      ref: {
        abbrev: book.abbrev,
        bookName: book.name,
        chapter,
        verseStart,
        chapterEnd,
        verseEnd,
      },
    };
  }

  const m = rest.match(CHAPTER_VERSE_RE);
  if (!m) {
    // "사랑"처럼 단일 글자 약자("사"=이사야) 뒤에 일반 단어가 이어진 경우는
    // 참조가 아니라 키워드 질의다 — 남은 문자열에 문자가 있으면 unrecognized.
    return {
      ok: false,
      reason: `장·절 형식을 인식하지 못했습니다: "${rest}"`,
      kind: /[가-힣a-zA-Z]/.test(rest) ? "unrecognized" : "reference",
    };
  }

  const chapter = parseInt(m[1], 10);
  const verseStart = m[2] ? parseInt(m[2], 10) : undefined;
  const verseEnd = m[3] ? parseInt(m[3], 10) : undefined;

  if (verseEnd !== undefined && verseStart === undefined) {
    return { ok: false, reason: "범위는 절 단위로만 지원합니다 (예: 요3:16-20)", kind: "reference" };
  }
  if (verseStart !== undefined && verseEnd !== undefined && verseEnd < verseStart) {
    return { ok: false, reason: "끝 절이 시작 절보다 앞설 수 없습니다", kind: "reference" };
  }
  if (chapter < 1 || (verseStart !== undefined && verseStart < 1)) {
    return { ok: false, reason: "장·절은 1 이상이어야 합니다", kind: "reference" };
  }

  return {
    ok: true,
    ref: {
      abbrev: book.abbrev,
      bookName: book.name,
      chapter,
      verseStart,
      verseEnd: verseEnd ?? verseStart,
    },
  };
}

/** 오타 입력에 대해 앞글자가 겹치는 책 이름 후보 제안 */
function suggestBook(query: string): string | undefined {
  const head = query.slice(0, 2);
  if (!/[가-힣]/.test(head[0] ?? "")) return undefined;
  const hit = BOOKS.find(
    (b) => b.name.startsWith(head[0]) || b.abbrev.startsWith(head[0]),
  );
  return hit?.name;
}

/** 구절 노트 파일명("롬5_8")을 참조로 변환. 관련구절 칩 표시용. */
export function parseLinkTarget(target: string): BibleReference | null {
  const m = target.trim().match(/^([가-힣]+)(\d+)_(\d+)$/);
  if (!m) return null;
  const book = BOOK_BY_ABBREV.get(m[1]);
  if (!book) return null;
  const verse = parseInt(m[3], 10);
  return {
    abbrev: book.abbrev,
    bookName: book.name,
    chapter: parseInt(m[2], 10),
    verseStart: verse,
    verseEnd: verse,
  };
}

/** 표시용 정규화 문자열: "요한복음 3:16-20" / "시편 23편" / "요한복음 3:36-4:2" */
export function formatReference(ref: {
  bookName: string;
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
  chapterEnd?: number;
}): string {
  const unit = ref.bookName === "시편" ? "편" : "장";
  if (ref.chapterEnd !== undefined && ref.chapterEnd !== ref.chapter) {
    return `${ref.bookName} ${ref.chapter}:${ref.verseStart}-${ref.chapterEnd}:${ref.verseEnd}`;
  }
  if (ref.verseStart === undefined) return `${ref.bookName} ${ref.chapter}${unit}`;
  if (ref.verseEnd === undefined || ref.verseEnd === ref.verseStart) {
    return `${ref.bookName} ${ref.chapter}:${ref.verseStart}`;
  }
  return `${ref.bookName} ${ref.chapter}:${ref.verseStart}-${ref.verseEnd}`;
}
