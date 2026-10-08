import { describe, expect, it } from "vitest";
import {
  DEFAULT_VERSIONS,
  VersionDef,
  cloneDefaultVersions,
  isDefaultVersionList,
  normalizeVersionName,
  sanitizeVersionSettings,
  shortLabel,
  versionNames,
} from "../src/versions";

const base = () => ({
  versions: cloneDefaultVersions(),
  defaultVersion: "새번역",
  parallelVersions: ["새번역", "NIV"] as [string, string],
  other: "그대로",
});

describe("normalizeVersionName", () => {
  it("NFC 정규화 + 앞뒤 공백 제거 + 연속 공백 1칸", () => {
    expect(normalizeVersionName("  새번역 ")).toBe("새번역");
    expect(normalizeVersionName("새번역".normalize("NFD"))).toBe("새번역");
    expect(normalizeVersionName("현대인의   성경")).toBe("현대인의 성경");
  });
  it("문자열이 아니면 빈 문자열", () => {
    expect(normalizeVersionName(undefined)).toBe("");
    expect(normalizeVersionName(3)).toBe("");
  });
});

describe("shortLabel / versionNames / isDefaultVersionList", () => {
  it("짧은 이름이 없으면 이름 그대로", () => {
    expect(shortLabel({ name: "NIV" })).toBe("NIV");
    expect(shortLabel({ name: "개역개정", short: "개역" })).toBe("개역");
  });
  it("기본 5역본 이름 순서", () => {
    expect(versionNames(DEFAULT_VERSIONS)).toEqual(["새번역", "개역개정", "쉬운성경", "NIV", "KJV"]);
  });
  it("기본 목록 판정은 이름·순서·짧은 이름까지 본다", () => {
    expect(isDefaultVersionList(cloneDefaultVersions())).toBe(true);
    expect(isDefaultVersionList([...cloneDefaultVersions(), { name: "ESV" }])).toBe(false);
    expect(isDefaultVersionList(cloneDefaultVersions().reverse())).toBe(false);
    const renamedShort = cloneDefaultVersions();
    renamedShort[1].short = "개정";
    expect(isDefaultVersionList(renamedShort)).toBe(false);
  });
});

describe("sanitizeVersionSettings", () => {
  it("유효한 설정은 값이 그대로이고 fixes가 비어 있다", () => {
    const { settings, fixes } = sanitizeVersionSettings(base());
    expect(settings.versions).toEqual(DEFAULT_VERSIONS);
    expect(settings.defaultVersion).toBe("새번역");
    expect(settings.parallelVersions).toEqual(["새번역", "NIV"]);
    expect(settings.other).toBe("그대로");
    expect(fixes).toEqual({});
  });

  it("항상 새 배열·튜플·항목 객체를 돌려준다 (기본값 공유 차단)", () => {
    const input = base();
    const { settings } = sanitizeVersionSettings(input);
    expect(settings.versions).not.toBe(input.versions);
    expect(settings.versions).not.toBe(DEFAULT_VERSIONS);
    expect(settings.versions[0]).not.toBe(input.versions[0]);
    expect(settings.parallelVersions).not.toBe(input.parallelVersions);
  });

  it("빈 목록이나 배열이 아닌 값은 기본 5역본으로", () => {
    expect(sanitizeVersionSettings({ ...base(), versions: [] }).settings.versions).toEqual(
      DEFAULT_VERSIONS,
    );
    const broken = { ...base(), versions: undefined as unknown as VersionDef[] };
    expect(sanitizeVersionSettings(broken).settings.versions).toEqual(DEFAULT_VERSIONS);
  });

  it("문자열 항목 허용, 빈 이름·쓰레기 항목 제거, 이름 정규화", () => {
    const messy = [
      "  ESV ",
      { name: " 새번역".normalize("NFD") },
      { name: "" },
      42,
      null,
      { short: "x" },
    ] as unknown as VersionDef[];
    const { settings } = sanitizeVersionSettings({ ...base(), versions: messy });
    expect(settings.versions).toEqual([{ name: "ESV" }, { name: "새번역" }]);
  });

  it("중복 이름은 앞 것만 남긴다", () => {
    const { settings } = sanitizeVersionSettings({
      ...base(),
      versions: [{ name: "NIV", short: "N" }, { name: "NIV " }, { name: "KJV" }],
    });
    expect(settings.versions).toEqual([{ name: "NIV", short: "N" }, { name: "KJV" }]);
  });

  it("짧은 이름이 비거나 이름과 같으면 제거, 아니면 정규화해 유지", () => {
    const { settings } = sanitizeVersionSettings({
      ...base(),
      versions: [
        { name: "NIV", short: " " },
        { name: "KJV", short: "KJV" },
        { name: "개역개정", short: " 개역 " },
      ],
    });
    expect(settings.versions).toEqual([
      { name: "NIV" },
      { name: "KJV" },
      { name: "개역개정", short: "개역" },
    ]);
  });

  it("기본 역본이 목록에 없으면 첫 항목으로 보정하고 fixes에 보고", () => {
    const { settings, fixes } = sanitizeVersionSettings({ ...base(), defaultVersion: "ESV" });
    expect(settings.defaultVersion).toBe("새번역");
    expect(fixes.defaultVersion).toBe("새번역");
  });

  it("병렬 쌍: 목록 밖 멤버는 보정, 같은 역본 둘은 서로 다르게", () => {
    const a = sanitizeVersionSettings({ ...base(), parallelVersions: ["새번역", "ESV"] });
    expect(a.settings.parallelVersions).toEqual(["새번역", "개역개정"]);
    expect(a.fixes.parallelVersions).toEqual(["새번역", "개역개정"]);

    const b = sanitizeVersionSettings({ ...base(), parallelVersions: ["NIV", "NIV"] });
    expect(b.settings.parallelVersions).toEqual(["NIV", "새번역"]);

    // 주 역본이 목록에 없으면 기본 역본으로
    const c = sanitizeVersionSettings({ ...base(), parallelVersions: ["ESV", "KJV"] });
    expect(c.settings.parallelVersions).toEqual(["새번역", "KJV"]);
  });

  it("역본이 1개면 병렬 쌍은 둘 다 같은 값", () => {
    const { settings, fixes } = sanitizeVersionSettings({
      ...base(),
      versions: [{ name: "새번역" }],
      parallelVersions: ["새번역", "NIV"],
    });
    expect(settings.parallelVersions).toEqual(["새번역", "새번역"]);
    expect(fixes.parallelVersions).toEqual(["새번역", "새번역"]);
  });

  it("멱등 — 두 번 적용해도 같고 두 번째 fixes는 비어 있다", () => {
    const messy = {
      ...base(),
      versions: ["ESV", { name: "NIV", short: "NIV" }] as unknown as VersionDef[],
      defaultVersion: "KJV",
      parallelVersions: ["x", "y"] as [string, string],
    };
    const once = sanitizeVersionSettings(messy);
    const twice = sanitizeVersionSettings(once.settings);
    expect(once.settings.versions).toEqual([{ name: "ESV" }, { name: "NIV" }]);
    expect(once.settings.defaultVersion).toBe("ESV");
    expect(once.settings.parallelVersions).toEqual(["ESV", "NIV"]);
    expect(twice.settings).toEqual(once.settings);
    expect(twice.fixes).toEqual({});
  });
});
