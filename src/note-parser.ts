import { Version } from "./types";

const LABEL_RE = /^>\s*\[!quote\]\s*(새번역|개역개정|쉬운성경|NIV|KJV)\s*$/;

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
const BODY_HEADING_RE = /^##\s*📜\s*본문\s*$/m;

/**
 * 구절 노트 본문에서 역본별 텍스트를 추출한다.
 * "## 📜 본문" 섹션 안의 `> [!quote] {역본}` 콜아웃만 대상으로 하며,
 * 콜아웃 순서·추가 섹션(원어 핵심어 등)에 의존하지 않는다.
 */
export function extractVerseTexts(content: string): Partial<Record<Version, string>> {
  let body = content;
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) body = body.slice(end + 4);
  }

  const heading = BODY_HEADING_RE.exec(body);
  if (!heading) return {};
  const sectionStart = heading.index + heading[0].length;
  const restOffset = body.slice(sectionStart).search(/^##\s/m);
  const section =
    restOffset === -1
      ? body.slice(sectionStart)
      : body.slice(sectionStart, sectionStart + restOffset);

  const result: Partial<Record<Version, string>> = {};
  let current: Version | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (current) {
      const text = buf.join("\n").trim();
      if (text) result[current] = text;
    }
    current = null;
    buf = [];
  };

  for (const line of section.split("\n")) {
    const label = line.match(LABEL_RE);
    if (label) {
      flush();
      current = label[1] as Version;
      continue;
    }
    if (current) {
      const quoted = line.match(/^>\s?(.*)$/);
      if (quoted) buf.push(quoted[1]);
      else flush();
    }
  }
  flush();
  return result;
}
