import { describe, expect, it } from "vitest";
import {
  FlatEntry,
  diagnoseBookFolder,
  formatBookDiagnosis,
  indexVerseFiles,
} from "../src/verse-files";

/** 테스트용 평탄화 항목 — file 토큰은 경로 문자열 */
function file(name: string, depth = 1): FlatEntry<string> {
  return { name, depth, isFolder: false, file: `경로/${name}` };
}
function folder(name: string, depth = 1): FlatEntry<string> {
  return { name, depth, isFolder: true };
}

describe("indexVerseFiles", () => {
  it("직계 절 파일을 인덱싱한다 (장·절 정렬)", () => {
    const idx = indexVerseFiles("요", [file("요1_2.md"), file("요1_1.md"), file("요3_16.md")]);
    expect(idx.byLink.get("요3_16")).toBe("경로/요3_16.md");
    expect(idx.chapters.get(1)).toEqual([1, 2]);
    expect(idx.maxChapter).toBe(3);
    expect(idx.nfdFixed).toBe(0);
  });

  it("이중 폴더·장별 하위 폴더(depth 2~3)의 절 파일도 인식한다", () => {
    const idx = indexVerseFiles("요", [
      folder("04.요한복음", 1),
      file("요1_1.md", 2),
      folder("3장", 2),
      file("요3_16.md", 3),
    ]);
    expect(idx.byLink.size).toBe(2);
    expect(idx.chapters.get(3)).toEqual([16]);
  });

  it("깊이 상한(3)을 넘는 파일은 배제한다", () => {
    const idx = indexVerseFiles("요", [file("요1_1.md", 4)]);
    expect(idx.byLink.size).toBe(0);
    expect(idx.maxChapter).toBe(0);
  });

  it("NFD 파일명을 보정해 인식하고 nfdFixed에 계수한다", () => {
    const idx = indexVerseFiles("요", [file("요3_16.md".normalize("NFD"))]);
    expect(idx.byLink.get("요3_16")).toBeDefined();
    expect(idx.nfdFixed).toBe(1);
  });

  it("같은 linkTarget 중복은 얕은 깊이가 우선한다", () => {
    const deep = { name: "요3_16.md", depth: 2, isFolder: false, file: "깊은/요3_16.md" };
    const idx = indexVerseFiles("요", [deep, file("요3_16.md", 1)]);
    expect(idx.byLink.get("요3_16")).toBe("경로/요3_16.md");
    expect(idx.chapters.get(3)).toEqual([16]); // 중복 계수 없음
  });

  it("다른 책 약자·비절 파일은 무시한다", () => {
    const idx = indexVerseFiles("요", [file("창1_1.md"), file("요한복음 개요.md"), file("요3_16.pdf")]);
    expect(idx.byLink.size).toBe(0);
  });

  it("빈 입력은 빈 인덱스", () => {
    const idx = indexVerseFiles("요", []);
    expect(idx.byLink.size).toBe(0);
    expect(idx.chapters.size).toBe(0);
    expect(idx.maxChapter).toBe(0);
  });
});

describe("diagnoseBookFolder", () => {
  it("동기화 미완료형 — 완전히 빈 폴더", () => {
    const d = diagnoseBookFolder("요", []);
    expect(d).toMatchObject({ directMd: 0, directMatches: 0, nestedMatches: 0, subfolders: 0 });
  });

  it("이중 폴더형 — 직계엔 폴더만, 하위에서 일치", () => {
    const d = diagnoseBookFolder("요", [
      folder("04.요한복음", 1),
      file("요3_16.md", 2),
      file("요1_1.md", 2),
    ]);
    expect(d.subfolders).toBe(1);
    expect(d.directMatches).toBe(0);
    expect(d.nestedMatches).toBe(2);
  });

  it("파일명 불일치형 — 직계 md는 있는데 패턴 불일치, 예시 최대 3개(직계 우선)", () => {
    const d = diagnoseBookFolder("요", [
      file("John3_16.md"),
      file("요 3_16.md"),
      file("요3-16.md"),
      file("요3장16절.md"),
    ]);
    expect(d.directMd).toBe(4);
    expect(d.directMatches).toBe(0);
    expect(d.mismatchSamples).toEqual(["John3_16.md", "요 3_16.md", "요3-16.md"]);
  });

  it("깊이 초과형 — deepFiles 계수", () => {
    const d = diagnoseBookFolder("요", [file("요3_16.md", 5)]);
    expect(d.deepFiles).toBe(1);
    expect(d.nestedMatches).toBe(0);
  });

  it("NFD형 — nfdFixed 계수", () => {
    const d = diagnoseBookFolder("요", [file("요3_16.md".normalize("NFD"))]);
    expect(d.directMatches).toBe(1);
    expect(d.nfdFixed).toBe(1);
  });
});

describe("formatBookDiagnosis", () => {
  it("빈 폴더 → iCloud·OneDrive 동기화 안내", () => {
    const lines = formatBookDiagnosis("요한복음", "요", diagnoseBookFolder("요", []));
    expect(lines.join(" ")).toContain("iCloud");
    expect(lines.join(" ")).toContain("다운로드");
  });

  it("파일명 불일치 → 예시 파일명과 패키지 재설치 안내", () => {
    const d = diagnoseBookFolder("요", [file("John3_16.md")]);
    const lines = formatBookDiagnosis("요한복음", "요", d);
    expect(lines.join(" ")).toContain("John3_16.md");
    expect(lines.join(" ")).toContain("요1_1.md");
  });

  it("깊이 초과 → 폴더 구조 안내", () => {
    const d = diagnoseBookFolder("요", [file("요3_16.md", 5)]);
    expect(formatBookDiagnosis("요한복음", "요", d).join(" ")).toContain("깊은 폴더");
  });

  it("하위 폴더에서 발견 → 자동 인식 정보 라인", () => {
    const d = diagnoseBookFolder("요", [folder("사본", 1), file("요3_16.md", 2)]);
    expect(formatBookDiagnosis("요한복음", "요", d).join(" ")).toContain("자동으로 인식");
  });

  it("정상(직계 일치) → 안내 없음", () => {
    const d = diagnoseBookFolder("요", [file("요3_16.md")]);
    expect(formatBookDiagnosis("요한복음", "요", d)).toEqual([]);
  });
});
