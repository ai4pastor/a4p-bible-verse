/**
 * 설교 성경 지도 (v0.15) — 설교 폴더의 설교를 성경 66권 위에 펼쳐 보는 큰 창(모달).
 * 성경 구절 검색·삽입 모달처럼 명령으로 열고 Esc로 닫는다. 열 때마다 새로 계산한다(부팅 비용 0).
 * 계산은 순수 모듈 atlas.ts, 볼트에서 모으기는 bible-data `sermonAtlasInput`, 여기는 그리기만.
 *
 * - 보던 화면(부서·기준·기간·고른 책)은 플러그인이 기억해 다시 열면 그대로 보인다(옵시디언을 끄면 초기화).
 * - 목록은 「외 N개」로 줄이지 않는다 — 많을 때만 [더보기]로 펼치고 개수는 제목에 보인다.
 * - 정보가 없으면 오류 대신 빈칸·안내 (설교 폴더 미지정·없는 경로·부서 없음).
 * - 설교 줄을 누르면 창을 닫고 그 설교를 새 탭으로 연다.
 */
import { App, Modal, TFile, TFolder, setTooltip } from "obsidian";
import { BOOK_BY_ABBREV } from "./books";
import {
  CHAPTER_COUNT,
  GENRES,
  agoLabel,
  aggregate,
  booksInGenre,
  buildSermons,
  departments,
  emptyBooksByGenre,
  filterSermons,
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
import { groupLabel, isYearFolder, labelColor, type SermonDate } from "./sermon-meta";
import type BibleVersePlugin from "./main";

/** 책 설교 목록 — 이보다 많을 때만 앞부분을 보이고 나머지는 [더보기] */
const LIST_INITIAL = 10;
/** 본문 미상 목록 — 이보다 많을 때만 [더보기] */
const UNKNOWN_INITIAL = 8;
/** 부서 배지 색 수 — 「인용한 설교」(modal.ts)와 같은 팔레트 */
const GROUP_COLORS = 8;

export type AtlasPeriod = "all" | "3y" | "1y";

/** 다시 열 때 그대로 보여 줄 화면 상태 — 플러그인 인스턴스가 들고 있다(저장하지 않음) */
export interface AtlasViewState {
  dept: string;
  mode: AtlasMode;
  period: AtlasPeriod;
  book: string | null;
}

export const defaultAtlasState = (): AtlasViewState => ({ dept: "", mode: "main", period: "all", book: null });

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
    this.reload();
  }

  onClose() {
    this.contentEl.empty();
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
    const el = this.contentEl;
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
    li.addEventListener("click", () => this.openNote(s.paths[0]));
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
      li.createSpan({ cls: "a4p-atlas-date", text: formatDateKey(s.dateKey) });
      const name = s.paths[0].slice(s.paths[0].lastIndexOf("/") + 1).replace(/\.md$/, "");
      li.createSpan({ cls: "a4p-atlas-title", text: name });
      setTooltip(li, s.paths.join("\n"));
      li.addEventListener("click", () => this.openNote(s.paths[0]));
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

  /** 창을 닫고 그 설교를 새 탭으로 연다 — 다시 열면 보던 화면 그대로 */
  private openNote(path: string) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    this.close();
    void this.app.workspace.getLeaf("tab").openFile(file);
  }
}
