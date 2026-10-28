import { describe, expect, it } from "vitest";
import {
  compareSermons,
  dateFromProperty,
  findDate,
  formatSermonDate,
  groupLabel,
  isYearFolder,
  labelColor,
  parseSermonName,
  sermonGroup,
} from "../src/sermon-meta";

const show = (name: string) => {
  const m = parseSermonName(name);
  return {
    date: m.date ? formatSermonDate(m.date) : undefined,
    title: m.title,
    passage: m.passage,
    tag: m.tag,
  };
};

/** show + 파일명 부서 */
const show2 = (name: string) => ({ ...show(name), dept: parseSermonName(name).dept });

describe("parseSermonName — 날짜_부서약자_제목_본문 규칙", () => {
  it("날짜·부서 약자·본문을 떼고 제목 구분자 _ 는 ' · '", () => {
    expect(show("260125_청_사도신경 강해10_죽으시고_고후8_9")).toEqual({
      date: "2026.01.25",
      title: "사도신경 강해10 · 죽으시고",
      passage: "고후 8:9",
      tag: undefined,
    });
  });

  it("절 범위·장만 있는 본문·시편은 '편'", () => {
    expect(show("250622_청_삶의 해석자_롬8_33-39").passage).toBe("롬 8:33-39");
    expect(show("260412_대_부활 설교_고전15")).toMatchObject({ title: "부활 설교", passage: "고전 15장" });
    expect(show("230101_청_목자 되신 하나님_시23").passage).toBe("시 23편");
  });

  it("끝의 소문자 꼬리표(hm·oc)는 따로 — 본문은 그 앞에서 읽는다", () => {
    expect(show("261025_대_하늘에 계신 우리 아버지_마6_9_hm")).toEqual({
      date: "2026.10.25",
      title: "하늘에 계신 우리 아버지",
      passage: "마 6:9",
      tag: "hm",
    });
  });

  it("본문 여러 개(· 연결)는 모두 읽는다", () => {
    expect(show("261018_어_살아가요, 하나님 나라!_요3_5·눅16_13·눅19_17")).toMatchObject({
      title: "살아가요, 하나님 나라!",
      passage: "요 3:5, 눅 16:13, 눅 19:17",
    });
  });

  it("본문 뒤 짧은 한글 꼬리표", () => {
    expect(show("260529_대_부활은 끝이 아니라 길이다_고전15_3-8_작업초안")).toEqual({
      date: "2026.05.29",
      title: "부활은 끝이 아니라 길이다",
      passage: "고전 15:3-8",
      tag: "작업초안",
    });
  });

  it("부서 약자가 둘째 칸이어도 뗀다 — 약자는 하나만", () => {
    expect(show("250414 설교_어_약속하신 성령님을 보내주셨어요.").title).toBe(
      "설교 · 약속하신 성령님을 보내주셨어요",
    );
    expect(show("260101_청_빛_요1_5")).toMatchObject({ title: "빛", passage: "요 1:5" });
  });

  it("66권 약자가 아니면 본문으로 보지 않는다 (제목에 남김, 숫자 사이 _ 유지)", () => {
    expect(show("250101_청_사랑의 편지_사랑1_2")).toMatchObject({
      title: "사랑의 편지 · 사랑1_2",
      passage: undefined,
    });
  });

  it("본문이 없는 이름", () => {
    expect(show("201114_청_역대기 개론")).toMatchObject({ title: "역대기 개론", passage: undefined });
    expect(show("260503_대_AI 시대의 신앙_5월 달에?").title).toBe("AI 시대의 신앙 · 5월 달에?");
  });
});

describe("parseSermonName — 다른 날짜 표기", () => {
  it("YYMMDD 뒤 공백", () => {
    expect(show("240728 주일설교 - 선하신 하나님")).toMatchObject({
      date: "2024.07.28",
      title: "주일설교 - 선하신 하나님",
    });
  });

  it("YYYY년 M월 D일", () => {
    expect(show("2024년 7월 14일 주일설교(대예배)")).toMatchObject({
      date: "2024.07.14",
      title: "주일설교(대예배)",
    });
  });

  it("YYMMDD일 (뒤에 붙은 '일'까지 뗀다)", () => {
    expect(show("231022일 어린이부 설교 - 엘리야")).toMatchObject({
      date: "2023.10.22",
      title: "어린이부 설교 - 엘리야",
    });
  });

  it("가운데 날짜 — 부서 약자로 보지 않고 꼬리표는 뗀다", () => {
    expect(show("죽음을-이긴-증거_260316_oc")).toEqual({
      date: "2026.03.16",
      title: "죽음을-이긴-증거",
      passage: undefined,
      tag: "oc",
    });
  });

  it("YYYY-MM-DD · YYYYMMDD", () => {
    expect(show("2026-10-25 주일 설교")).toMatchObject({ date: "2026.10.25", title: "주일 설교" });
    expect(show("20261025_설교")).toMatchObject({ date: "2026.10.25", title: "설교" });
  });

  it("날짜가 없거나 날짜가 될 수 없는 숫자는 그대로", () => {
    expect(show("요3_16 설교 준비")).toMatchObject({ date: undefined, title: "요3_16 설교 준비" });
    expect(show("2024 어린이부 설교목록")).toMatchObject({ date: undefined, title: "2024 어린이부 설교목록" });
    expect(show("123456 제목").date).toBeUndefined(); // 34월
  });

  it("날짜뿐인 이름은 원래 이름을 제목으로", () => {
    expect(show("260125")).toMatchObject({ date: "2026.01.25", title: "260125" });
  });

  it("자모 분리(NFD) 파일명도 읽는다", () => {
    expect(show("260125_청_은혜_롬5_8".normalize("NFD"))).toMatchObject({
      title: "은혜",
      passage: "롬 5:8",
    });
  });
});

describe("findDate · dateFromProperty", () => {
  it("6자리 연도 기준 — 50 이하는 2000년대", () => {
    expect(findDate("991231")?.date).toEqual({ y: 1999, m: 12, d: 31 });
    expect(findDate("191228")?.date).toEqual({ y: 2019, m: 12, d: 28 });
  });

  it("속성 값 — 문자열·시각 포함·숫자, 날짜 아님", () => {
    expect(dateFromProperty("2026-10-25")).toEqual({ y: 2026, m: 10, d: 25 });
    expect(dateFromProperty("2026-10-25T10:00")).toEqual({ y: 2026, m: 10, d: 25 });
    expect(dateFromProperty(20261025)).toEqual({ y: 2026, m: 10, d: 25 });
    expect(dateFromProperty("어제")).toBeUndefined();
    expect(dateFromProperty(undefined)).toBeUndefined();
    expect(dateFromProperty(["2026-10-25"])).toBeUndefined();
  });
});

describe("groupLabel · sermonGroup", () => {
  it("폴더 앞 번호 떼기 — 구분자 없는 숫자는 그대로", () => {
    expect(groupLabel("310. 청소년부")).toBe("청소년부");
    expect(groupLabel("03_청소년부")).toBe("청소년부");
    expect(groupLabel("2026")).toBe("2026");
    expect(groupLabel("1부 예배")).toBe("1부 예배");
  });

  it("설교 폴더 아래 분류 폴더가 부서", () => {
    const root = "300. Sermons";
    expect(sermonGroup("300. Sermons/310. 청소년부/2026/a.md", root)).toBe("청소년부");
    expect(sermonGroup("300. Sermons/330. 대예배/a.md", root)).toBe("대예배");
  });

  it("연도 폴더는 건너뛴다 — 연도/부서 순서여도 부서를 찾는다", () => {
    const root = "설교";
    expect(sermonGroup("설교/2025/청소년부/a.md", root)).toBe("청소년부");
    expect(sermonGroup("설교/2025년/a.md", root)).toBeUndefined();
    expect(isYearFolder("2025")).toBe(true);
    expect(isYearFolder("2025년도")).toBe(true);
    expect(isYearFolder("01. 2025")).toBe(true);
    expect(isYearFolder("2025 청소년부")).toBe(false);
  });

  it("분류 폴더가 없거나 설교 폴더를 지정하지 않으면 부서 없음 (빈칸)", () => {
    expect(sermonGroup("200. 설교/a.md", "200. 설교")).toBeUndefined();
    expect(sermonGroup("500. Writings/글/a.md", "")).toBeUndefined();
    expect(sermonGroup("다른 폴더/a.md", "200. 설교")).toBeUndefined();
  });
});

describe("parseSermonName — 파일명의 부서 표시 (폴더 부서가 없을 때 대신 쓴다)", () => {
  it("한 글자 약자 · '~부' · '~예배'", () => {
    expect(show2("260125_청_사도신경 강해_고후8_9")).toMatchObject({ dept: "청", title: "사도신경 강해" });
    expect(show2("190210_어린이부_말의 힘_시141_3")).toMatchObject({
      dept: "어린이부",
      title: "말의 힘",
      passage: "시 141:3",
    });
    expect(show2("260301_주일예배_감사의 삶")).toMatchObject({ dept: "주일예배", title: "감사의 삶" });
    expect(show2("250414 설교_어_성령님을 보내주셨어요")).toMatchObject({
      dept: "어",
      title: "설교 · 성령님을 보내주셨어요",
    });
  });

  it("뒤에 제목이 남지 않으면 부서가 아니라 제목 (260101_길_요14_6)", () => {
    expect(show2("260101_길_요14_6")).toMatchObject({ dept: undefined, title: "길", passage: "요 14:6" });
  });

  it("날짜로 시작하지 않으면 부서를 읽지 않는다", () => {
    expect(show2("26년_1월_어린이부_교사회의")).toMatchObject({
      dept: undefined,
      title: "26년 · 1월 · 어린이부 · 교사회의",
    });
    expect(show2("빛_사랑")).toMatchObject({ dept: undefined, title: "빛 · 사랑" });
  });
});

describe("규칙이 다른 이름 — 실패하지 않고 읽을 수 있는 것만", () => {
  it.each([
    ["Sunday Sermon - Grace", { title: "Sunday Sermon - Grace" }],
    ["63322924_File000006_1582134324 (2)", { date: undefined, title: "63322924 · File000006_1582134324 (2)" }],
    ["🎬 항상 기뻐하라_260401_oc", { date: "2026.04.01", title: "🎬 항상 기뻐하라", tag: "oc" }],
    ["___", { title: "___" }],
    ["", { title: "" }],
  ])("%s", (name, expected) => {
    expect(show2(name)).toMatchObject(expected);
  });
});

describe("labelColor", () => {
  it("이름이 같으면 같은 색, 범위 안", () => {
    expect(labelColor("청년부", 8)).toBe(labelColor("청년부", 8));
    for (const name of ["청", "어린이부", "주일예배", "Sermons"]) {
      const c = labelColor(name, 8);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(8);
    }
  });
});

describe("compareSermons — 최신순", () => {
  it("날짜 내림차순, 날짜 없는 노트는 맨 뒤, 같은 날은 제목 → 경로", () => {
    const item = (path: string) => ({ path, meta: parseSermonName(path.replace(/\.md$/, "")) });
    const sorted = [
      item("설교 준비.md"),
      item("200110_청_수련회_롬5_17.md"),
      item("261025_대_아버지_마6_9_hm.md"),
      item("261025_대_아버지_마6_9.md"),
      item("260125_청_강해_고후8_9.md"),
    ]
      .sort(compareSermons)
      .map((i) => i.path);
    expect(sorted).toEqual([
      "261025_대_아버지_마6_9.md",
      "261025_대_아버지_마6_9_hm.md",
      "260125_청_강해_고후8_9.md",
      "200110_청_수련회_롬5_17.md",
      "설교 준비.md",
    ]);
  });
});
