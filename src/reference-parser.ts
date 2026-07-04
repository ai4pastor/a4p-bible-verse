import { BOOK_BY_ABBREV, BOOK_TOKENS, BOOKS } from "./books";
import { BibleReference, ParseResult } from "./types";

/** 장·절 부분 문법: "3" / "3장" / "23편" / "3:16" / "3_16" / "3장 16절" / "3:16-20" */
const CHAPTER_VERSE_RE =
  /^(\d+)(?:\s*[장편:._]|\s)?\s*(\d+)?\s*절?\s*(?:[-~–—]\s*(\d+)\s*절?)?$/;

/** 장 경계를 넘는 범위: "3:36-4:2" 형태 감지용 */
const CROSS_CHAPTER_RE = /\d+\s*[장:._]\s*\d+\s*[-~–—]\s*\d+\s*[장:._]\s*\d+/;

/**
 * 참조 문자열을 파싱한다.
 * 지원: "요3:16", "요3_16", "요3장16절", "요한복음 3장 16절", "요3:16-20",
 *       "요3"/"요3장"/"시23편"(장 전체)
 */
export function parseReference(input: string): ParseResult {
  const query = input.trim();
  if (!query) return { ok: false, reason: "" };

  // 1) 책 토큰 최장 일치 (요일4:9가 요+일로 쪼개지지 않도록 길이 내림차순)
  const matched = BOOK_TOKENS.find(([token]) => query.startsWith(token));
  if (!matched) {
    const suggestion = suggestBook(query);
    return {
      ok: false,
      reason: suggestion
        ? `책 이름을 인식하지 못했습니다. 혹시 "${suggestion}"인가요?`
        : "책 이름을 인식하지 못했습니다 (예: 요3:16, 시23편)",
    };
  }
  const [token, book] = matched;

  // 2) 나머지에서 장·절 파싱
  const rest = query.slice(token.length).replace(/^[\s.]+/, "");
  if (!rest) {
    return { ok: false, reason: "장·절을 입력해주세요 (예: 요3:16, 시23편)" };
  }

  if (CROSS_CHAPTER_RE.test(rest)) {
    return {
      ok: false,
      reason: "장을 넘는 범위는 지원하지 않습니다. 장별로 나눠 삽입해주세요.",
    };
  }

  const m = rest.match(CHAPTER_VERSE_RE);
  if (!m) {
    return { ok: false, reason: `장·절 형식을 인식하지 못했습니다: "${rest}"` };
  }

  const chapter = parseInt(m[1], 10);
  const verseStart = m[2] ? parseInt(m[2], 10) : undefined;
  const verseEnd = m[3] ? parseInt(m[3], 10) : undefined;

  if (verseEnd !== undefined && verseStart === undefined) {
    return { ok: false, reason: "범위는 절 단위로만 지원합니다 (예: 요3:16-20)" };
  }
  if (verseStart !== undefined && verseEnd !== undefined && verseEnd < verseStart) {
    return { ok: false, reason: "끝 절이 시작 절보다 앞설 수 없습니다" };
  }
  if (chapter < 1 || (verseStart !== undefined && verseStart < 1)) {
    return { ok: false, reason: "장·절은 1 이상이어야 합니다" };
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

/** 표시용 정규화 문자열: "요한복음 3:16-20" / "시편 23편" */
export function formatReference(ref: {
  bookName: string;
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
}): string {
  const unit = ref.bookName === "시편" ? "편" : "장";
  if (ref.verseStart === undefined) return `${ref.bookName} ${ref.chapter}${unit}`;
  if (ref.verseEnd === undefined || ref.verseEnd === ref.verseStart) {
    return `${ref.bookName} ${ref.chapter}:${ref.verseStart}`;
  }
  return `${ref.bookName} ${ref.chapter}:${ref.verseStart}-${ref.verseEnd}`;
}
