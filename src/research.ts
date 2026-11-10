/**
 * 「연구 자료」 — 연구 자료 폴더에서 검색한 구절 노트를 링크한 노트를 모으고, 위 폴더의 노트
 * (견해 지도 등)가 링크한 더 깊은 폴더의 노트(원문 발췌 등)를 그 아래로 묶는다.
 * obsidian 미의존 — vitest 대상. 링크 입력은 metadataCache.resolvedLinks 모양 그대로.
 *
 * 묶는 규칙: 얕은 폴더의 노트부터 자리를 잡고, 더 깊은 폴더의 노트는 자기를 링크한 더 얕은 노트
 * (가장 얕은 것, 같으면 구절 링크가 많은 것)의 묶음으로 들어간다. 그런 노트가 없으면 따로 한 줄이다.
 * 같은 깊이끼리는 서로 링크해도 묶지 않는다. 묶음은 한 단계뿐이라, 묶인 노트가 링크한 더 깊은 노트도
 * 같은 묶음(맨 위 노트 아래)에 들어간다. 폴더를 나누지 않은 볼트에서는 모두 따로 한 줄씩 —
 * 묶을 정보가 없으면 묶지 않을 뿐 실패하지 않는다.
 */
import { isUnderFolder } from "./paths";
import { sermonGroup } from "./sermon-meta";

export interface ResearchSource {
  path: string;
  /** 이 노트가 링크한 노트 경로 → 횟수 (resolvedLinks[path]) */
  links: Record<string, number> | undefined;
}

export interface ResearchItem {
  path: string;
  /** 검색 구절 노트로 가는 링크 수 — 이 구절을 많이 다룬 자료가 위로 */
  hits: number;
  /** 이 노트가 링크한 더 깊은 폴더의 연구 노트 (원문 발췌 등, 경로 순) */
  children: string[];
}

export interface ChildGroup {
  /** 묶음 이름 — 아래 노트가 든 분류 폴더 (원문 발췌) */
  label: string;
  paths: string[];
}

/** 분류 폴더가 연도 폴더뿐이라 이름을 정할 수 없을 때의 묶음 이름 */
export const FALLBACK_GROUP_LABEL = "연결 노트";

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** 연구 자료 폴더 아래 몇 단계 폴더 안에 있는지 — 폴더 바로 아래 파일은 0 */
export function researchDepth(path: string, root: string): number {
  return path.slice(root.length + 1).split("/").length - 1;
}

/**
 * sources(연구 자료 폴더의 노트와 그 링크) 가운데 targets(검색 구절 노트 경로)를 링크한 노트를
 * 모아 묶는다. 결과는 위 노트만 — 구절 링크가 많은 순, 같으면 경로 순.
 */
export function collectResearch(
  sources: ResearchSource[],
  root: string,
  targets: string[],
): ResearchItem[] {
  const wanted = [...new Set(targets.filter(Boolean))];
  if (!root || wanted.length === 0) return [];

  interface Node extends ResearchItem {
    links: Record<string, number>;
    depth: number;
  }
  const matched: Node[] = [];
  for (const { path, links } of sources) {
    if (!links || path === root || !isUnderFolder(path, root)) continue;
    let hits = 0;
    for (const t of wanted) hits += links[t] ?? 0;
    if (hits > 0) {
      matched.push({ path, links, hits, depth: researchDepth(path, root), children: [] });
    }
  }

  // 얕은 폴더부터 — 위 노트가 먼저 자리를 잡아야 아래 노트가 그 밑으로 들어간다
  matched.sort((a, b) => a.depth - b.depth || b.hits - a.hits || byPath(a.path, b.path));
  const top: Node[] = [];
  /** 자리 잡은 노트 → 그 노트가 속한 맨 위 노트 (맨 위 노트는 자기 자신) */
  const owner = new Map<string, Node>();
  for (const node of matched) {
    // 정렬 순서대로 찾으므로 가장 얕은 것, 같은 깊이면 구절 링크가 많은 것이 먼저 걸린다
    const linker = matched.find(
      (p) => p.depth < node.depth && owner.has(p.path) && (p.links[node.path] ?? 0) > 0,
    );
    const group = linker ? owner.get(linker.path) : undefined;
    if (group) {
      group.children.push(node.path);
      owner.set(node.path, group);
    } else {
      top.push(node);
      owner.set(node.path, node);
    }
  }

  return top
    .sort((a, b) => b.hits - a.hits || byPath(a.path, b.path))
    .map(({ path, hits, children }) => ({ path, hits, children: children.sort(byPath) }));
}

/**
 * 위 노트 아래에 묶인 노트를 분류 폴더별로 나눈다 — "원문 발췌 20".
 * 분류 폴더 = 아래 노트가 위 노트와 같은 폴더 안에 있으면 그 폴더 아래 첫 폴더, 아니면 연구 자료 폴더
 * 아래 첫 폴더(앞 번호를 떼고 연도 폴더는 건너뜀). 많은 묶음 먼저, 같으면 이름순.
 */
export function groupChildren(parent: string, children: string[], root: string): ChildGroup[] {
  const slash = parent.lastIndexOf("/");
  const parentDir = slash === -1 ? "" : parent.slice(0, slash);
  const groups = new Map<string, string[]>();
  for (const child of children) {
    const base = parentDir && isUnderFolder(child, parentDir) ? parentDir : root;
    const label = sermonGroup(child, base) ?? FALLBACK_GROUP_LABEL;
    const list = groups.get(label);
    if (list) list.push(child);
    else groups.set(label, [child]);
  }
  return [...groups]
    .map(([label, paths]) => ({ label, paths }))
    .sort((a, b) => b.paths.length - a.paths.length || a.label.localeCompare(b.label, "ko"));
}

/** 제목 마디 구분 — sermon-meta의 parseSermonName이 파일명의 `_`를 이렇게 바꾼다 */
const SEGMENT_SEP = " · ";

/**
 * 묶음 칩 이름 — 모든 제목이 같은 첫 마디(예: "발췌 · ")로 시작하면 그 마디를 뗀다.
 * 묶음 이름(원문 발췌)이 이미 그 뜻을 말해 주기 때문이다. 하나라도 다르면 그대로 둔다.
 */
export function chipLabels(titles: string[]): string[] {
  if (titles.length === 0) return [];
  const head = (t: string) => {
    const at = t.indexOf(SEGMENT_SEP);
    return at > 0 ? t.slice(0, at) : null;
  };
  const first = head(titles[0]);
  if (first === null || !titles.every((t) => head(t) === first)) return titles;
  return titles.map((t) => t.slice(first.length + SEGMENT_SEP.length).trim() || t);
}
