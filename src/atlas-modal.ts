/**
 * 설교 성경 지도 (v0.15) — 설교 폴더의 설교를 성경 66권 위에 펼쳐 보는 큰 창(모달).
 * 성경 구절 검색·삽입 모달처럼 명령으로 열고 Esc로 닫는다. 열 때마다 새로 계산한다(부팅 비용 0).
 * 계산은 순수 모듈 atlas.ts, 볼트에서 모으기는 bible-data `sermonAtlasInput`, 여기는 그리기만.
 *
 * - 보던 화면(부서·기준·기간·고른 책)은 플러그인이 기억해 다시 열면 그대로 보인다(옵시디언을 끄면 초기화).
 * - 목록은 「외 N개」로 줄이지 않는다 — 많을 때만 [더보기]로 펼치고 개수는 제목에 보인다.
 * - 정보가 없으면 오류 대신 빈칸·안내 (설교 폴더 미지정·없는 경로·부서 없음).
 * - 설교 줄을 누르면 창 오른쪽에 그 설교를 펼친다 — 성경구절 창의 「인용한 설교」 미리보기와 같은 모양.
 *   고른 책의 인용(절 링크 + 「창세기 22:1-18」 같은 글자 표기)을 강조하고 「창세기 인용 2/5」 ↑/↓로 옮겨 간다.
 *   [열기] = 창을 닫고 새 탭(지금 보는 인용 앞 소제목으로). 미리보기 안 링크 = 그 노트를 이어서 미리보기(← 로 복귀).
 */
import { App, Component, MarkdownRenderer, Modal, TFile, TFolder, setTooltip } from "obsidian";
import { BOOK_BY_ABBREV } from "./books";
import {
  CHAPTER_COUNT,
  GENRES,
  agoLabel,
  aggregate,
  bookMentionPattern,
  booksInGenre,
  buildSermons,
  departments,
  emptyBooksByGenre,
  filterSermons,
  findBookMentions,
  formatDateKey,
  heatLevel,
  lastByGenre,
  passageLabel,
  sermonsForBook,
  sinceKeyFor,
  summarize,
  type AtlasAggregate,
  type AtlasMode,
  type AtlasSermon,
} from "./atlas";
import { markCitations, nearestHeadingFor, renderCiteNav, stripFrontmatter } from "./cite-highlight";
import { formatReference, parseLinkTarget } from "./reference-parser";
import { groupLabel, isYearFolder, labelColor, type SermonDate } from "./sermon-meta";
import type BibleVersePlugin from "./main";

/** 책 설교 목록 — 이보다 많을 때만 앞부분을 보이고 나머지는 [더보기] */
const LIST_INITIAL = 10;
/** 본문 미상 목록 — 이보다 많을 때만 [더보기] */
const UNKNOWN_INITIAL = 8;
/** 부서 배지 색 수 — 「인용한 설교」(modal.ts)와 같은 팔레트 */
const GROUP_COLORS = 8;
/** 미리보기 안에서 링크를 따라간 단계 — 이보다 깊으면 가장 오래된 것부터 잊는다 */
const PREVIEW_STACK_MAX = 50;

export type AtlasPeriod = "all" | "3y" | "1y";

/** 다시 열 때 그대로 보여 줄 화면 상태 — 플러그인 인스턴스가 들고 있다(저장하지 않음) */
export interface AtlasViewState {
  dept: string;
  mode: AtlasMode;
  period: AtlasPeriod;
  book: string | null;
}

export const defaultAtlasState = (): AtlasViewState => ({ dept: "", mode: "main", period: "all", book: null });

/** 오른쪽 미리보기 한 화면 */
interface AtlasPreview {
  file: TFile;
  title: string;
  /** 인용 위치를 강조할 책(약자) — 책 목록에서 연 설교만. 본문 미상 설교·링크를 따라간 노트는 없음 */
  book?: string;
  /** 같은 설교로 묶인 노트(판) — 둘 이상이면 머리줄 아래 「판 1 · 판 2」로 바꿔 본다 */
  versions?: TFile[];
  /** 왼쪽 목록의 설교 줄(대표 노트 경로) — 다른 판을 보고 있어도 그 줄을 표시한다 */
  rowKey?: string;
}

function today(): SermonDate {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

export class SermonAtlasModal extends Modal {
  private sermons: AtlasSermon[] = [];
  private inputState: "unset" | "missing" | "ok" = "ok";
  private root = "";
  private colors = new Map<string, number>();
  private listOpen = false;
  private unknownOpen = false;

  /** 왼쪽 — 지도·책 상세·카드 (따로 스크롤) */
  private mainEl!: HTMLElement;
  /** 오른쪽 — 설교 미리보기 (설교 줄을 누르면 열림) */
  private previewEl!: HTMLElement;
  /** 미리보기 렌더링 생명주기 — 창이 닫히면 함께 내린다 */
  private previewComponent = new Component();
  /** 지금 미리보기를 그린 렌더 — 다음 미리보기로 바뀌면 내린다 */
  private renderChild: Component | null = null;
  private current: AtlasPreview | null = null;
  /** 미리보기 안 링크를 따라오기 전 화면들 — ←·Esc·마우스 뒤로가기로 한 단계씩 돌아간다 */
  private stack: AtlasPreview[] = [];
  /** 지금 가리키는 인용 블록 — [열기]가 그 앞 소제목으로 연다 */
  private citeCurrent: HTMLElement | null = null;
  /** 좁은 화면에서는 미리보기가 목록을 가린다 — 닫을 때 돌아갈 목록 스크롤 자리 */
  private scrollBeforePreview = 0;
  /** 미리보기 렌더 세대 — 렌더 중 다른 미리보기가 시작되면(연타·뒤로) 앞의 렌더는 버린다 */
  private renderToken = 0;
  /** 설교 줄 클릭 차례 — 판을 고르느라 기다리는 사이 다음 클릭이 오면 앞 클릭은 버린다 */
  private clickSeq = 0;

  constructor(
    app: App,
    private plugin: BibleVersePlugin,
  ) {
    super(app);
  }

  private get st(): AtlasViewState {
    return this.plugin.atlasState;
  }

  onOpen() {
    this.modalEl.addClass("bible-verse-atlas-modal");
    this.titleEl.setText("설교 성경 지도");
    this.contentEl.addClass("a4p-atlas");
    this.mainEl = this.contentEl.createDiv({ cls: "a4p-atlas-main" });
    this.previewEl = this.contentEl.createDiv({ cls: "bible-verse-preview a4p-atlas-preview" });
    this.previewComponent.load();
    // 성경구절 창처럼 ⌘[ · ⌘⌥← = 미리보기에서 한 단계 뒤로
    this.scope.register(["Mod"], "[", () => {
      if (this.current) this.goBack();
      return false;
    });
    this.scope.register(["Mod", "Alt"], "ArrowLeft", () => {
      if (this.current) this.goBack();
      return false;
    });
    this.reload();
  }

  onClose() {
    // 렌더 중이던 미리보기·판 고르던 클릭은 버린다
    this.renderToken++;
    this.clickSeq++;
    this.previewComponent.unload();
    this.contentEl.empty();
  }

  /**
   * Esc — 미리보기가 열려 있으면 한 단계 뒤로(따라간 링크 → 설교 → 닫기), 아니면 창을 닫는다.
   * 옵시디언 모달은 생성자에서 Esc를 이 메서드에 먼저 묶어 두므로, scope에 Esc를 더 등록하는 대신 이것을 바꾼다.
   */
  onEscapeKey(evt: KeyboardEvent) {
    if (evt.defaultPrevented) return;
    evt.preventDefault();
    if (this.current) this.goBack();
    else this.close();
  }

  /** 마우스 뒤로가기 단추 — Esc와 같다(옵시디언 설정 창의 하위 화면과 같은 방식) */
  onHistoryBack() {
    if (this.current) this.goBack();
    else this.close();
  }

  private reload() {
    const input = this.plugin.bibleData.sermonAtlasInput();
    this.inputState = input.state;
    this.root = input.root;
    this.sermons = buildSermons(input.notes);
    this.colors = this.groupColors(input.root);
    if (this.st.dept && !departments(this.sermons).includes(this.st.dept)) this.st.dept = "";
    this.render();
  }

  /** 폴더 부서 → 색 번호 — 「인용한 설교」와 같은 규칙(설교 폴더 아래 분류 폴더의 이름순 자리) */
  private groupColors(root: string): Map<string, number> {
    const colors = new Map<string, number>();
    const base = root ? this.app.vault.getAbstractFileByPath(root) : null;
    if (!(base instanceof TFolder)) return colors;
    const names: string[] = [];
    for (const child of base.children) {
      if (!(child instanceof TFolder)) continue;
      if (!isYearFolder(child.name)) names.push(child.name);
      else for (const sub of child.children) if (sub instanceof TFolder) names.push(sub.name);
    }
    for (const name of names.sort()) {
      const label = groupLabel(name);
      if (!colors.has(label)) colors.set(label, colors.size % GROUP_COLORS);
    }
    return colors;
  }

  private render() {
    const el = this.mainEl;
    const scroll = el.scrollTop;
    el.empty();
    if (this.inputState !== "ok" || this.sermons.length === 0) {
      this.renderEmptyState(el);
      return;
    }

    const st = this.st;
    const now = today();
    const depts = departments(this.sermons);
    const list = filterSermons(this.sermons, {
      dept: st.dept || undefined,
      mode: st.mode,
      sinceKey: st.period === "all" ? undefined : sinceKeyFor(st.period === "3y" ? 3 : 1, now),
    });
    const agg = aggregate(list, st.mode);

    const controls = el.createDiv({ cls: "a4p-atlas-controls" });
    if (depts.length > 0) {
      const opts: Array<[string, string]> = [["", "전체"], ...depts.map((d): [string, string] => [d, d])];
      this.segment(controls, "부서", opts, st.dept, (v) => {
        st.dept = v;
        this.listOpen = false;
        this.render();
      });
    }
    this.segment(
      controls,
      "기준",
      [
        ["main", "주 본문"],
        ["all", "인용 포함"],
      ],
      st.mode,
      (v) => {
        st.mode = v as AtlasMode;
        this.listOpen = false;
        this.render();
      },
    );
    this.segment(
      controls,
      "기간",
      [
        ["all", "전체"],
        ["3y", "최근 3년"],
        ["1y", "최근 1년"],
      ],
      st.period,
      (v) => {
        st.period = v as AtlasPeriod;
        this.listOpen = false;
        this.render();
      },
    );

    const sum = summarize(list, agg);
    const summary = el.createDiv({ cls: "a4p-atlas-summary" });
    this.chip(summary, "설교 ", `${sum.sermons}`, "편");
    this.chip(summary, "주 본문 있음 ", `${sum.withMain}`, "편");
    this.chip(summary, "66권 중 ", `${sum.coveredBooks}`, "권");
    if (sum.otShare + sum.ntShare > 0) this.chip(summary, "구약 ", `${sum.otShare}%`, ` · 신약 ${sum.ntShare}%`);
    if (sum.unknown > 0) this.chip(summary, "본문 미상 ", `${sum.unknown}`, "편", true);

    this.renderGrid(el, agg);
    this.renderDetail(el, list, agg);
    this.renderCards(el, list, agg, now);
    this.syncActive();
    // 단추를 눌러 다시 그려도 보던 자리를 지킨다
    el.scrollTop = scroll;
  }

  private renderEmptyState(el: HTMLElement) {
    const box = el.createDiv({ cls: "a4p-atlas-empty" });
    if (this.inputState === "unset") {
      box.createEl("p", {
        text: "설정 → A4P 성경구절 → 「설교 폴더」를 지정하면, 지금까지의 설교가 성경 66권 지도 위에 그려집니다.",
      });
    } else if (this.inputState === "missing") {
      box.createEl("p", {
        text: `설교 폴더를 찾을 수 없습니다: "${this.root}" — 설정에서 폴더를 다시 골라 주세요.`,
      });
    } else {
      box.createEl("p", { text: `설교 폴더 "${this.root}"에 노트가 없습니다.` });
    }
    box.createEl("p", {
      cls: "a4p-atlas-hint",
      text: "설교 노트 이름 끝에 본문(예: 260125_청_제목_요3_16)을 붙이면 그 본문 자리에 설교가 표시됩니다.",
    });
  }

  private segment(
    parent: HTMLElement,
    label: string,
    options: Array<[string, string]>,
    current: string,
    onPick: (value: string) => void,
  ) {
    const wrap = parent.createDiv({ cls: "a4p-atlas-control" });
    wrap.createSpan({ cls: "a4p-atlas-control-label", text: label });
    const seg = wrap.createDiv({ cls: "a4p-atlas-seg" });
    for (const [value, text] of options) {
      const active = value === current;
      const b = seg.createEl("button", { text, cls: active ? "is-active" : undefined });
      b.setAttr("aria-pressed", String(active));
      b.addEventListener("click", () => onPick(value));
    }
  }

  private chip(parent: HTMLElement, before: string, strong: string, after: string, warn = false) {
    const c = parent.createSpan({ cls: warn ? "a4p-atlas-chip is-warn" : "a4p-atlas-chip" });
    c.appendText(before);
    c.createEl("b", { text: strong });
    c.appendText(after);
  }

  private renderGrid(el: HTMLElement, agg: AtlasAggregate) {
    const max = Math.max(0, ...agg.books.values());
    const grid = el.createDiv({ cls: "a4p-atlas-grid" });
    for (const testament of ["구약", "신약"] as const) {
      const col = grid.createDiv({ cls: "a4p-atlas-testament" });
      col.createDiv({ cls: "a4p-atlas-testament-title", text: testament });
      for (const genre of GENRES.filter((g) => g.testament === testament)) {
        const row = col.createDiv({ cls: "a4p-atlas-genre" });
        row.createDiv({ cls: "a4p-atlas-genre-name", text: genre.name });
        const cells = row.createDiv({ cls: "a4p-atlas-cells" });
        for (const book of booksInGenre(genre)) {
          const count = agg.books.get(book.abbrev) ?? 0;
          const cls = ["a4p-atlas-cell", `is-l${heatLevel(count, max)}`];
          if (this.st.book === book.abbrev) cls.push("is-selected");
          const cell = cells.createEl("button", { cls: cls.join(" ") });
          cell.createSpan({ cls: "a4p-atlas-cell-abbrev", text: book.abbrev });
          if (count) cell.createSpan({ cls: "a4p-atlas-cell-count", text: String(count) });
          const last = agg.last.get(book.abbrev);
          setTooltip(cell, `${book.name} — 설교 ${count}편${last ? ` · 마지막 ${formatDateKey(last)}` : ""}`);
          cell.addEventListener("click", () => {
            this.st.book = this.st.book === book.abbrev ? null : book.abbrev;
            this.listOpen = false;
            this.render();
          });
        }
      }
    }
    const legend = el.createDiv({ cls: "a4p-atlas-legend" });
    legend.createSpan({ text: "설교 수" });
    for (let i = 0; i <= 4; i++) legend.createSpan({ cls: `a4p-atlas-swatch is-l${i}` });
    legend.createSpan({ text: "많음 · 책 칸을 누르면 장과 설교 목록이 열립니다" });
  }

  private renderDetail(el: HTMLElement, list: AtlasSermon[], agg: AtlasAggregate) {
    const box = el.createDiv({ cls: "a4p-atlas-detail" });
    const book = this.st.book ? BOOK_BY_ABBREV.get(this.st.book) : undefined;
    if (!book) {
      box.createDiv({ cls: "a4p-atlas-hint", text: "책 칸을 누르면 그 책의 장 막대와 설교 목록이 여기에 열립니다." });
      return;
    }
    const sermons = sermonsForBook(list, book.abbrev, this.st.mode);
    const total = CHAPTER_COUNT[book.abbrev] ?? 0;
    const unit = book.abbrev === "시" ? "편" : "장";
    let chMax = 0;
    let covered = 0;
    for (let ch = 1; ch <= total; ch++) {
      const c = agg.chapters.get(`${book.abbrev}|${ch}`) ?? 0;
      if (c) covered++;
      chMax = Math.max(chMax, c);
    }
    box.createEl("h4", { text: `${book.name} — 설교 ${sermons.length}편 · ${total}${unit} 중 ${covered}곳` });
    const strip = box.createDiv({ cls: "a4p-atlas-strip" });
    for (let ch = 1; ch <= total; ch++) {
      const c = agg.chapters.get(`${book.abbrev}|${ch}`) ?? 0;
      const cell = strip.createSpan({ cls: `a4p-atlas-ch is-l${heatLevel(c, chMax)}`, text: c ? String(ch) : "" });
      setTooltip(cell, `${ch}${unit} — 설교 ${c}편`);
    }
    if (sermons.length === 0) {
      box.createDiv({ cls: "a4p-atlas-hint", text: "이 조건에서 이 책을 다룬 설교가 없습니다." });
      return;
    }
    box.createDiv({
      cls: "a4p-atlas-hint a4p-atlas-list-hint",
      text: `설교를 누르면 오른쪽에 펼쳐 봅니다 — ${book.name} 인용 위치 강조 · [열기]는 새 탭`,
    });
    const shown = this.listOpen ? sermons : sermons.slice(0, LIST_INITIAL);
    const ul = box.createEl("ul", { cls: "a4p-atlas-list" });
    for (const s of shown) this.sermonRow(ul, s, book.abbrev);
    if (sermons.length > LIST_INITIAL) {
      const more = box.createEl("button", {
        cls: "a4p-atlas-more",
        text: this.listOpen ? "접기" : `더보기 (${sermons.length - LIST_INITIAL}편 더)`,
      });
      more.addEventListener("click", () => {
        this.listOpen = !this.listOpen;
        this.render();
      });
    }
  }

  private sermonRow(ul: HTMLElement, s: AtlasSermon, book: string) {
    const li = ul.createEl("li", { cls: "a4p-atlas-row" });
    li.dataset.path = s.paths[0];
    li.createSpan({ cls: "a4p-atlas-date", text: formatDateKey(s.dateKey) });
    if (s.dept) {
      const color = this.colors.get(s.dept) ?? labelColor(s.dept, GROUP_COLORS);
      li.createSpan({ cls: `bible-verse-citing-group is-c${color}`, text: s.dept });
    } else {
      li.createSpan({ cls: "a4p-atlas-nodept" });
    }
    const title = li.createSpan({ cls: "a4p-atlas-title", text: s.title });
    if (s.paths.length > 1) title.createSpan({ cls: "a4p-atlas-mini", text: `판 ${s.paths.length}` });
    if (s.estimated) {
      const est = title.createSpan({ cls: "a4p-atlas-mini is-estimated", text: "추정" });
      setTooltip(est, "파일 이름에 본문이 없어 성경구절 속성의 첫 절로 정했습니다");
    }
    const own = s.main.filter((p) => p.book === book).map(passageLabel);
    const label = own.length ? own.join(", ") : s.main.length ? `${s.main.map(passageLabel).join(", ")} (인용)` : "";
    li.createSpan({ cls: "a4p-atlas-passage", text: label });
    setTooltip(li, s.paths.join("\n"));
    li.addEventListener("click", () => void this.previewSermon(s, li, book));
  }

  private renderCards(el: HTMLElement, list: AtlasSermon[], agg: AtlasAggregate, now: SermonDate) {
    const cards = el.createDiv({ cls: "a4p-atlas-cards" });

    const empty = emptyBooksByGenre(agg);
    const emptyCount = empty.reduce((n, e) => n + e.empty.length, 0);
    const c1 = cards.createDiv({ cls: "a4p-atlas-card" });
    c1.createEl("h5", { text: `비어 있는 책 ${emptyCount}권` });
    for (const e of empty) {
      const row = c1.createDiv({ cls: "a4p-atlas-card-row" });
      row.createSpan({
        text: e.empty.length ? `${e.genre.name} — ${e.empty.map((b) => b.abbrev).join(" · ")}` : e.genre.name,
      });
      row.createSpan({ cls: "a4p-atlas-card-num", text: `${e.empty.length}/${e.total}` });
    }

    const c2 = cards.createDiv({ cls: "a4p-atlas-card" });
    c2.createEl("h5", { text: "장르별 마지막 설교" });
    for (const l of lastByGenre(agg)) {
      const row = c2.createDiv({ cls: "a4p-atlas-card-row" });
      row.createSpan({ text: l.genre.name });
      row.createSpan({
        cls: "a4p-atlas-card-num",
        text: l.last ? `${formatDateKey(l.last)} · ${agoLabel(l.last, now)}` : "없음",
      });
    }

    const unknown = list.filter((s) => s.main.length === 0);
    const c3 = cards.createDiv({ cls: "a4p-atlas-card" });
    c3.createEl("h5", { text: `본문 미상 ${unknown.length}편 — 지도에 안 나오는 설교` });
    if (unknown.length === 0) {
      c3.createDiv({ cls: "a4p-atlas-hint", text: "모든 설교의 본문을 읽었습니다." });
      return;
    }
    const shown = this.unknownOpen ? unknown : unknown.slice(0, UNKNOWN_INITIAL);
    const ul = c3.createEl("ul", { cls: "a4p-atlas-list is-compact" });
    for (const s of shown) {
      const li = ul.createEl("li", { cls: "a4p-atlas-row" });
      li.dataset.path = s.paths[0];
      li.createSpan({ cls: "a4p-atlas-date", text: formatDateKey(s.dateKey) });
      const name = s.paths[0].slice(s.paths[0].lastIndexOf("/") + 1).replace(/\.md$/, "");
      li.createSpan({ cls: "a4p-atlas-title", text: name });
      setTooltip(li, s.paths.join("\n"));
      li.addEventListener("click", () => void this.previewSermon(s, li));
    }
    if (unknown.length > UNKNOWN_INITIAL) {
      const more = c3.createEl("button", {
        cls: "a4p-atlas-more",
        text: this.unknownOpen ? "접기" : `더보기 (${unknown.length - UNKNOWN_INITIAL}편 더)`,
      });
      more.addEventListener("click", () => {
        this.unknownOpen = !this.unknownOpen;
        this.render();
      });
    }
    c3.createDiv({
      cls: "a4p-atlas-hint",
      text: "노트 이름 끝에 본문(예: _요3_16)을 붙이거나 성경구절 속성을 넣으면 지도에 나타납니다.",
    });
  }

  // ── 오른쪽 미리보기 ─────────────────────────────────────

  /**
   * 설교 줄 클릭 — 새로 펼친다(따라간 링크 기록은 비움). book이 있으면 그 책 인용 위치를 강조한다.
   * 노트가 여럿(판)인 설교는 그 책 인용이 실제로 있는 첫 판을 연다 — 대표 노트엔 없고 원고·정리본에만 있을 때.
   */
  private async previewSermon(s: AtlasSermon, row: HTMLElement, book?: string) {
    const versions = s.paths
      .map((path) => this.app.vault.getAbstractFileByPath(path))
      .filter((f): f is TFile => f instanceof TFile);
    if (versions.length === 0) return;
    const click = ++this.clickSeq;
    let file = versions[0];
    if (book && versions.length > 1) {
      file = (await this.firstWithCitation(versions, book)) ?? versions[0];
      // 판을 고르는 사이 다른 줄을 눌렀거나 창을 닫았으면 이 클릭은 버린다(마지막 클릭이 이긴다)
      if (click !== this.clickSeq) return;
    }
    this.stack = [];
    void this.openPreview({ file, title: file.basename, book, versions, rowKey: s.paths[0] }, row);
  }

  /** 본문(속성 제외)에 이 책 인용 — 절 링크나 「창 22:1」 같은 글자 표기 — 이 있는 첫 노트 */
  private async firstWithCitation(files: TFile[], book: string): Promise<TFile | undefined> {
    const cache = this.app.metadataCache;
    for (const f of files) {
      const verses = new Set(this.plugin.bibleData.versePathsLinkedFrom(f.path, book));
      const refs = [...(cache.getFileCache(f)?.links ?? []), ...(cache.getFileCache(f)?.embeds ?? [])];
      if (refs.some((l) => verses.has(cache.getFirstLinkpathDest(l.link.split("#")[0], f.path)?.path ?? ""))) return f;
      if (findBookMentions(stripFrontmatter(await this.app.vault.cachedRead(f)), book).length > 0) return f;
    }
    return undefined;
  }

  /**
   * 오른쪽에 노트를 그린다. 처음 열 때는 창이 넓어지며 목록 폭이 바뀌므로, 누른 줄이 화면에서 같은 자리에 남게
   * 왼쪽 스크롤을 맞춘다. 렌더 중 다른 미리보기가 시작되면(연타·뒤로) 이 렌더는 버린다.
   */
  private async openPreview(p: AtlasPreview, anchor: HTMLElement | null = null) {
    const token = ++this.renderToken;
    const wasOpen = this.current !== null;
    this.current = p;
    this.citeCurrent = null;
    this.previewEl.empty();
    if (!wasOpen) this.setPreviewLayout(true, anchor);
    this.syncActive();

    const header = this.previewEl.createDiv({ cls: "bible-verse-preview-header" });
    if (p.versions && p.versions.length > 1) this.renderVersions(p);
    // 본문 컨테이너는 헤더 다음에 미리 만들어 둔다 — [열기]가 인용 블록 앞 소제목을 찾을 때 참조
    const body = this.previewEl.createDiv({ cls: "bible-verse-preview-body" });
    const backBtn = header.createEl("button", { cls: "bible-verse-preview-back", text: "←" });
    backBtn.title = this.stack.length > 0 ? "이전 미리보기로 (Esc · ⌘[)" : "미리보기 닫기 (Esc)";
    backBtn.tabIndex = -1;
    backBtn.addEventListener("click", () => this.goBack());
    const titleEl = header.createSpan({ cls: "bible-verse-preview-title", text: p.title });
    titleEl.title = p.file.path;
    const actions = header.createDiv({ cls: "bible-verse-preview-actions" });
    // 인용 위치 배지·이동 버튼 자리 — 본문 렌더 후 renderCiteNav가 채운다 (빈 채로 두면 CSS로 숨김)
    const citeNav = actions.createDiv({ cls: "bible-verse-cite-nav" });
    const openBtn = actions.createEl("button", { text: "열기", cls: "mod-cta" });
    openBtn.title = "새 탭으로 열기 — 지금 보는 인용 위치의 소제목으로";
    openBtn.addEventListener("click", () => {
      const sub = nearestHeadingFor(this.app, body, this.citeCurrent, p.file);
      // 다시 열면 지도는 보던 그대로(부서·기준·기간·고른 책)
      this.close();
      void this.app.workspace.openLinkText(sub ? `${p.file.path}#${sub}` : p.file.path, "", "tab");
    });
    const closeBtn = actions.createEl("button", { text: "✕" });
    closeBtn.title = "미리보기 닫기";
    closeBtn.addEventListener("click", () => this.closePreview());

    const md = stripFrontmatter(await this.app.vault.cachedRead(p.file));
    if (token !== this.renderToken) return;
    if (this.renderChild) this.previewComponent.removeChild(this.renderChild);
    const child = (this.renderChild = this.previewComponent.addChild(new Component()));
    await MarkdownRenderer.render(this.app, md, body, p.file.path, child);
    // 렌더 중 다른 미리보기가 시작됐으면 이 body는 이미 떼어 낸 상태
    if (token !== this.renderToken) return;

    if (p.book) {
      const name = BOOK_BY_ABBREV.get(p.book)?.name ?? p.book;
      const paths = this.plugin.bibleData.versePathsLinkedFrom(p.file.path, p.book);
      const blocks = markCitations(this.app, body, p.file.path, paths, bookMentionPattern(p.book) ?? undefined);
      renderCiteNav(this.app, citeNav, body, blocks, p.file, paths, {
        label: `${name} 인용`,
        missingHint: `본문에서 ${name} 구절 링크나 표기(예: ${p.book} 1:1, ${name} 1장)를 찾지 못했습니다 — 지도에는 파일 이름이나 속성의 본문으로 표시됩니다`,
        propertyHint: `본문에는 없고 노트 속성(예: 성경구절)에만 ${name} 구절 링크가 있습니다`,
        onCurrent: (block) => (this.citeCurrent = block),
      });
    }

    // 미리보기 안의 위키링크 → 그 노트를 이어서 미리보기 (창을 떠나지 않음, ←로 복귀)
    body.addEventListener("click", (e) => {
      const link = (e.target as HTMLElement).closest("a.internal-link");
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      const href = link.getAttribute("data-href") ?? link.getAttribute("href");
      if (!href) return;
      const target = this.app.metadataCache.getFirstLinkpathDest(href.split("#")[0], p.file.path);
      if (!target || target.extension !== "md") return;
      const ref = parseLinkTarget(target.basename);
      this.stack.push(p);
      if (this.stack.length > PREVIEW_STACK_MAX) this.stack.shift();
      void this.openPreview({ file: target, title: ref ? formatReference(ref) : target.basename });
    });
  }

  /** 머리줄 아래 「노트 2개 · 판 1 · 판 2」 — 같은 설교로 묶인 다른 노트로 바꿔 본다(같은 책 강조) */
  private renderVersions(p: AtlasPreview) {
    const versions = p.versions ?? [];
    const row = this.previewEl.createDiv({ cls: "a4p-atlas-versions" });
    row.createSpan({ cls: "a4p-atlas-versions-label", text: `이 설교의 노트 ${versions.length}개` });
    versions.forEach((f, i) => {
      const active = f === p.file;
      const b = row.createEl("button", { cls: active ? "a4p-atlas-version is-active" : "a4p-atlas-version", text: `판 ${i + 1}` });
      b.setAttr("aria-pressed", String(active));
      b.tabIndex = -1;
      setTooltip(b, f.basename);
      b.addEventListener("click", () => {
        if (active) return;
        this.stack = [];
        void this.openPreview({ ...p, file: f, title: f.basename });
      });
    });
  }

  /** 한 단계 뒤로 — 따라간 링크가 있으면 그 전 미리보기로, 없으면 미리보기를 닫는다 */
  private goBack() {
    const prev = this.stack.pop();
    if (prev) void this.openPreview(prev);
    else this.closePreview();
  }

  private closePreview() {
    if (!this.current) return;
    const anchor = this.activeRow();
    this.renderToken++;
    this.current = null;
    this.stack = [];
    this.citeCurrent = null;
    if (this.renderChild) {
      this.previewComponent.removeChild(this.renderChild);
      this.renderChild = null;
    }
    this.previewEl.empty();
    this.setPreviewLayout(false, anchor);
    this.syncActive();
  }

  /**
   * 미리보기를 열고 닫으며 창 모양을 바꾼다(넓은 화면: 좌우 나눔, 좁은 화면: 미리보기가 목록을 가림).
   * 모양이 바뀌어도 기준 줄(누른 설교)이 왼쪽 목록에서 같은 높이에 남도록 스크롤을 맞춘다.
   */
  private setPreviewLayout(open: boolean, anchor: HTMLElement | null) {
    const main = this.mainEl;
    const shown = (el: HTMLElement | null): boolean => !!el && el.isConnected && el.getClientRects().length > 0;
    const offset = (el: HTMLElement) => el.getBoundingClientRect().top - main.getBoundingClientRect().top;
    const before = anchor && shown(anchor) ? offset(anchor) : null;
    const mainWasHidden = !shown(main);
    if (open) this.scrollBeforePreview = main.scrollTop;
    this.modalEl.toggleClass("is-previewing", open);
    this.previewEl.toggleClass("is-open", open);
    if (anchor && before !== null && shown(anchor)) main.scrollTop += offset(anchor) - before;
    else if (!open && mainWasHidden) main.scrollTop = this.scrollBeforePreview;
  }

  /** 미리보기 중인 설교 줄의 경로 — 링크를 따라가 다른 노트를 보거나 다른 판을 보는 동안에도 처음 연 설교 줄 */
  private activeKey(): string | undefined {
    const root = this.stack[0] ?? this.current;
    return root ? root.rowKey ?? root.file.path : undefined;
  }

  private activeRow(): HTMLElement | null {
    const path = this.activeKey();
    if (!path) return null;
    return (
      Array.from(this.mainEl.querySelectorAll<HTMLElement>(".a4p-atlas-row")).find(
        (row) => row.dataset.path === path,
      ) ?? null
    );
  }

  private syncActive() {
    const path = this.activeKey();
    this.mainEl
      ?.querySelectorAll<HTMLElement>(".a4p-atlas-row")
      .forEach((row) => row.toggleClass("is-active", !!path && row.dataset.path === path));
  }
}
