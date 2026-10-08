import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractHeadingSection,
  extractVerseTexts,
  listQuoteTitles,
  stripAnnotations,
} from "../src/note-parser";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "fixtures", name), "utf-8");

describe("extractVerseTexts — 실제 볼트 노트", () => {
  it("요3_16.md: 5개 역본 전부 추출", () => {
    const texts = extractVerseTexts(fixture("요3_16.md"));
    expect(Object.keys(texts).sort()).toEqual(
      ["KJV", "NIV", "개역개정", "새번역", "쉬운성경"].sort(),
    );
    expect(texts["새번역"]).toContain("하나님이 세상을 이처럼 사랑하셔서");
    expect(texts["KJV"]).toContain("For God so loved the world");
  });

  it("시23_1.md: 소제목이 섞인 본문도 추출", () => {
    const texts = extractVerseTexts(fixture("시23_1.md"));
    expect(texts["새번역"]).toBeTruthy();
    expect(texts["개역개정"]).toBeTruthy();
  });

  it("창1_1.md: 보강 섹션(원어 핵심어 등)이 있어도 본문만 추출", () => {
    const texts = extractVerseTexts(fixture("창1_1.md"));
    expect(Object.keys(texts).length).toBe(5);
    expect(texts["개역개정"]).toContain("태초에 하나님이 천지를 창조하시니라");
    // 본문 섹션 밖의 텍스트가 섞여 들어오지 않아야 함
    for (const text of Object.values(texts)) {
      expect(text).not.toContain("##");
      expect(text).not.toContain("관련구절");
    }
  });
});

describe("stripAnnotations — 각주·소제목 정리", () => {
  it("소제목 <...> 제거", () => {
    expect(stripAnnotations("<다윗의 노래> 주는 나의 목자시니")).toBe("주는 나의 목자시니");
  });
  it("각주 마커 a) 제거", () => {
    expect(stripAnnotations("영생을 얻게 하려는 것이다. g) 본문")).toBe(
      "영생을 얻게 하려는 것이다. 본문",
    );
  });
  it("각주 본문 (a. ...) 제거", () => {
    expect(stripAnnotations("끝이다. (g. 해석자에 따라 15절에서 인용을 끝내기도 함)")).toBe(
      "끝이다.",
    );
  });
  it("일반 영문 본문은 훼손하지 않음", () => {
    const kjv = "For God so loved the world, that he gave his only begotten Son";
    expect(stripAnnotations(kjv)).toBe(kjv);
  });
  it("복합 케이스", () => {
    expect(stripAnnotations("<천지창조> a) 태초에 (a. 또는 창조하실 때에) 하나님이")).toBe(
      "태초에 하나님이",
    );
  });
});

describe("extractHeadingSection — 미리보기용 섹션 슬라이스", () => {
  const md = `# 제목

## 3:1-8 - 니고데모
내용 A
### 소스별 핵심
내용 A2

## 3:14-17 - 하나님의 사랑
내용 B

## 3:18-21 - 빛과 어두움
내용 C
`;

  it("헤딩부터 다음 같은 레벨 헤딩 전까지", () => {
    const out = extractHeadingSection(md, "3:14-17 - 하나님의 사랑");
    expect(out).toContain("내용 B");
    expect(out).not.toContain("내용 A");
    expect(out).not.toContain("내용 C");
  });

  it("하위 헤딩(###)은 섹션에 포함", () => {
    const out = extractHeadingSection(md, "3:1-8 - 니고데모");
    expect(out).toContain("내용 A2");
    expect(out).not.toContain("내용 B");
  });

  it("마지막 섹션은 끝까지", () => {
    const out = extractHeadingSection(md, "3:18-21 - 빛과 어두움");
    expect(out).toContain("내용 C");
  });

  it("헤딩을 못 찾으면 전체 반환", () => {
    expect(extractHeadingSection(md, "없는 헤딩")).toBe(md);
  });
});

describe("extractVerseTexts — 엣지 케이스", () => {
  it("본문 섹션이 없으면 빈 객체", () => {
    expect(extractVerseTexts("# 제목\n\n내용")).toEqual({});
  });

  it("역본 일부 누락 시 있는 것만", () => {
    const content = `## 📜 본문

> [!quote] 새번역
> 본문입니다.

> [!quote] NIV
> The text.
`;
    const texts = extractVerseTexts(content);
    expect(texts["새번역"]).toBe("본문입니다.");
    expect(texts["NIV"]).toBe("The text.");
    expect(texts["개역개정"]).toBeUndefined();
  });

  it("여러 줄 콜아웃은 개행 유지로 수집", () => {
    const content = `## 📜 본문

> [!quote] 새번역
> 첫 줄
> 둘째 줄
`;
    expect(extractVerseTexts(content)["새번역"]).toBe("첫 줄\n둘째 줄");
  });

  it("등록되지 않은 제목의 콜아웃도 제목 그대로 추출 (역본 필터는 설정 목록이 담당)", () => {
    const content = `## 📜 본문

> [!quote] 개역한글
> 옛 역본 본문

> [!quote] 새번역
> 유효한 본문
`;
    const texts = extractVerseTexts(content);
    expect(texts["새번역"]).toBe("유효한 본문");
    expect(texts["개역한글"]).toBe("옛 역본 본문");
    expect(Object.keys(texts)).toEqual(["개역한글", "새번역"]);
  });

  it("다음 헤딩 이후 콜아웃은 무시", () => {
    const content = `## 📜 본문

> [!quote] 새번역
> 본문

## 🔗 관련구절

> [!quote] NIV
> 이건 본문 아님
`;
    const texts = extractVerseTexts(content);
    expect(texts["새번역"]).toBe("본문");
    expect(texts["NIV"]).toBeUndefined();
  });
});

describe("extractVerseTexts — 제목 무관 파서", () => {
  const wrap = (body: string) => `## 📜 본문\n\n${body}`;

  it("제목은 NFC로 정규화하고 앞뒤·연속 공백을 정리한다 (자모 분리 제목도 같은 키)", () => {
    const nfd = "새번역".normalize("NFD");
    const texts = extractVerseTexts(wrap(`> [!quote]   ${nfd}  \n> 본문\n`));
    expect(texts["새번역"]).toBe("본문");
  });

  it("대소문자는 구분한다 (niv ≠ NIV)", () => {
    const texts = extractVerseTexts(wrap(`> [!quote] niv\n> lower\n`));
    expect(texts["niv"]).toBe("lower");
    expect(texts["NIV"]).toBeUndefined();
  });

  it("접힘 표시 [!quote]+ / [!quote]- 와 대문자 QUOTE 허용", () => {
    const texts = extractVerseTexts(
      wrap(`> [!quote]+ 새번역\n> 펼침\n\n> [!quote]- NIV\n> folded\n\n> [!QUOTE] KJV\n> upper\n`),
    );
    expect(texts).toEqual({ 새번역: "펼침", NIV: "folded", KJV: "upper" });
  });

  it("공백 없는 >[!quote]NIV 도 인식", () => {
    expect(extractVerseTexts(wrap(`>[!quote]NIV\n>text\n`))["NIV"]).toBe("text");
  });

  it("빈 줄 없이 이어진 콜아웃은 앞 콜아웃에 흡수되지 않는다", () => {
    const texts = extractVerseTexts(wrap(`> [!quote] 새번역\n> 첫 본문\n> [!quote] ESV\n> second\n`));
    expect(texts["새번역"]).toBe("첫 본문");
    expect(texts["ESV"]).toBe("second");
  });

  it("CRLF 줄바꿈도 \\r 없이 수집", () => {
    const texts = extractVerseTexts(
      `## 📜 본문\r\n\r\n> [!quote] 새번역\r\n> 첫 줄\r\n> 둘째 줄\r\n`,
    );
    expect(texts["새번역"]).toBe("첫 줄\n둘째 줄");
  });

  it("제목 없는 콜아웃과 본문 없는 콜아웃은 제외", () => {
    const texts = extractVerseTexts(
      wrap(`> [!quote]\n> 제목 없음\n\n> [!quote] ESV\n\n> [!quote] NIV\n> ok\n`),
    );
    expect(Object.keys(texts)).toEqual(["NIV"]);
  });
});

describe("listQuoteTitles — 본문 섹션의 콜아웃 제목", () => {
  it("등장 순서대로, 중복 제거, 본문이 비어도 포함, 다른 섹션은 제외", () => {
    const titles = listQuoteTitles(
      `## 📜 본문\n\n> [!quote] 새번역\n> a\n\n> [!quote] ESV\n\n> [!quote] 새번역\n> b\n\n## 🧠 원어 핵심어\n\n> [!quote] 헬라어\n> x\n`,
    );
    expect(titles).toEqual(["새번역", "ESV"]);
  });

  it("본문 섹션이 없으면 빈 배열", () => {
    expect(listQuoteTitles("# 제목\n\n> [!quote] NIV\n> x")).toEqual([]);
  });

  it("실제 노트(요3_16.md)는 기본 5역본 제목", () => {
    expect(listQuoteTitles(fixture("요3_16.md"))).toEqual([
      "새번역",
      "개역개정",
      "쉬운성경",
      "NIV",
      "KJV",
    ]);
  });
});
