/**
 * 미리보기 본문의 인용 위치 강조 — 성경구절 창(인용한 설교·연구 자료)과 설교 성경 지도 창이 함께 쓴다.
 *
 * - 렌더된 링크·임베드가 가리키는 노트가 paths 안이면 `.bible-verse-cite`, 그 블록(콜아웃 → 불릿·문단·표 칸…)은
 *   `.bible-verse-cite-block`. 「인용 N곳」은 블록 단위 — 플러그인이 넣은 범위 콜아웃(제목 링크 + 절별 링크)은 1곳.
 * - textPattern을 주면 링크가 아닌 글자 표기(예: 「창세기 22:1-18」)도 `<mark>`로 감싸 같은 방식으로 센다(설교 성경 지도).
 * - 스크롤은 미리보기 본문 안에서만 — scrollIntoView는 모달·페이지 조상까지 움직여 모달 상단 고정을 깨뜨린다.
 */
import { App, TFile, stripHeading, stripHeadingForLink } from "obsidian";

const BLOCK_SELECTOR = "li, p, td, th, blockquote, h1, h2, h3, h4, h5, h6";
/** 글자 표기를 찾지 않는 자리 — 링크(이미 링크로 판정)·코드·임베드 안·이미 강조한 곳 */
const TEXT_SKIP_SELECTOR = "a, code, pre, .internal-embed, .bible-verse-cite, svg, .math";

/** 렌더된 링크·임베드 요소가 가리키는 노트 경로 — 미해석 링크는 null */
export function resolveRenderedLink(app: App, el: HTMLElement, sourcePath: string): string | null {
  const raw = el.matches("a") ? el.getAttribute("data-href") ?? el.getAttribute("href") : el.getAttribute("src");
  if (!raw) return null;
  const linkpath = raw.split("#")[0];
  return app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)?.path ?? null;
}

function blockOf(el: HTMLElement): HTMLElement {
  return el.closest<HTMLElement>(".callout") ?? el.closest<HTMLElement>(BLOCK_SELECTOR) ?? el.parentElement ?? el;
}

/**
 * paths(볼트 경로)를 가리키는 링크·임베드와, 있으면 textPattern에 맞는 글자 표기를 강조하고
 * 그 컨테이너 블록을 중복 없이 문서 순서로 돌려준다.
 */
export function markCitations(
  app: App,
  body: HTMLElement,
  sourcePath: string,
  paths: string[],
  textPattern?: RegExp,
): HTMLElement[] {
  const wanted = new Set(paths);
  const blocks: HTMLElement[] = [];
  const add = (el: HTMLElement) => {
    const block = blockOf(el);
    if (blocks.includes(block)) return;
    block.addClass("bible-verse-cite-block");
    blocks.push(block);
  };
  if (wanted.size > 0) {
    for (const el of Array.from(body.querySelectorAll<HTMLElement>("a.internal-link, .internal-embed[src]"))) {
      const dest = resolveRenderedLink(app, el, sourcePath);
      if (!dest || !wanted.has(dest)) continue;
      el.addClass("bible-verse-cite");
      add(el);
    }
  }
  if (!textPattern) return blocks;
  for (const mark of markTextMentions(body, textPattern)) add(mark);
  // 링크와 글자 표기가 섞여도 ↑/↓가 위에서 아래로 가게
  return blocks.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

/** 본문 글자 속 pattern에 맞는 곳을 `<mark class="bible-verse-cite is-text">`로 감싼다 (링크·코드 안은 건너뜀) */
function markTextMentions(body: HTMLElement, pattern: RegExp): HTMLElement[] {
  const doc = body.ownerDocument;
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue ?? "";
    // 성경 표기에는 장 번호가 반드시 있다 — 숫자 없는 글자 조각은 정규식을 돌리지 않는다
    if (!/\d/.test(text)) continue;
    if (n.parentElement?.closest(TEXT_SKIP_SELECTOR)) continue;
    nodes.push(n as Text);
  }
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const marks: HTMLElement[] = [];
  for (const node of nodes) {
    const text = node.nodeValue ?? "";
    const re = new RegExp(pattern.source, flags);
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
      const mark = doc.createElement("mark");
      mark.className = "bible-verse-cite is-text";
      mark.textContent = m[0];
      frag.appendChild(mark);
      marks.push(mark);
      last = m.index + m[0].length;
    }
    if (last === 0) continue;
    if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
    node.replaceWith(frag);
  }
  return marks;
}

/** 미리보기 본문(overflow 컨테이너) 안에서만 스크롤해 대상 블록을 상단 1/3 지점에 둔다 */
export function scrollPreviewTo(body: HTMLElement, el: HTMLElement) {
  const b = body.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  body.scrollTop += r.top - b.top - Math.max(0, (body.clientHeight - r.height) / 3);
}

export interface CiteNavOptions {
  /** 배지 앞말 — 기본 「인용」(→ 「인용 2/3」). 설교 성경 지도는 「창세기 인용」 */
  label?: string;
  /** 인용 위치를 못 찾았을 때 배지 풀이 */
  missingHint?: string;
  /** 속성(frontmatter)에서만 인용했을 때 배지 풀이 */
  propertyHint?: string;
  /** 지금 가리키는 인용 블록이 바뀔 때 — [열기]가 그 블록 앞 소제목으로 열 때 쓴다 */
  onCurrent?: (block: HTMLElement) => void;
}

/** 헤더의 「인용 N/M」 배지와 ↑/↓ 이동 버튼. 매치가 없으면 사유(속성에서만 인용 등)를 배지로 알린다 */
export function renderCiteNav(
  app: App,
  nav: HTMLElement,
  body: HTMLElement,
  blocks: HTMLElement[],
  file: TFile,
  paths: string[],
  opts: CiteNavOptions = {},
) {
  const label = opts.label ?? "인용";
  nav.empty();
  if (blocks.length === 0) {
    // resolvedLinks엔 잡히지만 본문 렌더엔 없는 경우: frontmatter 속성 링크(성경구절 등)가 대표적
    const wanted = new Set(paths);
    const fmOnly = (app.metadataCache.getFileCache(file)?.frontmatterLinks ?? []).some((l) => {
      const dest = app.metadataCache.getFirstLinkpathDest(l.link.split("#")[0], file.path);
      return !!dest && wanted.has(dest.path);
    });
    const badge = nav.createSpan({
      cls: "bible-verse-cite-badge is-empty",
      text: fmOnly ? "속성에서만 인용" : "인용 위치 없음",
    });
    badge.title = fmOnly
      ? opts.propertyHint ?? "본문에는 링크가 없고 frontmatter 속성(예: 성경구절)에서만 인용했습니다"
      : opts.missingHint ?? "본문에서 이 구절로 가는 링크를 찾지 못했습니다";
    return;
  }

  let cur = 0;
  const badge = nav.createSpan({ cls: "bible-verse-cite-badge" });
  const show = (idx: number) => {
    blocks[cur].removeClass("is-current");
    cur = (idx + blocks.length) % blocks.length;
    blocks[cur].addClass("is-current");
    badge.setText(blocks.length === 1 ? `${label} 1곳` : `${label} ${cur + 1}/${blocks.length}`);
    opts.onCurrent?.(blocks[cur]);
    scrollPreviewTo(body, blocks[cur]);
  };
  if (blocks.length > 1) {
    const prev = nav.createEl("button", { text: "↑" });
    prev.title = "이전 인용 위치";
    prev.tabIndex = -1;
    prev.addEventListener("click", () => show(cur - 1));
    const next = nav.createEl("button", { text: "↓" });
    next.title = "다음 인용 위치";
    next.tabIndex = -1;
    next.addEventListener("click", () => show(cur + 1));
  }
  // 레이아웃이 확정된 뒤 첫 인용 위치로
  window.requestAnimationFrame(() => {
    if (body.isConnected) show(0);
  });
}

/**
 * 블록 바로 앞(또는 블록 자신)의 소제목을 `path#소제목` 링크용 글자로 — 메타데이터 캐시에 같은 소제목이 있을 때만.
 * 비교는 옵시디언이 소제목 링크를 맞추는 규칙(stripHeading, 대소문자 무시) 그대로, 링크 글자는 stripHeadingForLink로
 * 다듬는다 — 「### [주의집중]」 「## 성경적 근거 - 롬3:10-12」처럼 대괄호·쌍점이 든 소제목도 열린다.
 * (렌더 글자가 원문과 달라 캐시에서 못 찾으면 undefined → 파일 맨 위로 연다)
 */
export function nearestHeadingFor(
  app: App,
  body: HTMLElement,
  block: HTMLElement | null,
  file: TFile,
): string | undefined {
  if (!block) return undefined;
  let found: string | undefined;
  for (const h of Array.from(body.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"))) {
    // 인용이 소제목 줄 자체에 있으면(예: 「## 성경적 근거 - 롬3:10-12」) 그 소제목으로
    if (h === block) {
      found = h.dataset.heading ?? h.textContent ?? undefined;
      break;
    }
    // 헤딩이 블록보다 뒤에 있으면 중단
    if (!(h.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
    found = h.dataset.heading ?? h.textContent ?? undefined;
  }
  if (!found) return undefined;
  const target = stripHeading(found).toLowerCase();
  if (!target) return undefined;
  const hit = (app.metadataCache.getFileCache(file)?.headings ?? []).find(
    (hc) => stripHeading(hc.heading).toLowerCase() === target,
  );
  // #·|·^·[[ ]] 같은 문자는 `path#소제목` 문법을 깨므로 옵시디언이 링크를 만들 때처럼 빈칸으로 바꾼다
  return hit ? stripHeadingForLink(hit.heading) || undefined : undefined;
}

/** 노트 원문에서 앞머리 속성(frontmatter)을 떼어 낸다 — 미리보기는 본문만 그린다 */
export function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md;
  const end = md.indexOf("\n---", 3);
  return end === -1 ? md : md.slice(end + 4);
}
