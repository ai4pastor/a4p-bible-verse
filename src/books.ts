/**
 * 성경 66권 정적 테이블.
 * abbrev/folderName은 실제 볼트 파일명·폴더명과 전수 대조해 확정한 값이므로
 * 임의로 수정하면 구절 조회가 깨진다.
 */
export interface BookInfo {
  /** 구절 파일명 약자 (예: "요", "고전", "요일") */
  abbrev: string;
  /** 표시용 정식 이름 — 볼트 폴더명과 동일 */
  name: string;
  testament: "구약" | "신약";
  /** 정경 순서 (폴더명 NN 접두어와 동일) */
  order: number;
  /** 입력 파싱용 추가 별칭 */
  aliases: string[];
}

export const BOOKS: BookInfo[] = [
  // 구약
  { abbrev: "창", name: "창세기", testament: "구약", order: 1, aliases: [] },
  { abbrev: "출", name: "출애굽기", testament: "구약", order: 2, aliases: [] },
  { abbrev: "레", name: "레위기", testament: "구약", order: 3, aliases: [] },
  { abbrev: "민", name: "민수기", testament: "구약", order: 4, aliases: [] },
  { abbrev: "신", name: "신명기", testament: "구약", order: 5, aliases: [] },
  { abbrev: "수", name: "여호수아", testament: "구약", order: 6, aliases: [] },
  { abbrev: "삿", name: "사사기", testament: "구약", order: 7, aliases: [] },
  { abbrev: "룻", name: "룻기", testament: "구약", order: 8, aliases: [] },
  { abbrev: "삼상", name: "사무엘상", testament: "구약", order: 9, aliases: [] },
  { abbrev: "삼하", name: "사무엘하", testament: "구약", order: 10, aliases: [] },
  { abbrev: "왕상", name: "열왕기상", testament: "구약", order: 11, aliases: [] },
  { abbrev: "왕하", name: "열왕기하", testament: "구약", order: 12, aliases: [] },
  { abbrev: "대상", name: "역대상", testament: "구약", order: 13, aliases: [] },
  { abbrev: "대하", name: "역대하", testament: "구약", order: 14, aliases: [] },
  { abbrev: "스", name: "에스라", testament: "구약", order: 15, aliases: [] },
  { abbrev: "느", name: "느헤미야", testament: "구약", order: 16, aliases: [] },
  { abbrev: "에", name: "에스더", testament: "구약", order: 17, aliases: [] },
  { abbrev: "욥", name: "욥기", testament: "구약", order: 18, aliases: [] },
  { abbrev: "시", name: "시편", testament: "구약", order: 19, aliases: [] },
  { abbrev: "잠", name: "잠언", testament: "구약", order: 20, aliases: [] },
  { abbrev: "전", name: "전도서", testament: "구약", order: 21, aliases: [] },
  { abbrev: "아", name: "아가", testament: "구약", order: 22, aliases: [] },
  { abbrev: "사", name: "이사야", testament: "구약", order: 23, aliases: [] },
  { abbrev: "렘", name: "예레미야", testament: "구약", order: 24, aliases: [] },
  { abbrev: "애", name: "예레미야애가", testament: "구약", order: 25, aliases: ["애가"] },
  { abbrev: "겔", name: "에스겔", testament: "구약", order: 26, aliases: [] },
  { abbrev: "단", name: "다니엘", testament: "구약", order: 27, aliases: [] },
  { abbrev: "호", name: "호세아", testament: "구약", order: 28, aliases: [] },
  { abbrev: "욜", name: "요엘", testament: "구약", order: 29, aliases: [] },
  { abbrev: "암", name: "아모스", testament: "구약", order: 30, aliases: [] },
  { abbrev: "옵", name: "오바댜", testament: "구약", order: 31, aliases: [] },
  { abbrev: "욘", name: "요나", testament: "구약", order: 32, aliases: [] },
  { abbrev: "미", name: "미가", testament: "구약", order: 33, aliases: [] },
  { abbrev: "나", name: "나훔", testament: "구약", order: 34, aliases: [] },
  { abbrev: "합", name: "하박국", testament: "구약", order: 35, aliases: [] },
  { abbrev: "습", name: "스바냐", testament: "구약", order: 36, aliases: [] },
  { abbrev: "학", name: "학개", testament: "구약", order: 37, aliases: [] },
  { abbrev: "슥", name: "스가랴", testament: "구약", order: 38, aliases: [] },
  { abbrev: "말", name: "말라기", testament: "구약", order: 39, aliases: [] },
  // 신약
  { abbrev: "마", name: "마태복음", testament: "신약", order: 1, aliases: [] },
  { abbrev: "막", name: "마가복음", testament: "신약", order: 2, aliases: [] },
  { abbrev: "눅", name: "누가복음", testament: "신약", order: 3, aliases: [] },
  { abbrev: "요", name: "요한복음", testament: "신약", order: 4, aliases: [] },
  { abbrev: "행", name: "사도행전", testament: "신약", order: 5, aliases: [] },
  { abbrev: "롬", name: "로마서", testament: "신약", order: 6, aliases: [] },
  { abbrev: "고전", name: "고린도전서", testament: "신약", order: 7, aliases: [] },
  { abbrev: "고후", name: "고린도후서", testament: "신약", order: 8, aliases: [] },
  { abbrev: "갈", name: "갈라디아서", testament: "신약", order: 9, aliases: [] },
  { abbrev: "엡", name: "에베소서", testament: "신약", order: 10, aliases: [] },
  { abbrev: "빌", name: "빌립보서", testament: "신약", order: 11, aliases: [] },
  { abbrev: "골", name: "골로새서", testament: "신약", order: 12, aliases: [] },
  { abbrev: "살전", name: "데살로니가전서", testament: "신약", order: 13, aliases: [] },
  { abbrev: "살후", name: "데살로니가후서", testament: "신약", order: 14, aliases: [] },
  { abbrev: "딤전", name: "디모데전서", testament: "신약", order: 15, aliases: [] },
  { abbrev: "딤후", name: "디모데후서", testament: "신약", order: 16, aliases: [] },
  { abbrev: "딛", name: "디도서", testament: "신약", order: 17, aliases: [] },
  { abbrev: "몬", name: "빌레몬서", testament: "신약", order: 18, aliases: [] },
  { abbrev: "히", name: "히브리서", testament: "신약", order: 19, aliases: [] },
  { abbrev: "약", name: "야고보서", testament: "신약", order: 20, aliases: [] },
  { abbrev: "벧전", name: "베드로전서", testament: "신약", order: 21, aliases: [] },
  { abbrev: "벧후", name: "베드로후서", testament: "신약", order: 22, aliases: [] },
  { abbrev: "요일", name: "요한1서", testament: "신약", order: 23, aliases: ["요한일서"] },
  { abbrev: "요이", name: "요한2서", testament: "신약", order: 24, aliases: ["요한이서"] },
  { abbrev: "요삼", name: "요한3서", testament: "신약", order: 25, aliases: ["요한삼서"] },
  { abbrev: "유", name: "유다서", testament: "신약", order: 26, aliases: [] },
  { abbrev: "계", name: "요한계시록", testament: "신약", order: 27, aliases: ["계시록"] },
];

export const BOOK_BY_ABBREV = new Map(BOOKS.map((b) => [b.abbrev, b]));

/** 입력 토큰(약자·정식명·별칭) → BookInfo. 최장 일치를 위해 길이 내림차순 정렬. */
export const BOOK_TOKENS: Array<[string, BookInfo]> = BOOKS.flatMap((b) =>
  [b.abbrev, b.name, ...b.aliases].map((t): [string, BookInfo] => [t, b]),
).sort((a, b) => b[0].length - a[0].length);

/** 폴더명(NN 접두어 제거 후)으로 책 찾기 */
export function bookByFolderName(folderName: string): BookInfo | undefined {
  const stripped = folderName.replace(/^\d+\./, "").trim();
  return BOOKS.find((b) => b.name === stripped || b.aliases.includes(stripped));
}
