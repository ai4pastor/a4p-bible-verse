export const VERSIONS = ["새번역", "개역개정", "쉬운성경", "NIV", "KJV"] as const;
export type Version = (typeof VERSIONS)[number];

/** 삽입 형식 — 콜아웃 블록 vs 일반 텍스트(wikilink 유지) */
export type InsertFormat = "callout" | "text";

/** 파싱된 장절 참조. verseStart가 없으면 장 전체를 뜻한다. */
export interface BibleReference {
  /** 파일명 약자 (예: "요", "고전") */
  abbrev: string;
  /** 정식 책 이름 (예: "요한복음") */
  bookName: string;
  chapter: number;
  verseStart?: number;
  /** chapterEnd가 있으면 그 장의 절 번호, 없으면 chapter의 절 번호 */
  verseEnd?: number;
  /** 장 경계를 넘는 범위(요3:36-4:2)의 끝 장 */
  chapterEnd?: number;
}

export type ParseResult =
  | { ok: true; ref: BibleReference }
  | { ok: false; reason: string };

/** 볼트에서 읽어온 한 절의 데이터 */
export interface VerseData {
  /** 이 절이 속한 장 — 장 경계 범위 표시용 */
  chapter: number;
  verse: number;
  /** 노트 파일명(확장자 제외) — wikilink 대상 (예: "요3_16") */
  linkTarget: string;
  /** 볼트 내 전체 경로 (백링크 대조용) */
  path?: string;
  /** 역본별 본문. 노트에 해당 역본 콜아웃이 없으면 undefined */
  texts: Partial<Record<Version, string>>;
  /** frontmatter 관련구절의 링크 대상들 (예: ["롬5_8", "요일4_9"]) */
  related?: string[];
  /** frontmatter 평행본문의 링크 대상들 */
  parallel?: string[];
}
