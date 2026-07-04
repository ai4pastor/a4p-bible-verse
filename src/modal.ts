import { App, Editor, Modal, Notice } from "obsidian";
import { BibleData, LoadResult } from "./bible-data";
import { formatVerses } from "./formatter";
import type BibleVersePlugin from "./main";
import { formatReference, parseReference } from "./reference-parser";
import { insertBlock } from "./insert";
import { BibleReference, VERSIONS, Version } from "./types";

const DEBOUNCE_MS = 150;

/** 세션 내 마지막 사용 역본 (Obsidian 재시작 시 설정 기본값으로 리셋) */
let sessionVersion: Version | null = null;

export class VerseInsertModal extends Modal {
  private plugin: BibleVersePlugin;
  private data: BibleData;
  private editor: Editor;

  private inputEl!: HTMLInputElement;
  private statusEl!: HTMLElement;
  private versionBarEl!: HTMLElement;
  private listEl!: HTMLElement;
  private insertBtnEl!: HTMLButtonElement;

  private version: Version;
  private ref: BibleReference | null = null;
  private loaded: LoadResult | null = null;
  private selected = new Set<number>();
  private highlight = -1; // -1 = 입력창 존, 0+ = 목록 행 인덱스
  private debounceTimer: number | null = null;
  private requestId = 0;

  constructor(app: App, plugin: BibleVersePlugin, editor: Editor) {
    super(app);
    this.plugin = plugin;
    this.data = plugin.bibleData;
    this.editor = editor;
    this.version = sessionVersion ?? plugin.settings.defaultVersion;
  }

  onOpen() {
    this.modalEl.addClass("bible-verse-modal");
    const { contentEl } = this;
    contentEl.empty();

    // 검색 입력
    const inputWrap = contentEl.createDiv({ cls: "bible-verse-input-wrap" });
    this.inputEl = inputWrap.createEl("input", {
      type: "text",
      placeholder: "예: 요3:16 / 요3:16-20 / 요한복음 3장 16절 / 시23편",
      cls: "bible-verse-input",
    });
    this.inputEl.addEventListener("input", () => this.scheduleSearch());

    // 상태줄 + 역본 세그먼트
    const statusRow = contentEl.createDiv({ cls: "bible-verse-status-row" });
    this.statusEl = statusRow.createDiv({ cls: "bible-verse-status" });
    this.versionBarEl = statusRow.createDiv({ cls: "bible-verse-versions" });
    this.renderVersionBar();

    // 구절 목록
    this.listEl = contentEl.createDiv({ cls: "bible-verse-list" });
    this.listEl.tabIndex = -1;
    this.listEl.addEventListener("keydown", (e) => this.onListKeydown(e));

    // 푸터
    const footer = contentEl.createDiv({ cls: "bible-verse-footer" });
    footer.createDiv({
      cls: "bible-verse-hints",
      text: "Enter 삽입 · ↓ 목록 · Space 선택 · Cmd+Enter 한 절 삽입(유지) · Tab 역본",
    });
    this.insertBtnEl = footer.createEl("button", {
      cls: "mod-cta bible-verse-insert-btn",
      text: "삽입",
    });
    this.insertBtnEl.addEventListener("click", () => this.insertSelected(true));

    // 키 바인딩 (Scope)
    this.scope.register([], "Enter", (e) => {
      e.preventDefault();
      this.insertSelected(true);
    });
    this.scope.register(["Mod"], "Enter", (e) => {
      e.preventDefault();
      this.insertHighlighted();
    });
    this.scope.register([], "Tab", (e) => {
      e.preventDefault();
      this.cycleVersion(1);
    });
    this.scope.register(["Shift"], "Tab", (e) => {
      e.preventDefault();
      this.cycleVersion(-1);
    });
    this.scope.register([], "ArrowDown", (e) => {
      e.preventDefault();
      this.moveHighlight(1);
    });
    this.scope.register([], "ArrowUp", (e) => {
      e.preventDefault();
      this.moveHighlight(-1);
    });
    this.scope.register([], "Escape", (e) => {
      if (this.highlight >= 0) {
        e.preventDefault();
        this.focusInput();
      } else {
        this.close();
      }
    });

    this.renderEmptyState();
    this.inputEl.focus();

    // 폴더 미설정 조기 안내
    if (!this.plugin.settings.biblePath.trim()) {
      this.setStatus("설정에서 성경 폴더를 먼저 지정해주세요.", "error");
    }
  }

  onClose() {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.contentEl.empty();
  }

  // ── 검색 ──────────────────────────────────────────────

  private scheduleSearch() {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => void this.runSearch(), DEBOUNCE_MS);
  }

  private async runSearch() {
    const query = this.inputEl.value.trim();
    const id = ++this.requestId;

    if (!query) {
      this.ref = null;
      this.loaded = null;
      this.renderEmptyState();
      return;
    }

    const parsed = parseReference(query);
    if (!parsed.ok) {
      this.ref = null;
      this.loaded = null;
      this.setStatus(parsed.reason, "error");
      this.listEl.empty();
      this.updateInsertButton();
      return;
    }

    const loadingTimer = window.setTimeout(() => {
      if (id === this.requestId) this.listEl.setText("불러오는 중...");
    }, 150);

    const outcome = await this.data.loadVerses(parsed.ref);
    window.clearTimeout(loadingTimer);
    if (id !== this.requestId) return; // 더 새로운 검색이 이미 시작됨

    if (!outcome.ok) {
      this.ref = null;
      this.loaded = null;
      this.setStatus(outcome.reason, "error");
      this.listEl.empty();
      this.updateInsertButton();
      return;
    }

    this.ref = parsed.ref;
    this.loaded = outcome.result;
    this.selected = new Set(outcome.result.verses.map((v) => v.verse));
    this.highlight = -1;

    const label = formatReference(parsed.ref);
    const count = outcome.result.verses.length;
    const notice = outcome.result.notice ? ` — ${outcome.result.notice}` : "";
    this.setStatus(`${label} (${count}절)${notice}`, outcome.result.notice ? "warn" : "ok");
    this.renderList();
  }

  // ── 렌더링 ────────────────────────────────────────────

  private renderEmptyState() {
    this.setStatus("장절 참조를 입력하세요 (예: 요3:16, 시23편)", "muted");
    this.listEl.empty();
    this.updateInsertButton();
  }

  private setStatus(text: string, kind: "ok" | "warn" | "error" | "muted") {
    this.statusEl.setText(text);
    this.statusEl.className = `bible-verse-status is-${kind}`;
  }

  private renderVersionBar() {
    this.versionBarEl.empty();
    for (const v of VERSIONS) {
      const btn = this.versionBarEl.createEl("button", {
        cls: `bible-verse-version-btn${v === this.version ? " is-active" : ""}`,
        text: v === "개역개정" ? "개역" : v === "쉬운성경" ? "쉬운" : v,
      });
      btn.title = v;
      btn.tabIndex = -1;
      btn.addEventListener("click", () => this.setVersion(v));
    }
  }

  private renderList() {
    this.listEl.empty();
    if (!this.loaded) return;

    this.loaded.verses.forEach((verse, idx) => {
      const text = verse.texts[this.version];
      const row = this.listEl.createDiv({
        cls: `bible-verse-row${this.highlight === idx ? " is-highlighted" : ""}${
          text ? "" : " is-disabled"
        }`,
      });

      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = this.selected.has(verse.verse) && !!text;
      checkbox.disabled = !text;
      checkbox.tabIndex = -1;
      checkbox.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleVerse(verse.verse);
      });

      row.createSpan({ cls: "bible-verse-num", text: String(verse.verse) });
      row.createSpan({
        cls: "bible-verse-text",
        text: text ? text.replace(/\s*\n\s*/g, " ") : `(${this.version} 본문 없음)`,
      });

      row.addEventListener("click", () => {
        if (!text) return;
        this.highlight = idx;
        this.toggleVerse(verse.verse);
      });
    });
    this.updateInsertButton();
  }

  private updateInsertButton() {
    const count = this.insertableVerses().length;
    this.insertBtnEl.setText(count > 0 ? `${count}절 삽입` : "삽입");
    this.insertBtnEl.disabled = count === 0;
  }

  // ── 상태 조작 ─────────────────────────────────────────

  private toggleVerse(verse: number) {
    if (this.selected.has(verse)) this.selected.delete(verse);
    else this.selected.add(verse);
    this.renderList();
  }

  private setVersion(v: Version) {
    this.version = v;
    sessionVersion = v;
    this.renderVersionBar();
    this.renderList();
  }

  private cycleVersion(dir: 1 | -1) {
    const idx = VERSIONS.indexOf(this.version);
    const next = VERSIONS[(idx + dir + VERSIONS.length) % VERSIONS.length];
    this.setVersion(next);
  }

  private moveHighlight(dir: 1 | -1) {
    const count = this.loaded?.verses.length ?? 0;
    if (count === 0) return;
    const next = this.highlight + dir;
    if (next < 0) {
      this.focusInput();
      return;
    }
    this.highlight = Math.min(next, count - 1);
    this.listEl.focus();
    this.renderList();
    const row = this.listEl.children[this.highlight];
    if (row instanceof HTMLElement) row.scrollIntoView({ block: "nearest" });
  }

  private focusInput() {
    this.highlight = -1;
    this.renderList();
    this.inputEl.focus();
    this.inputEl.select();
  }

  private onListKeydown(e: KeyboardEvent) {
    if (e.key === " ") {
      e.preventDefault();
      const verse = this.loaded?.verses[this.highlight];
      if (verse && verse.texts[this.version]) this.toggleVerse(verse.verse);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      this.toggleAll();
      return;
    }
    // 글자 키 입력 시 입력창으로 자동 복귀 (Finder 패턴)
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this.focusInput();
    }
  }

  private toggleAll() {
    if (!this.loaded) return;
    const insertable = this.loaded.verses.filter((v) => v.texts[this.version]);
    const allSelected = insertable.every((v) => this.selected.has(v.verse));
    if (allSelected) this.selected.clear();
    else this.selected = new Set(insertable.map((v) => v.verse));
    this.renderList();
  }

  // ── 삽입 ──────────────────────────────────────────────

  private insertableVerses() {
    if (!this.loaded) return [];
    return this.loaded.verses.filter(
      (v) => this.selected.has(v.verse) && v.texts[this.version],
    );
  }

  private insertSelected(close: boolean) {
    if (!this.ref || !this.loaded) return;
    const verses = this.insertableVerses();
    if (verses.length === 0) {
      new Notice("삽입할 절이 없습니다.");
      return;
    }
    const wholeChapter =
      this.ref.verseStart === undefined && verses.length === this.loaded.verses.length;
    const block = formatVerses(verses, {
      bookName: this.ref.bookName,
      chapter: this.ref.chapter,
      version: this.version,
      wholeChapter,
      merge: this.plugin.settings.mergeRange,
    });
    if (!insertBlock(this.app, block, this.editor)) return;
    if (close) this.close();
  }

  /** Cmd+Enter: 하이라이트된 절(기본 첫 절) 1개만 삽입하고 모달 유지 — 연속 삽입 모드 */
  private insertHighlighted() {
    if (!this.ref || !this.loaded) return;
    const idx = this.highlight >= 0 ? this.highlight : 0;
    const verse = this.loaded.verses[idx];
    if (!verse) return;
    if (!verse.texts[this.version]) {
      new Notice(`이 절에는 ${this.version} 본문이 없습니다.`);
      return;
    }
    const block = formatVerses([verse], {
      bookName: this.ref.bookName,
      chapter: this.ref.chapter,
      version: this.version,
      wholeChapter: false,
      merge: true,
    });
    if (!insertBlock(this.app, block, this.editor)) return;
    new Notice(`${this.ref.bookName} ${this.ref.chapter}:${verse.verse} 삽입됨 (${this.version})`);
    this.focusInput();
  }
}
