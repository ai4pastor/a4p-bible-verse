/**
 * "인용한 설교" 목록의 표시 정보 — 파일명에서 날짜·부서·본문·꼬리표를 읽고, 부서는 폴더를 먼저 본다.
 * obsidian 미의존 — vitest 대상. 파일명 규칙 예: `260125_청_사도신경 강해10_죽으시고_고후8_9`
 * (날짜_부서_제목_본문). 규칙이 다른 이름은 읽을 수 있는 것만 읽고 나머지는 제목에 그대로 남긴다 —
 * 어떤 정보도 없으면 그 칸이 비어 있을 뿐 실패하지 않는다.
 *
 * 부서 판정 순서: ① 설교 폴더 아래 첫 분류 폴더(연도 폴더는 건너뜀, sermonGroup)
 * ② 파일명 날짜 바로 뒤의 부서 표시(SermonMeta.dept) ③ 없으면 빈칸.
 */
import { BOOK_BY_ABBREV } from "./books";
import { isUnderFolder } from "./paths";
import { nfc } from "./verse-files";

export interface SermonDate {
  y: number;
  m: number;
  d: number;
}

export interface SermonMeta {
  date?: SermonDate;
  /** 날짜·부서 약자·본문·꼬리표를 뗀 제목 (구분자 `_`는 ` · `) */
  title: string;
  /** 파일명 끝의 설교 본문 — 짧은 표기 (예: "고후 8:9", "고전 15장") */
  passage?: string;
  /** 파일명 끝의 소문자 꼬리표 (예: "hm") — 같은 설교의 다른 판을 구별 */
  tag?: string;
  /** 파일명 날짜 바로 뒤의 부서 표시 (청 · 어린이부 · 주일예배) — 폴더로 정한 부서가 없을 때 쓴다 */
  dept?: string;
}

interface DateMatch {
  date: SermonDate;
  index: number;
  length: number;
}

/** 6자리 YYMMDD의 연도 — 50 이하는 20YY */
const fullYear = (yy: number) => (yy <= 50 ? 2000 + yy : 1900 + yy);

/** 날짜 표기 — 앞 패턴 우선. 6자리 뒤에 붙은 "일"(예: 231022일)까지 한 덩어리로 뗀다 */
const DATE_PATTERNS: Array<{ re: RegExp; ymd: (m: RegExpExecArray) => [number, number, number] }> = [
  { re: /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, ymd: (m) => [+m[1], +m[2], +m[3]] },
  { re: /(?<!\d)(\d{4})[-.](\d{1,2})[-.](\d{1,2})(?!\d)/g, ymd: (m) => [+m[1], +m[2], +m[3]] },
  { re: /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/g, ymd: (m) => [+m[1], +m[2], +m[3]] },
  { re: /(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)일?/g, ymd: (m) => [fullYear(+m[1]), +m[2], +m[3]] },
];

const isValidDate = (y: number, m: number, d: number) =>
  y >= 1900 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

/** 문자열에서 첫 유효 날짜와 그 자리 — 월·일 범위를 벗어난 숫자(예: 123456)는 건너뛴다 */
export function findDate(text: string): DateMatch | null {
  for (const { re, ymd } of DATE_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const [y, mo, d] = ymd(m);
      if (isValidDate(y, mo, d)) {
        return { date: { y, m: mo, d }, index: m.index, length: m[0].length };
      }
    }
  }
  return null;
}

/** 노트 속성(date·설교일) 값의 날짜 — 파일명에 날짜가 없을 때 보충용 */
export function dateFromProperty(value: unknown): SermonDate | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return findDate(String(value))?.date;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "2026.01.25" */
export function formatSermonDate(d: SermonDate): string {
  return `${d.y}.${pad2(d.m)}.${pad2(d.d)}`;
}

/** 본문 하나: `고후8_9` · `롬8_33-39` · `고전15` */
const PASSAGE_UNIT = String.raw`[가-힣]{1,3}\d{1,3}(?:_\d{1,3}(?:-\d{1,3})?)?`;
/** 파일명 끝 본문 (여러 개면 `·`·`,`로 이어짐 — `_요3_5·눅16_13`) */
const PASSAGE_TAIL = new RegExp(String.raw`_(${PASSAGE_UNIT}(?:[·,]\s*${PASSAGE_UNIT})*)$`);
/** 본문 뒤에 짧은 꼬리표가 하나 더 붙은 이름 — `_고전15_3-8_작업초안` */
const PASSAGE_THEN_TAG = new RegExp(
  String.raw`_(${PASSAGE_UNIT}(?:[·,]\s*${PASSAGE_UNIT})*)_([^_\d]{1,8})$`,
);
const PASSAGE_PARTS = /([가-힣]{1,3})(\d{1,3})(?:_(\d{1,3})(?:-(\d{1,3}))?)?/g;

/** 본문 덩어리를 짧은 표기로 — 약자가 하나라도 66권 표에 없으면 본문이 아니다 */
function readPassages(text: string): string | undefined {
  const out: string[] = [];
  PASSAGE_PARTS.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PASSAGE_PARTS.exec(text))) {
    const [, abbrev, chapter, start, end] = m;
    if (!BOOK_BY_ABBREV.has(abbrev)) return undefined;
    if (!start) out.push(`${abbrev} ${chapter}${abbrev === "시" ? "편" : "장"}`);
    else out.push(end ? `${abbrev} ${chapter}:${start}-${end}` : `${abbrev} ${chapter}:${start}`);
  }
  return out.length > 0 ? out.join(", ") : undefined;
}

const isDigit = (c: string | undefined) => !!c && c >= "0" && c <= "9";

/** 부서 표시 한 칸: 한 글자 약자(청·어·대) 또는 '~부'·'~예배'로 끝나는 말(어린이부·주일예배) */
const DEPT_SEGMENT = /^(?:[가-힣]|[가-힣]{1,5}(?:부|예배))$/;

export function parseSermonName(basename: string): SermonMeta {
  const name = nfc(basename).trim();
  const found = findDate(name);
  let rest = name;
  if (found) {
    rest = `${name.slice(0, found.index)}_${name.slice(found.index + found.length)}`;
  }
  // 날짜를 뗀 자리의 구분자를 하나로 모으고 양끝 구분자를 정리
  rest = rest.replace(/\s*_[\s_]*/g, "_").replace(/^[\s_\-–—.,·]+|[\s_\-–—.,·]+$/g, "");

  let tag: string | undefined;
  const tagMatch = /_([a-z]{1,4})$/.exec(rest);
  if (tagMatch) {
    tag = tagMatch[1];
    rest = rest.slice(0, -tagMatch[0].length);
  }

  let passage: string | undefined;
  const atEnd = PASSAGE_TAIL.exec(rest);
  const withTag = atEnd || tag ? null : PASSAGE_THEN_TAG.exec(rest);
  const p = atEnd ?? withTag;
  if (p) {
    passage = readPassages(p[1]);
    if (passage) {
      if (withTag) tag = withTag[2];
      rest = rest.slice(0, -p[0].length);
    }
  }

  // 날짜 바로 뒤(첫째·둘째 칸)의 부서 표시 — 260125_청_… · 190210_어린이부_… · 250414 설교_어_…
  // 본문을 뗀 뒤에 보므로, 뒤에 제목이 남을 때만 부서로 읽는다 (260101_길_요14_6의 "길"은 제목)
  let dept: string | undefined;
  if (found?.index === 0) {
    const segments = rest.split("_");
    const at = segments.findIndex((s, i) => i < 2 && DEPT_SEGMENT.test(s));
    if (at !== -1 && segments.length > at + 1) {
      dept = segments.splice(at, 1)[0];
      rest = segments.join("_");
    }
  }

  // 남은 `_`는 제목 구분 — 숫자 사이(요3_16 같은 참조)는 그대로 둔다
  const title = rest
    .replace(/_/g, (_m: string, i: number, s: string) =>
      isDigit(s[i - 1]) && isDigit(s[i + 1]) ? "_" : " · ",
    )
    .trim();
  return { date: found?.date, title: title || name, passage, tag, dept };
}

/** 폴더 이름 앞의 정렬용 번호 떼기 — "310. 청소년부" → "청소년부". 번호 뒤 구분자가 없으면(2026, 1부) 그대로 */
export function groupLabel(folderName: string): string {
  const name = nfc(folderName).trim();
  return name.replace(/^\d+[.\s_-]+/, "").trim() || name;
}

/** 연도 폴더(2025 · 2025년 · 2025년도)는 부서가 아니다 — 날짜 칸에 이미 연도가 있다 */
export function isYearFolder(folderName: string): boolean {
  return /^(?:19|20)\d{2}(?:년도?)?$/.test(groupLabel(folderName));
}

/**
 * 폴더로 정한 부서 = 설교 폴더 아래 경로에서 연도가 아닌 첫 폴더 (310. 청소년부/2026 · 2026/청소년부 모두 "청소년부").
 * 설교 폴더를 지정하지 않았거나, 설교 폴더 바로 아래(또는 연도 폴더 안에만) 있는 노트는 부서 없음.
 */
export function sermonGroup(path: string, root: string): string | undefined {
  if (!root || !isUnderFolder(path, root)) return undefined;
  const folders = path.slice(root.length + 1).split("/").slice(0, -1);
  const folder = folders.find((f) => !isYearFolder(f));
  return folder === undefined ? undefined : groupLabel(folder);
}

/** 폴더 순서로 색을 못 정한 부서(파일명에서 읽은 부서 등)의 색 번호 — 이름이 같으면 늘 같은 색 */
export function labelColor(label: string, colors: number): number {
  let h = 0;
  for (const ch of label) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h % colors;
}

const dateKey = (d?: SermonDate) => (d ? d.y * 10000 + d.m * 100 + d.d : 0);

/** 최신순 — 날짜 없는 노트는 맨 뒤, 같은 날은 제목 → 경로 순 */
export function compareSermons(
  a: { path: string; meta: SermonMeta },
  b: { path: string; meta: SermonMeta },
): number {
  const diff = dateKey(b.meta.date) - dateKey(a.meta.date);
  if (diff !== 0) return diff;
  const byTitle = a.meta.title.localeCompare(b.meta.title, "ko");
  if (byTitle !== 0) return byTitle;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}
