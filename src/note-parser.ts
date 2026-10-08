import { Version } from "./types";
import { normalizeVersionName } from "./versions";

/**
 * `> [!quote] 제목` 콜아웃 제목 줄. 접힘 표시(`[!quote]+`/`-`)·대문자 QUOTE·끝 공백(CRLF 포함) 허용.
 * 제목은 가리지 않는다 — 어떤 콜아웃을 역본으로 쓸지는 설정의 역본 목록(versions.ts)이 정한다.
 */
const QUOTE_TITLE_RE = /^>\s*\[!quote\][+-]?\s*(.*?)\s*$/i;
const BODY_HEADING_RE = /^##\s*📜\s*본문\s*$/m;

/**
 * 역본 본문에 섞인 편집 표기를 제거한다 (설정 토글, 기본 꺼짐).
 * - `<천지창조>` 같은 소제목
 * - `(g. 해석자에 따라 …)` 각주 본문
 * - `a)` `g)` 각주 마커
 */
export function stripAnnotations(text: string): string {
  return text
    .replace(/<[^>\n]{1,40}>/g, "")
    .replace(/\(\s*[a-z]\.\s*[^)]*\)/g, "")
    .replace(/(^|\s)[a-z]\)\s*/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/** 마크다운에서 특정 헤딩부터 같은 레벨 이하의 다음 헤딩 전까지 슬라이스 (미리보기용) */
export function extractHeadingSection(md: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^(#{1,6})\\s+${escaped}\\s*$`, "m");
  const m = re.exec(md);
  if (!m) return md;
  const level = m[1].length;
  const start = m.index;
  const rest = md.slice(start + m[0].length);
  const next = new RegExp(`^#{1,${level}}\\s`, "m").exec(rest);
  return next ? md.slice(start, start + m[0].length + next.index) : md.slice(start);
}

/** frontmatter를 떼고 `## 📜 본문` 섹션(다음 `## ` 헤딩 전까지)만 돌려준다. 섹션이 없으면 null */
function bodySection(content: string): string | null {
  let body = content;
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) body = body.slice(end + 4);
  }
  const heading = BODY_HEADING_RE.exec(body);
  if (!heading) return null;
  const sectionStart = heading.index + heading[0].length;
  const restOffset = body.slice(sectionStart).search(/^##\s/m);
  return restOffset === -1
    ? body.slice(sectionStart)
    : body.slice(sectionStart, sectionStart + restOffset);
}

interface QuoteCallout {
  /** 정규화된 제목 — 제목 없는 콜아웃은 "" */
  title: string;
  /** `> ` 접두를 뗀 본문 줄들 */
  lines: string[];
}

/**
 * 섹션을 콜아웃 단위로 자른다. 모든 제목 줄이 경계라서, 빈 줄 없이 이어진 다른 콜아웃이
 * 앞 콜아웃 본문에 흡수되지 않는다. 콜아웃이 아닌 줄(빈 줄 등)이 나오면 콜아웃이 끝난다.
 */
function parseQuoteCallouts(section: string): QuoteCallout[] {
  const callouts: QuoteCallout[] = [];
  let current: QuoteCallout | null = null;
  for (const line of section.split(/\r?\n/)) {
    const titleMatch = line.match(QUOTE_TITLE_RE);
    if (titleMatch) {
      current = { title: normalizeVersionName(titleMatch[1]), lines: [] };
      callouts.push(current);
      continue;
    }
    if (!current) continue;
    const quoted = line.match(/^>\s?(.*)$/);
    if (quoted) current.lines.push(quoted[1]);
    else current = null;
  }
  return callouts;
}

/**
 * 구절 노트 본문에서 콜아웃 제목별 텍스트를 추출한다.
 * "## 📜 본문" 섹션 안의 `> [!quote] {제목}` 콜아웃을 제목 그대로 키로 담으며(제목 무관),
 * 콜아웃 순서·추가 섹션(원어 핵심어 등)에 의존하지 않는다. 제목이 없거나 본문이 빈 콜아웃은 제외.
 * 같은 제목이 반복되면 뒤의 것이 남는다.
 */
export function extractVerseTexts(content: string): Partial<Record<Version, string>> {
  const section = bodySection(content);
  if (section === null) return {};
  const result: Partial<Record<Version, string>> = {};
  for (const { title, lines } of parseQuoteCallouts(section)) {
    if (!title) continue;
    const text = lines.join("\n").trim();
    if (text) result[title] = text;
  }
  return result;
}

/**
 * "## 📜 본문" 섹션의 `[!quote]` 콜아웃 제목들 — 등장 순, 중복 제거, 본문이 비어도 포함.
 * 설정 탭 "노트에서 찾기"·역본 추가 모달의 표본 확인에 쓴다.
 */
export function listQuoteTitles(content: string): string[] {
  const section = bodySection(content);
  if (section === null) return [];
  const titles: string[] = [];
  for (const { title } of parseQuoteCallouts(section)) {
    if (title && !titles.includes(title)) titles.push(title);
  }
  return titles;
}
