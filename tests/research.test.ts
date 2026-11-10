import { describe, expect, it } from "vitest";
import {
  FALLBACK_GROUP_LABEL,
  ResearchSource,
  chipLabels,
  collectResearch,
  groupChildren,
  researchDepth,
} from "../src/research";

const ROOT = "700. Reference/790. 성경 자료 연구";
const VERSE = (link: string) => `100. notes/170. 성경/신약/${link}.md`;
const 마6_13 = VERSE("마6_13");
const 약1_13 = VERSE("약1_13");
const 요8_44 = VERSE("요8_44");

const HUB = `${ROOT}/악에서 구하옵소서 견해 지도_마6_13_hm.md`;
const EX = (name: string) => `${ROOT}/원문 발췌/마6_13/발췌_${name}_마6_13_hm.md`;
const 놀랜드 = EX("놀랜드 NIGTC 마태");
const 스토트 = EX("스토트 BST 산상수훈");
const AYBD = EX("AYBD Evil One");
const 그린 = EX("그린 BST 마태");

/** 실제 볼트 모양 — 견해 지도가 발췌를 링크하고, 발췌는 견해 지도와 본문 구절을 링크한다 */
const vault = (): ResearchSource[] => [
  {
    path: HUB,
    links: { [마6_13]: 10, [약1_13]: 5, [놀랜드]: 3, [스토트]: 2, [AYBD]: 1, [그린]: 1 },
  },
  { path: 놀랜드, links: { [HUB]: 2, [마6_13]: 5, [약1_13]: 1 } },
  { path: 스토트, links: { [HUB]: 2, [마6_13]: 1, [약1_13]: 1 } },
  { path: AYBD, links: { [HUB]: 2, [마6_13]: 7, [요8_44]: 1 } },
  { path: 그린, links: { [HUB]: 2, [마6_13]: 1 } },
];

describe("researchDepth", () => {
  it("연구 자료 폴더 바로 아래 파일은 0, 폴더 하나 안이면 1", () => {
    expect(researchDepth(HUB, ROOT)).toBe(0);
    expect(researchDepth(`${ROOT}/원문 발췌/x.md`, ROOT)).toBe(1);
    expect(researchDepth(놀랜드, ROOT)).toBe(2);
  });
});

describe("collectResearch — 견해 지도 아래 원문 발췌 묶기", () => {
  it("주 본문 검색: 견해 지도 한 줄 아래에 발췌 전부가 묶인다", () => {
    const items = collectResearch(vault(), ROOT, [마6_13]);
    expect(items).toEqual([{ path: HUB, hits: 10, children: [AYBD, 그린, 스토트, 놀랜드].sort() }]);
  });

  it("지나가며 인용한 구절: 그 구절을 링크한 발췌만 견해 지도 아래에", () => {
    const items = collectResearch(vault(), ROOT, [약1_13]);
    expect(items).toEqual([{ path: HUB, hits: 5, children: [스토트, 놀랜드].sort() }]);
  });

  it("발췌만 인용한 구절: 견해 지도가 그 구절을 링크하지 않으면 발췌가 따로 한 줄", () => {
    expect(collectResearch(vault(), ROOT, [요8_44])).toEqual([
      { path: AYBD, hits: 1, children: [] },
    ]);
  });

  it("범위 검색은 구절별 링크 수를 더하고, 같은 경로가 두 번 와도 한 번만 센다", () => {
    const items = collectResearch(vault(), ROOT, [마6_13, 약1_13, 마6_13, ""]);
    expect(items[0].hits).toBe(15);
    expect(items).toHaveLength(1);
  });

  it("폴더를 나누지 않은 볼트: 서로 링크해도 같은 깊이는 묶지 않고 링크 많은 순", () => {
    const a = `${ROOT}/A.md`;
    const b = `${ROOT}/B.md`;
    const items = collectResearch(
      [
        { path: a, links: { [b]: 1, [마6_13]: 1 } },
        { path: b, links: { [a]: 1, [마6_13]: 3 } },
      ],
      ROOT,
      [마6_13],
    );
    expect(items).toEqual([
      { path: b, hits: 3, children: [] },
      { path: a, hits: 1, children: [] },
    ]);
  });

  it("두 견해 지도가 같은 발췌를 링크하면 구절 링크가 많은 쪽 아래에 한 번만", () => {
    const hub2 = `${ROOT}/주기도문 견해 지도_마6_9-13_hm.md`;
    const items = collectResearch(
      [...vault(), { path: hub2, links: { [마6_13]: 3, [놀랜드]: 1 } }],
      ROOT,
      [마6_13],
    );
    expect(items.map((i) => i.path)).toEqual([HUB, hub2]);
    expect(items[0].children).toContain(놀랜드);
    expect(items[1].children).toEqual([]);
  });

  it("묶음은 한 단계 — 묶인 노트가 링크한 더 깊은 노트도 맨 위 노트 아래로", () => {
    const mid = `${ROOT}/주제/소주제.md`;
    const deep = `${ROOT}/주제/원문/깊은 발췌.md`;
    const items = collectResearch(
      [
        { path: HUB, links: { [마6_13]: 2, [mid]: 1 } },
        { path: mid, links: { [마6_13]: 1, [deep]: 1 } },
        { path: deep, links: { [마6_13]: 1 } },
      ],
      ROOT,
      [마6_13],
    );
    expect(items).toEqual([{ path: HUB, hits: 2, children: [deep, mid].sort() }]);
  });

  it("더 얕은 노트가 링크하지 않은 깊은 노트는 따로 한 줄 (배지로 분류 표시)", () => {
    const loose = `${ROOT}/원문 발췌/롬8_28/발췌_다른 자료_롬8_28_hm.md`;
    const items = collectResearch(
      [...vault(), { path: loose, links: { [마6_13]: 1 } }],
      ROOT,
      [마6_13],
    );
    expect(items.map((i) => i.path)).toEqual([HUB, loose]);
  });

  it("연구 자료 폴더 밖·링크 없는 노트·폴더 이름과 같은 경로는 무시", () => {
    const items = collectResearch(
      [
        { path: "300. Sermons/설교.md", links: { [마6_13]: 4 } },
        { path: `${ROOT} 사본/x.md`, links: { [마6_13]: 4 } },
        { path: `${ROOT}/링크 없음.md`, links: undefined },
        { path: ROOT, links: { [마6_13]: 1 } },
      ],
      ROOT,
      [마6_13],
    );
    expect(items).toEqual([]);
  });

  it("폴더 미지정·검색 구절 없음이면 빈 결과", () => {
    expect(collectResearch(vault(), "", [마6_13])).toEqual([]);
    expect(collectResearch(vault(), ROOT, [])).toEqual([]);
    expect(collectResearch(vault(), ROOT, [""])).toEqual([]);
  });
});

describe("groupChildren — 묶음 이름은 분류 폴더", () => {
  it("견해 지도가 폴더 바로 아래면 연구 자료 폴더 아래 첫 폴더 (원문 발췌)", () => {
    expect(groupChildren(HUB, [놀랜드, 스토트], ROOT)).toEqual([
      { label: "원문 발췌", paths: [놀랜드, 스토트] },
    ]);
  });

  it("앞 번호를 떼고, 묶음이 여럿이면 많은 묶음 먼저", () => {
    const chart = `${ROOT}/02. 도표/주기도문 구조.md`;
    expect(groupChildren(HUB, [chart, 놀랜드, 스토트], ROOT)).toEqual([
      { label: "원문 발췌", paths: [놀랜드, 스토트] },
      { label: "도표", paths: [chart] },
    ]);
  });

  it("견해 지도와 같은 폴더 안이면 그 폴더 아래 첫 폴더", () => {
    const hub = `${ROOT}/마태복음/견해 지도.md`;
    const ex = `${ROOT}/마태복음/발췌/스토트.md`;
    expect(groupChildren(hub, [ex], ROOT)).toEqual([{ label: "발췌", paths: [ex] }]);
  });

  it("연도 폴더 안에만 있으면 이름을 정할 수 없어 '연결 노트'", () => {
    const ex = `${ROOT}/2026/스토트.md`;
    expect(groupChildren(HUB, [ex], ROOT)).toEqual([
      { label: FALLBACK_GROUP_LABEL, paths: [ex] },
    ]);
  });
});

describe("chipLabels — 묶음 칩 이름", () => {
  it("모두 같은 첫 마디(발췌)로 시작하면 뗀다", () => {
    expect(chipLabels(["발췌 · 놀랜드 NIGTC 마태", "발췌 · AYBD Evil One"])).toEqual([
      "놀랜드 NIGTC 마태",
      "AYBD Evil One",
    ]);
  });

  it("하나만 있어도 뗀다 — 묶음 이름이 뜻을 말해 준다", () => {
    expect(chipLabels(["발췌 · 스토트 BST 산상수훈"])).toEqual(["스토트 BST 산상수훈"]);
  });

  it("첫 마디가 다르거나 구분이 없는 제목이 섞이면 그대로", () => {
    const mixed = ["발췌 · 놀랜드", "요약 · 스토트"];
    expect(chipLabels(mixed)).toEqual(mixed);
    const plain = ["발췌 · 놀랜드", "스토트 산상수훈"];
    expect(chipLabels(plain)).toEqual(plain);
  });

  it("떼고 나면 빈 이름이면 원래 제목", () => {
    expect(chipLabels(["발췌 · ", "발췌 · 스토트"])).toEqual(["발췌 · ", "스토트"]);
    expect(chipLabels([])).toEqual([]);
  });
});
