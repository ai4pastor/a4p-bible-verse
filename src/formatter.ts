import { InsertFormat, Version, VerseData } from "./types";

export interface FormatOptions {
  bookName: string;
  chapter: number;
  version: Version;
  /** 병렬 삽입 시 두 번째 역본 — 각 절의 본문 아래 이탤릭으로 따라감 */
  secondaryVersion?: Version;
  /** 장 전체 요청 + 전체 선택이면 헤더를 "시편 23편" 형태로 */
  wholeChapter: boolean;
  /** "callout"(기본): 인용 콜아웃, "text": 일반 텍스트(wikilink 유지) */
  format?: InsertFormat;
  /** true(기본): 병합 시 절마다 줄바꿈, false: 절 번호 링크와 함께 한 문단으로 이어 붙임 */
  verseNewline?: boolean;
}

const oneLine = (t: string) => t.replace(/\s*\n\s*/g, " ").trim();

/** [16,17,18,20] → "16-18, 20" */
export function verseRuns(nums: number[]): string {
  if (nums.length === 0) return "";
  const runs: string[] = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i <= nums.length; i++) {
    const n = nums[i];
    if (n !== undefined && n === prev + 1) {
      prev = n;
      continue;
    }
    runs.push(start === prev ? `${start}` : `${start}-${prev}`);
    if (n !== undefined) {
      start = n;
      prev = n;
    }
  }
  return runs.join(", ");
}

/** 절들이 여러 장에 걸쳐 있는가 (장 경계 범위) */
function isMultiChapter(verses: VerseData[]): boolean {
  return verses.some((v) => v.chapter !== verses[0].chapter);
}

function headerLabel(opts: FormatOptions, verses: VerseData[]): string {
  if (opts.wholeChapter) {
    const unit = opts.bookName === "시편" ? "편" : "장";
    return `${opts.bookName} ${opts.chapter}${unit}`;
  }
  if (isMultiChapter(verses)) {
    const first = verses[0];
    const last = verses[verses.length - 1];
    return `${opts.bookName} ${first.chapter}:${first.verse}-${last.chapter}:${last.verse}`;
  }
  return `${opts.bookName} ${verses[0].chapter}:${verseRuns(verses.map((v) => v.verse))}`;
}

/** 헤더의 역본 표기: "새번역" 또는 병렬이면 "새번역 · NIV" */
function versionLabel(opts: FormatOptions): string {
  return opts.secondaryVersion
    ? `${opts.version} · ${opts.secondaryVersion}`
    : opts.version;
}

/** "[[요3_16|16]] 본문" — 병합 시 절 하나의 조각. 병렬 역본은 이탤릭으로 뒤따름 */
function versePiece(verse: VerseData, opts: FormatOptions, multi: boolean): string {
  const num = multi ? `${verse.chapter}:${verse.verse}` : `${verse.verse}`;
  let piece = `[[${verse.linkTarget}|${num}]] ${oneLine(verse.texts[opts.version] ?? "")}`;
  const secondary = opts.secondaryVersion && verse.texts[opts.secondaryVersion];
  if (secondary) piece += ` _${oneLine(secondary)}_`;
  return piece;
}

function singleCallout(verse: VerseData, opts: FormatOptions): string {
  const text = verse.texts[opts.version] ?? "";
  const label = `${opts.bookName} ${verse.chapter}:${verse.verse}`;
  const lines = [`> [!quote] [[${verse.linkTarget}|${label}]] (${versionLabel(opts)})`];
  for (const t of text.split("\n")) lines.push(`> ${t}`);
  const secondary = opts.secondaryVersion && verse.texts[opts.secondaryVersion];
  if (secondary) lines.push(`> _${oneLine(secondary)}_`);
  return lines.join("\n");
}

function singleText(verse: VerseData, opts: FormatOptions): string {
  const text = verse.texts[opts.version] ?? "";
  const label = `${opts.bookName} ${verse.chapter}:${verse.verse}`;
  const lines = [`[[${verse.linkTarget}|${label}]] (${versionLabel(opts)})`];
  for (const t of text.split("\n")) lines.push(t);
  const secondary = opts.secondaryVersion && verse.texts[opts.secondaryVersion];
  if (secondary) lines.push(`_${oneLine(secondary)}_`);
  return lines.join("\n");
}

/** 일반 텍스트 삽입 — 콜아웃 문법만 없고 헤더·절별 wikilink 구조는 콜아웃과 동일 */
function formatTextVerses(verses: VerseData[], opts: FormatOptions): string {
  if (verses.length === 1) return singleText(verses[0], opts) + "\n";

  const multi = isMultiChapter(verses);
  const first = verses[0];
  const lines = [
    `[[${first.linkTarget}|${headerLabel(opts, verses)}]] (${versionLabel(opts)})`,
  ];
  if (opts.verseNewline === false) {
    lines.push(verses.map((v) => versePiece(v, opts, multi)).join(" "));
  } else {
    for (const v of verses) {
      const num = multi ? `${v.chapter}:${v.verse}` : `${v.verse}`;
      lines.push(`[[${v.linkTarget}|${num}]] ${oneLine(v.texts[opts.version] ?? "")}`);
      const secondary = opts.secondaryVersion && v.texts[opts.secondaryVersion];
      if (secondary) lines.push(`_${oneLine(secondary)}_`);
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * 클립보드 복사용 플레인 텍스트 — 콜아웃·wikilink 없이 주보/PPT에 바로 붙여넣는 용도.
 * 단일 절은 절 번호 생략. 장 경계 범위는 절 번호를 "장:절"로 표기.
 */
export function formatPlainVerses(verses: VerseData[], opts: FormatOptions): string {
  if (verses.length === 0) return "";
  const multi = isMultiChapter(verses);
  const lines = [`${headerLabel(opts, verses)} (${versionLabel(opts)})`];
  for (const v of verses) {
    const num = multi ? `${v.chapter}:${v.verse}` : `${v.verse}`;
    const prefix = verses.length > 1 ? `${num} ` : "";
    lines.push(`${prefix}${oneLine(v.texts[opts.version] ?? "")}`);
    const secondary = opts.secondaryVersion && v.texts[opts.secondaryVersion];
    if (secondary) lines.push(oneLine(secondary));
  }
  return lines.join("\n") + "\n";
}

/**
 * 키워드 검색 결과처럼 여러 책·장에 흩어진 절들을 formatVerses 호출 단위(책+장)로 묶는다.
 * 그룹 순서는 입력 순서(호출자가 정경 순으로 정렬해 넘김), 그룹 안은 절 번호 순.
 */
export function groupForInsert<T extends VerseData & { bookName: string }>(
  verses: T[],
): Array<{ bookName: string; chapter: number; verses: T[] }> {
  const groups: Array<{ bookName: string; chapter: number; verses: T[] }> = [];
  const byKey = new Map<string, { bookName: string; chapter: number; verses: T[] }>();
  for (const v of verses) {
    const key = `${v.bookName}|${v.chapter}`;
    let group = byKey.get(key);
    if (!group) {
      group = { bookName: v.bookName, chapter: v.chapter, verses: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.verses.push(v);
  }
  for (const group of groups) group.verses.sort((a, b) => a.verse - b.verse);
  return groups;
}

/**
 * 선택된 절들을 삽입용 문자열로 만든다 (opts.format에 따라 콜아웃 또는 일반 텍스트).
 * 호출자는 선택 역본의 본문이 있는 절만 넘겨야 한다.
 */
export function formatVerses(verses: VerseData[], opts: FormatOptions): string {
  if (verses.length === 0) return "";

  if (opts.format === "text") return formatTextVerses(verses, opts);

  if (verses.length === 1) return singleCallout(verses[0], opts) + "\n";

  const multi = isMultiChapter(verses);
  const first = verses[0];
  const lines = [
    `> [!quote] [[${first.linkTarget}|${headerLabel(opts, verses)}]] (${versionLabel(opts)})`,
  ];
  if (opts.verseNewline === false) {
    lines.push(`> ${verses.map((v) => versePiece(v, opts, multi)).join(" ")}`);
  } else {
    for (const v of verses) {
      const num = multi ? `${v.chapter}:${v.verse}` : `${v.verse}`;
      lines.push(`> [[${v.linkTarget}|${num}]] ${oneLine(v.texts[opts.version] ?? "")}`);
      const secondary = opts.secondaryVersion && v.texts[opts.secondaryVersion];
      if (secondary) lines.push(`> _${oneLine(secondary)}_`);
    }
  }
  return lines.join("\n") + "\n";
}
