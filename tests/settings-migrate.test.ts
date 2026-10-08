import { describe, expect, it } from "vitest";
// settings.ts는 obsidian을 import하므로 여기서 값은 못 가져온다 — 타입만 사용
import type { BibleVerseSettings } from "../src/settings";
import { SETTINGS_VERSION, migrateSettings } from "../src/settings-migrate";
import { DEFAULT_VERSIONS, cloneDefaultVersions } from "../src/versions";

const BIBLE = "100. notes/170. 성경";

/** v1(0.7 이하) data.json 형태 — 단일 biblePath, otPath/ntPath 없음(로드 시 ""로 채워짐) */
function v1Settings(paths: Partial<BibleVerseSettings>): BibleVerseSettings {
  return {
    otPath: "",
    ntPath: "",
    biblePath: BIBLE,
    versions: cloneDefaultVersions(),
    defaultVersion: "새번역",
    insertFormat: "callout",
    verseNewline: true,
    enableSuggest: true,
    suggestTrigger: ";;",
    parallelTrigger: ";;;",
    parallelVersions: ["새번역", "NIV"],
    sermonFolder: "300. Sermons",
    stripAnnotations: false,
    commentaryPath: "171. 성경주석",
    keywordSearchScope: "current",
    enableKeywordSearch: true,
    ...paths,
  };
}

describe("migrateSettings", () => {
  it("단일 biblePath 아래 구약/신약 폴더가 있으면 각각 파생한다", () => {
    const { settings, changed } = migrateSettings(v1Settings({}), 1, {
      folderExists: (p) => p === `${BIBLE}/구약` || p === `${BIBLE}/신약`,
    });
    expect(changed).toBe(true);
    expect(settings.otPath).toBe(`${BIBLE}/구약`);
    expect(settings.ntPath).toBe(`${BIBLE}/신약`);
    expect(settings.biblePath).toBeUndefined();
  });

  it("구약/신약 폴더가 없으면 두 필드 모두 기존 루트를 가리킨다", () => {
    const { settings, changed } = migrateSettings(v1Settings({}), 1, {
      folderExists: () => false,
    });
    expect(changed).toBe(true);
    expect(settings.otPath).toBe(BIBLE);
    expect(settings.ntPath).toBe(BIBLE);
  });

  it("상대 주석 경로를 성경 폴더 하위 절대경로로 승격한다", () => {
    const { settings } = migrateSettings(v1Settings({}), 1, {
      folderExists: (p) => p === `${BIBLE}/171. 성경주석`,
    });
    expect(settings.commentaryPath).toBe(`${BIBLE}/171. 성경주석`);
  });

  it("볼트 루트에 동명 폴더가 있으면 주석 경로를 승격하지 않는다", () => {
    const { settings } = migrateSettings(v1Settings({}), 1, {
      folderExists: (p) => p === "171. 성경주석" || p === `${BIBLE}/171. 성경주석`,
    });
    expect(settings.commentaryPath).toBe("171. 성경주석");
  });

  it("v2(단일 biblePath, 절대 주석 경로)도 구약/신약으로 분리한다", () => {
    const { settings, changed } = migrateSettings(
      v1Settings({ commentaryPath: `${BIBLE}/171. 성경주석` }),
      2,
      { folderExists: (p) => p === `${BIBLE}/구약` || p === `${BIBLE}/신약` },
    );
    expect(changed).toBe(true);
    expect(settings.otPath).toBe(`${BIBLE}/구약`);
    expect(settings.ntPath).toBe(`${BIBLE}/신약`);
    expect(settings.commentaryPath).toBe(`${BIBLE}/171. 성경주석`);
  });

  it("경로 정규화가 적용된다", () => {
    const { settings, changed } = migrateSettings(
      v1Settings({ biblePath: `/${BIBLE}/`, commentaryPath: "" }),
      1,
      { folderExists: () => false },
    );
    expect(changed).toBe(true);
    expect(settings.otPath).toBe(BIBLE);
  });

  it("이미 최신 버전이면 아무것도 하지 않는다", () => {
    const input = v1Settings({});
    const { settings, changed } = migrateSettings(input, SETTINGS_VERSION, {
      folderExists: () => true,
    });
    expect(changed).toBe(false);
    expect(settings).toBe(input);
  });

  it("빈 경로 설정은 그대로 통과한다", () => {
    const { settings, changed } = migrateSettings(
      v1Settings({ biblePath: "", commentaryPath: "", sermonFolder: "" }),
      1,
      { folderExists: () => true },
    );
    expect(changed).toBe(false);
    expect(settings.otPath).toBe("");
    expect(settings.ntPath).toBe("");
  });
});

describe("migrateSettings — v4 역본 목록", () => {
  /** v3 data.json 형태 — versions 키가 없다 */
  function v3Settings(overrides: Partial<BibleVerseSettings>): BibleVerseSettings {
    const s = v1Settings({
      biblePath: undefined,
      otPath: `${BIBLE}/구약`,
      ntPath: `${BIBLE}/신약`,
      ...overrides,
    }) as Partial<BibleVerseSettings>;
    delete s.versions;
    return s as BibleVerseSettings;
  }
  const deps = { folderExists: () => true };

  it("versions가 없으면 기본 5역본을 새 배열로 채운다 (경로는 그대로 → changed=false)", () => {
    const { settings, changed } = migrateSettings(v3Settings({}), 3, deps);
    expect(changed).toBe(false);
    expect(settings.versions).toEqual(DEFAULT_VERSIONS);
    expect(settings.versions).not.toBe(DEFAULT_VERSIONS);
    expect(settings.otPath).toBe(`${BIBLE}/구약`);
  });

  it("목록에 없는 기본 역본은 첫 항목으로 보정", () => {
    const { settings } = migrateSettings(v3Settings({ defaultVersion: "ESV" }), 3, deps);
    expect(settings.defaultVersion).toBe("새번역");
  });

  it("같은 역본 둘인 병렬 쌍은 서로 다르게 보정", () => {
    const { settings } = migrateSettings(
      v3Settings({ parallelVersions: ["NIV", "NIV"] }),
      3,
      deps,
    );
    expect(settings.parallelVersions).toEqual(["NIV", "새번역"]);
  });

  it("v1 → v4 한 번에: 경로 분리와 역본 목록 채우기가 함께 된다", () => {
    const { settings, changed } = migrateSettings(v3Settings({ biblePath: BIBLE, otPath: "", ntPath: "" }), 1, {
      folderExists: (p) => p === `${BIBLE}/구약` || p === `${BIBLE}/신약`,
    });
    expect(changed).toBe(true);
    expect(settings.otPath).toBe(`${BIBLE}/구약`);
    expect(settings.versions).toEqual(DEFAULT_VERSIONS);
    expect(settings.biblePath).toBeUndefined();
  });

  it("이미 유효한 사용자 목록(순서·짧은 이름·추가 역본)은 그대로 둔다", () => {
    const custom = [{ name: "NIV" }, { name: "ESV", short: "E" }, { name: "새번역" }];
    const input = {
      ...v3Settings({ defaultVersion: "ESV", parallelVersions: ["ESV", "NIV"] }),
      versions: custom,
    };
    const { settings } = migrateSettings(input, 3, deps);
    expect(settings.versions).toEqual(custom);
    expect(settings.defaultVersion).toBe("ESV");
    expect(settings.parallelVersions).toEqual(["ESV", "NIV"]);
  });
});
