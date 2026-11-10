import { App, Component, Editor, MarkdownRenderer, Modal, Notice, TFile, TFolder } from "obsidian";
import { BibleData, LoadResult } from "./bible-data";
import { formatPlainVerses, formatVerses, groupForInsert } from "./formatter";
import type BibleVersePlugin from "./main";
import { extractHeadingSection, stripAnnotations } from "./note-parser";
import { formatReference, parseLinkTarget, parseReference } from "./reference-parser";
import { insertBlock } from "./insert";
import { SearchHit, indexCoverage, searchVerses } from "./search";
import { BibleReference, IndexEntry, Version, VerseData } from "./types";
import { shortLabel, versionNames } from "./versions";
import { BUILD_CANCELLED } from "./verse-index";
import { ConfirmBuildModal } from "./confirm-build-modal";
import { normalizeFolderPath } from "./paths";
import { ResearchItem, chipLabels, groupChildren } from "./research";
import {
  NO_FILTER,
  ResultFilter,
  applyFilter,
  collapseChips,
  facetCounts,
  isFiltered,
  selectBook,
  selectChapter,
  selectTestament,
} from "./result-filter";
import {
  SermonMeta,
  compareSermons,
  dateFromProperty,
  formatSermonDate,
  groupLabel,
  isYearFolder,
  labelColor,
  parseSermonName,
  sermonGroup,
} from "./sermon-meta";

const DEBOUNCE_MS = 150;
/** 인용한 설교·연구 자료: 이보다 많을 때만 앞부분만 보이고 나머지는 [더보기]로 펼친다 */
const CITING_INITIAL = 10;
/** 파일명에 날짜가 없을 때 날짜로 읽을 노트 속성 — 설교는 설교일, 연구 노트는 만든 날 */
const SERMON_DATE_KEYS = ["date", "설교일"] as const;
const RESEARCH_DATE_KEYS = ["date", "created"] as const;
/** 부서 배지 색 수 (styles.css의 .is-c0~7) */
const GROUP_COLORS = 8;
/** 키워드 결과 필터: 권·장 칩이 이보다 많을 때만 결과가 많은 칩만 남기고 나머지는 [더보기]로 펼친다 */
const BOOK_CHIPS_INITIAL = 20;
const CHAPTER_CHIPS_INITIAL = 24;

/** 세션 내 마지막 사용 역본 (Obsidian 재시작 시 설정 기본값으로 리셋) */
let sessionVersion: Version | null = null;

interface PreviewOpts {
  file: TFile;
  title: string;
  /** 있으면 해당 헤딩 섹션만 렌더 (주석 pericope) */
  heading?: string;
  /** 있으면 [검색] 버튼 노출 — 클릭 시 그 참조로 검색 전환 */
  searchInput?: string;
  /** 있으면 렌더 후 이 볼트 경로들을 가리키는 링크를 강조하고 첫 인용 위치로 스크롤 (인용한 설교) */
  highlightPaths?: string[];
}

/** 모달 내 뒤로가기 히스토리의 한 화면 — 미리보기 또는 검색 목록 (단어 검색이면 보던 필터도) */
type NavState =
  | { kind: "preview"; opts: PreviewOpts }
  | { kind: "search"; query: string; filter?: ResultFilter };

export class VerseInsertModal extends Modal {
  private plugin: BibleVersePlugin;
  private data: BibleData;
  /** null이면 복사 전용 모드 (편집기 없이 팔레트에서 실행) */
  private editor: Editor | null;

  private inputEl!: HTMLInputElement;
  private backBtnEl!: HTMLButtonElement;
  private footerBackBtnEl!: HTMLButtonElement;
  private statusEl!: HTMLElement;
  private versionBarEl!: HTMLElement;
  private listEl!: HTMLElement;
  private contextEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private insertBtnEl!: HTMLButtonElement;
  private citing: string[] = [];
  /** 인용한 설교 [더보기] 펼침 — 새 검색·절 이동으로 다시 그려도 모달이 열려 있는 동안 유지 */
  private citingExpanded = false;
  /** 연구 자료 폴더에서 검색 구절을 링크한 노트 — 위 노트(견해 지도)마다 묶인 하위 노트(원문 발췌) */
  private research: ResearchItem[] = [];
  /** 연구 자료 [더보기] 펼침 — 모달이 열려 있는 동안 유지 */
  private researchExpanded = false;
  /** 펼친 묶음(「원문 발췌 20 ▸」) — `위 노트 경로\n묶음 이름`, 모달이 열려 있는 동안 유지 */
  private researchOpen = new Set<string>();
  /** 미리보기 렌더링 생명주기 관리 (모달 닫힐 때 unload) */
  private previewComponent = new Component();
  private previewOpen = false;
  /** 현재 열려 있는 미리보기 (뒤로가기 히스토리 push용) */
  private currentPreview: PreviewOpts | null = null;
  /** 인용한 설교 미리보기에서 현재 가리키는 인용 블록 — [열기]가 인접 헤딩으로 열 때 사용 */
  private citeCurrent: HTMLElement | null = null;
  /** 모달 내 뒤로가기 스택 — 마우스 뒤로가기·Esc가 이전 화면으로 복귀 */
  private navStack: NavState[] = [];

  private version: Version;
  /** Cmd+클릭으로 고른 병렬 역본 (null이면 단일 역본 삽입) */
  private secondary: Version | null = null;
  private ref: BibleReference | null = null;
  private loaded: LoadResult | null = null;
  /** 키워드 본문 검색 결과 — null이 아니면 키워드 모드 (참조 모드와 상호 배타) */
  private keywordHits: SearchHit[] | null = null;
  private keywordExactTotal = 0;
  /** 키워드 목록의 행/체크박스 참조 — 수백 행 재렌더링 없이 증분 갱신용 */
  private keywordRows: HTMLElement[] = [];
  private keywordChecks = new Map<string, HTMLInputElement>();
  /** 키워드 결과 필터 막대 (범위·권·장) — 목록 바로 위 */
  private filterEl!: HTMLElement;
  private filter: ResultFilter = NO_FILTER;
  /** 필터를 거친 키워드 결과 — 목록·하이라이트·Space·Cmd+A·Cmd+Enter가 보는 범위. 선택·삽입은 keywordHits 전체 */
  private keywordView: SearchHit[] = [];
  /** 자르기 전 유사 결과 수 — 구분선의 "관련성 상위 N절" 표기 판단 */
  private keywordPartialTotal = 0;
  /** (선택 N) 칩 — 필터는 그대로 둔 채 고른 절만 모아 본다 */
  private selectedOnly = false;
  /** 다음 단어 검색에 이어 쓸 필터 — 역본 전환(같은 검색어 재검색)·뒤로가기 복귀 때만 채운다 */
  private restoreFilter: { query: string; filter: ResultFilter } | null = null;
  /** [더보기]로 펼친 칩 줄(권·장) — 모달이 열려 있는 동안 유지 */
  private expandedChips = new Set<"권" | "장">();
  /** 청크 렌더링 세대 — 새 렌더 시작 시 이전 예약 청크 폐기 */
  private renderToken = 0;
  private selected = new Set<string>(); // linkTarget 기준 (장 경계 범위에서 절 번호 중복 방지)
  private highlight = -1; // -1 = 입력창 존, 0+ = 목록 행 인덱스
  private debounceTimer: number | null = null;
  private requestId = 0;

  constructor(app: App, plugin: BibleVersePlugin, editor: Editor | null) {
    super(app);
    this.plugin = plugin;
    this.data = plugin.bibleData;
    this.editor = editor;
    // 설정에서 뺀 역본이 세션 값으로 남아 있을 수 있다 — 목록 안의 값으로 되돌린다
    this.version = this.resolveVersion(sessionVersion ?? plugin.settings.defaultVersion);
  }

  onOpen() {
    this.modalEl.addClass("bible-verse-modal");
    const { contentEl } = this;
    contentEl.empty();

    // 검색 입력 (+ 뒤로가기 버튼)
    const inputWrap = contentEl.createDiv({ cls: "bible-verse-input-wrap" });
    this.backBtnEl = inputWrap.createEl("button", {
      cls: "bible-verse-back-btn",
      text: "←",
    });
    this.backBtnEl.title = "이전 화면으로 (⌘[ · 마우스 뒤로가기)";
    this.backBtnEl.tabIndex = -1;
    this.backBtnEl.addEventListener("click", () => this.goBack());
    this.inputEl = inputWrap.createEl("input", {
      type: "text",
      placeholder: "예: 요3:16 / 시23편 / 키워드(사랑 은혜)",
      cls: "bible-verse-input",
    });
    this.inputEl.addEventListener("input", () => this.scheduleSearch());
    this.updateBackButton();

    // 상태줄 + 역본 세그먼트
    const statusRow = contentEl.createDiv({ cls: "bible-verse-status-row" });
    this.statusEl = statusRow.createDiv({ cls: "bible-verse-status" });
    this.versionBarEl = statusRow.createDiv({ cls: "bible-verse-versions" });
    this.renderVersionBar();

    // 본문 영역: 좌측(목록+컨텍스트) / 우측(미리보기 패널)
    const bodyEl = contentEl.createDiv({ cls: "bible-verse-body" });
    const mainEl = bodyEl.createDiv({ cls: "bible-verse-main" });

    // 단어 검색 결과 필터 (범위·권·장) — 미리보기가 열려도 목록과 같은 폭
    this.filterEl = mainEl.createDiv({ cls: "bible-verse-filter" });

    // 구절 목록
    this.listEl = mainEl.createDiv({ cls: "bible-verse-list" });
    this.listEl.tabIndex = -1;
    this.listEl.addEventListener("keydown", (e) => this.onListKeydown(e));

    // 컨텍스트: 관련구절 칩 + 주석 + 연구 자료 + 인용한 설교
    this.contextEl = mainEl.createDiv({ cls: "bible-verse-context" });

    // 미리보기 패널 (칩 클릭 시 열림)
    this.previewEl = bodyEl.createDiv({ cls: "bible-verse-preview" });
    this.previewComponent.load();

    // 푸터
    const footer = contentEl.createDiv({ cls: "bible-verse-footer" });
    footer.createDiv({
      cls: "bible-verse-hints",
      text: "Enter 삽입 · ↓ 목록 · Space 선택 · Cmd+Enter 한 절(유지) · Tab 역본 · Cmd+Shift+C 복사 · 뒤로가기(⌘[) 이전 화면",
    });
    const btnGroup = footer.createDiv({ cls: "bible-verse-btn-group" });
    this.footerBackBtnEl = btnGroup.createEl("button", { text: "← 뒤로" });
    this.footerBackBtnEl.title = "이전 화면으로 (⌘[ · 마우스 뒤로가기)";
    this.footerBackBtnEl.tabIndex = -1;
    this.footerBackBtnEl.addEventListener("click", () => this.goBack());
    const copyBtn = btnGroup.createEl("button", { text: "복사" });
    copyBtn.addEventListener("click", () => void this.copySelected());
    this.insertBtnEl = btnGroup.createEl("button", {
      cls: "mod-cta bible-verse-insert-btn",
      text: "삽입",
    });
    this.insertBtnEl.addEventListener("click", () => this.insertSelected(true));
    this.updateBackButton();

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
    this.scope.register(["Mod", "Shift"], "C", (e) => {
      e.preventDefault();
      void this.copySelected();
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
      if (this.previewOpen) {
        e.preventDefault();
        // 미리보기에서 Esc = 뒤로가기 (연쇄 미리보기는 한 단계씩 복귀)
        if (this.navStack.length > 0) this.goBack();
        else this.closePreview();
      } else if (this.highlight >= 0) {
        e.preventDefault();
        this.focusInput();
      } else {
        this.close();
      }
    });
    // 옵시디언 탐색 뒤로가기 단축키를 모달 내 뒤로가기로 흡수
    this.scope.register(["Mod"], "[", (e) => {
      e.preventDefault();
      this.goBack();
    });
    this.scope.register(["Mod", "Alt"], "ArrowLeft", (e) => {
      e.preventDefault();
      this.goBack();
    });

    // 마우스 뒤로가기(버튼 4)·앞으로가기(버튼 5) — 옵시디언 전역 탐색이
    // 모달을 닫아버리지 않도록 캡처 단계에서 가로채 모달 내 뒤로가기로 연결
    window.addEventListener("mousedown", this.onMouseNav, { capture: true });
    window.addEventListener("mouseup", this.onMouseNav, { capture: true });

    this.renderEmptyState();
    this.inputEl.focus();

    // 폴더 미설정 조기 안내
    if (!this.plugin.settings.otPath.trim() && !this.plugin.settings.ntPath.trim()) {
      this.setStatus(
        "성경 폴더가 아직 설정되지 않았습니다. 설정 → A4P 성경구절에서 구약·신약 성경 폴더를 선택해주세요.",
        "error",
      );
    }
  }

  onClose() {
    window.removeEventListener("mousedown", this.onMouseNav, { capture: true });
    window.removeEventListener("mouseup", this.onMouseNav, { capture: true });
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.previewComponent.unload();
    this.contentEl.empty();
  }

  // ── 뒤로가기 (모달 내 히스토리) ────────────────────────

  private onMouseNav = (e: MouseEvent) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === "mouseup" && e.button === 3) this.goBack();
  };

  /** 현재 화면(미리보기 또는 검색 목록)을 히스토리에 저장 — 화면 전환 직전에 호출 */
  private pushNav() {
    if (this.currentPreview) {
      this.navStack.push({ kind: "preview", opts: this.currentPreview });
    } else {
      this.navStack.push({
        kind: "search",
        query: this.inputEl.value,
        filter: this.keywordHits && isFiltered(this.filter) ? this.filter : undefined,
      });
    }
    if (this.navStack.length > 50) this.navStack.shift();
    this.updateBackButton();
  }

  /** 이전 화면으로 복귀 — 미리보기 연쇄 → 검색 목록 → 이전 검색어 순으로 거슬러 간다 */
  private goBack() {
    const state = this.navStack.pop();
    this.updateBackButton();
    if (!state) {
      // 히스토리가 없으면 미리보기만 닫는다 (모달은 유지)
      if (this.previewOpen) this.closePreview();
      return;
    }
    if (state.kind === "preview") {
      void this.openPreview(state.opts, true);
      return;
    }
    this.closePreview();
    this.inputEl.value = state.query;
    if (state.filter) this.restoreFilter = { query: state.query.trim(), filter: state.filter };
    void this.runSearch();
    this.inputEl.focus();
  }

  /** 뒤로 갈 화면이 있을 때만 뒤로가기 버튼들(검색창 옆·푸터) 활성화 */
  private updateBackButton() {
    const disabled = this.navStack.length === 0;
    if (this.backBtnEl) this.backBtnEl.disabled = disabled;
    if (this.footerBackBtnEl) this.footerBackBtnEl.disabled = disabled;
  }

  // ── 검색 ──────────────────────────────────────────────

  private scheduleSearch() {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => void this.runSearch(), DEBOUNCE_MS);
  }

  private async runSearch() {
    const query = this.inputEl.value.trim();
    const id = ++this.requestId;
    // 역본 전환·뒤로가기가 남긴 필터는 이번 검색 한 번에만 쓴다
    const restore = this.restoreFilter;
    this.restoreFilter = null;
    if (this.previewOpen) {
      this.pushNav(); // 미리보기 중 새 검색 — 뒤로가기로 미리보기 복귀 가능하게
      this.closePreview();
    }

    if (!query) {
      this.ref = null;
      this.loaded = null;
      this.keywordHits = null;
      this.renderEmptyState();
      return;
    }

    const parsed = parseReference(query);
    if (!parsed.ok) {
      // 참조 형태가 아닌 입력(예: "사랑 은혜")은 본문 키워드 검색으로 폴백
      if (parsed.kind === "unrecognized" && query.length >= 2) {
        await this.runKeywordSearch(query, id, restore);
        return;
      }
      this.ref = null;
      this.loaded = null;
      this.keywordHits = null;
      this.renderVersionBar();
      this.setStatus(parsed.reason, "error");
      this.clearResults();
      this.updateInsertButton();
      return;
    }

    const loadingTimer = window.setTimeout(() => {
      if (id === this.requestId) this.listEl.setText("불러오는 중...");
    }, 150);

    const outcome = await this.data.loadVerses(
      parsed.ref,
      this.plugin.settings.stripAnnotations,
    );
    window.clearTimeout(loadingTimer);
    if (id !== this.requestId) return; // 더 새로운 검색이 이미 시작됨

    if (!outcome.ok) {
      this.ref = null;
      this.loaded = null;
      this.keywordHits = null;
      this.renderVersionBar();
      this.setStatus(outcome.reason, "error");
      this.clearResults();
      this.updateInsertButton();
      return;
    }

    this.ref = parsed.ref;
    this.loaded = outcome.result;
    this.keywordHits = null;
    this.selected = new Set(outcome.result.verses.map((v) => v.linkTarget));
    this.highlight = -1;
    const versePaths = outcome.result.verses.map((v) => v.path ?? "");
    this.citing = this.data.citingNotes(versePaths);
    this.research = this.data.researchNotes(versePaths);

    this.renderReferenceStatus();
    this.renderList();
    this.renderContext();
  }

  /** 참조 모드 상태줄 — 불러온 절 전부에 현재 역본 본문이 없으면 원인을 안내한다 */
  private renderReferenceStatus() {
    if (!this.ref || !this.loaded) return;
    const { verses, notice } = this.loaded;
    const label = formatReference(this.ref);
    if (verses.length > 0 && !verses.some((v) => v.texts[this.version])) {
      this.setStatus(
        `${label} — 이 구절 노트에 '${this.version}' 콜아웃이 없습니다. Tab으로 다른 역본을 보세요.`,
        "warn",
      );
      return;
    }
    const noticeText = notice ? ` — ${notice}` : "";
    this.setStatus(`${label} (${verses.length}절)${noticeText}`, notice ? "warn" : "ok");
  }

  /**
   * 본문 키워드 검색 — 첫 실행 시 인덱스를 빌드(진행률 표시)한 뒤 선형 스캔.
   * restore: 역본 전환·뒤로가기로 같은 검색어를 다시 찾을 때 이어 쓸 필터 (새 검색어면 무시)
   */
  private async runKeywordSearch(
    query: string,
    id: number,
    restore: { query: string; filter: ResultFilter } | null,
  ) {
    this.ref = null;
    this.loaded = null;
    this.renderVersionBar();

    // 저사양 PC용 토글 — 꺼져 있으면 인덱스 빌드·캐시 로드 없이 안내만
    if (!this.plugin.settings.enableKeywordSearch) {
      this.keywordHits = null;
      this.clearResults();
      this.setStatus(
        "본문 키워드 검색이 꺼져 있습니다 — 장절 참조(예: 요3:16)로 검색하거나 설정 → A4P 성경구절에서 켜주세요.",
        "warn",
      );
      this.updateInsertButton();
      return;
    }

    const index = this.plugin.verseIndex;
    if (index.status !== "ready") {
      this.clearResults();
      this.setStatus("본문 인덱스 준비 중… (처음 한 번만 걸립니다)", "muted");
      const err = await index.ensureBuilt(
        (done, total) => {
          if (id === this.requestId) {
            this.setStatus(
              `본문 인덱스 생성 중… (${done.toLocaleString()}/${total.toLocaleString()})`,
              "muted",
            );
          }
        },
        // 디스크 캐시가 없어 3만 파일 전체 읽기가 필요할 때만 확인창이 뜬다
        (fileCount) => ConfirmBuildModal.ask(this.app, fileCount),
      );
      this.inputEl.focus(); // 확인창이 포커스를 가져갔을 수 있다
      if (id !== this.requestId) return;
      if (err) {
        this.keywordHits = null;
        this.setStatus(err, err === BUILD_CANCELLED ? "warn" : "error");
        this.updateInsertButton();
        return;
      }
    }
    if (id !== this.requestId) return;

    const versions: Version[] =
      this.plugin.settings.keywordSearchScope === "all"
        ? [this.version, ...this.names().filter((v) => v !== this.version)]
        : [this.version];
    const outcome = searchVerses(index.entries, query, { versions });

    this.keywordHits = outcome.hits;
    this.keywordExactTotal = outcome.exactTotal;
    this.keywordPartialTotal = outcome.partialTotal;
    // 새 검색어는 필터 없이 시작 — 역본 전환·뒤로가기로 같은 검색어를 다시 찾을 때만 이어 쓴다
    this.filter = restore && restore.query === query ? restore.filter : NO_FILTER;
    this.selectedOnly = false;
    this.selected = new Set(); // 키워드 결과는 기본 선택 없음 (참조 모드와 반대)
    this.citing = [];
    this.research = [];

    const scopeLabel =
      this.plugin.settings.keywordSearchScope === "all" ? "전체 역본" : this.version;
    // 한쪽 testament만 등록된 볼트 — 0건의 이유(미등록)를 설명해 오해를 막는다
    const coverage = indexCoverage(index.entries);
    const missingTestament = (["구약", "신약"] as const).filter((t) => !coverage[t]);
    const coverageNote =
      missingTestament.length === 1
        ? ` (${missingTestament[0]} 구절 미등록 — 등록된 범위에서만 검색됩니다)`
        : "";
    const hits = outcome.hits;
    if (hits.length === 0) {
      this.setStatus(`"${query}" — 일치하는 절이 없습니다 (${scopeLabel})${coverageNote}`, "warn");
    } else if (hits[0].tier === "fuzzy") {
      this.setStatus(
        `"${query}" — 정확히 일치하는 절이 없어 비슷한 절 ${hits.length}개를 표시합니다${coverageNote}`,
        "warn",
      );
    } else {
      const exactShown = hits.filter((h) => h.tier === "exact").length;
      const partialShown = hits.length - exactShown;
      const partialLabel = partialShown > 0 ? ` · 유사 ${partialShown}절` : "";
      this.setStatus(
        `"${query}" 본문 검색 (${scopeLabel}) — ${exactShown.toLocaleString()}절${partialLabel}${coverageNote}`,
        "ok",
      );
    }
    this.refreshKeywordView();
  }

  // ── 렌더링 ────────────────────────────────────────────

  private renderEmptyState() {
    this.setStatus(
      this.plugin.settings.enableKeywordSearch
        ? "장절 참조 또는 키워드를 입력하세요 (예: 요3:16, 사랑 은혜)"
        : "장절 참조를 입력하세요 (예: 요3:16, 시23편)",
      "muted",
    );
    this.clearResults();
    this.renderVersionBar();
    this.updateInsertButton();
  }

  /** 결과 영역(필터 막대·목록·컨텍스트)을 비운다 — 오류·빈 입력·인덱스 준비 중 */
  private clearResults() {
    this.filterEl.empty();
    this.listEl.empty();
    this.contextEl.empty();
  }

  private setStatus(text: string, kind: "ok" | "warn" | "error" | "muted") {
    this.statusEl.setText(text);
    this.statusEl.className = `bible-verse-status is-${kind}`;
  }

  private renderVersionBar() {
    this.syncVersionState();
    this.versionBarEl.empty();
    // 참조 모드에서 불러온 절 전부에 본문이 없는 역본은 흐리게 — 이 구절에 어떤 역본이 있는지 한눈에
    const loadedVerses = !this.keywordHits && this.loaded ? this.loaded.verses : null;
    for (const def of this.plugin.settings.versions) {
      const v = def.name;
      const empty =
        !!loadedVerses &&
        loadedVerses.length > 0 &&
        !loadedVerses.some((verse) => verse.texts[v]);
      const cls = [
        "bible-verse-version-btn",
        v === this.version ? "is-active" : "",
        v === this.secondary ? "is-secondary" : "",
        empty ? "is-empty" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const btn = this.versionBarEl.createEl("button", { cls, text: shortLabel(def) });
      btn.title = `${v} — 클릭: 역본 선택 · Cmd+클릭: 병렬 역본 지정/해제${
        empty ? " · 이 구절에는 본문 없음" : ""
      }`;
      btn.tabIndex = -1;
      btn.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey) this.toggleSecondary(v);
        else this.setVersion(v);
      });
    }
  }

  /** Cmd+클릭: 병렬 역본 지정/해제 — 지정되면 삽입·복사에 두 역본이 함께 들어간다 */
  private toggleSecondary(v: Version) {
    if (v === this.version) return;
    this.secondary = this.secondary === v ? null : v;
    this.renderVersionBar();
    this.updateInsertButton();
  }

  private renderList() {
    this.renderFilterBar(); // 참조 모드에서는 비운다
    if (this.keywordHits) {
      this.renderKeywordList();
      return;
    }
    this.listEl.empty();
    if (!this.loaded) return;
    this.renderVersionBar(); // 불러온 절 기준 is-empty 갱신
    const multiChapter = this.loaded.verses.some(
      (v) => v.chapter !== this.loaded!.verses[0].chapter,
    );

    this.loaded.verses.forEach((verse, idx) => {
      const text = verse.texts[this.version];
      const row = this.listEl.createDiv({
        cls: `bible-verse-row${this.highlight === idx ? " is-highlighted" : ""}${
          text ? "" : " is-disabled"
        }`,
      });

      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = this.selected.has(verse.linkTarget) && !!text;
      checkbox.disabled = !text;
      checkbox.tabIndex = -1;
      checkbox.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleVerse(verse.linkTarget);
      });

      row.createSpan({
        cls: "bible-verse-num",
        text: multiChapter ? `${verse.chapter}:${verse.verse}` : String(verse.verse),
      });
      row.createSpan({
        cls: "bible-verse-text",
        text: text ? text.replace(/\s*\n\s*/g, " ") : `(${this.version} 본문 없음)`,
      });

      this.registerHover(row, verse.linkTarget);
      row.addEventListener("click", () => {
        if (!text) return;
        this.highlight = idx;
        this.toggleVerse(verse.linkTarget);
      });
    });
    this.updateInsertButton();
  }

  /**
   * 키워드 검색 결과 목록(필터를 거친 keywordView) — "책 장:절" 라벨 + 매칭 하이라이트.
   * 완전 일치는 잘리지 않으므로 수백~수천 행이 될 수 있어
   * 청크 단위로 렌더링하고, 선택·하이라이트는 재렌더링 없이 증분 갱신한다.
   */
  private renderKeywordList() {
    this.listEl.empty();
    this.keywordRows = [];
    this.keywordChecks.clear();
    const hits = this.keywordView;
    const token = ++this.renderToken;
    this.updateInsertButton();

    if (hits.length === 0 && this.keywordHits && this.keywordHits.length > 0) {
      this.renderFilterEmpty();
      return;
    }

    const CHUNK = 400;
    const renderChunk = (start: number) => {
      if (token !== this.renderToken) return; // 새 렌더가 시작됨 — 이 세대 폐기
      const end = Math.min(start + CHUNK, hits.length);
      for (let i = start; i < end; i++) {
        // 완전 일치(정경 순)가 끝나고 유사(관련성 순)가 시작되는 자리 — keywordRows에는 넣지 않는다
        if (hits[i].tier === "partial" && (i === 0 || hits[i - 1].tier !== "partial")) {
          this.renderTierDivider();
        }
        this.renderKeywordRow(hits[i], i);
      }
      if (end < hits.length) window.setTimeout(() => renderChunk(end), 0);
    };
    renderChunk(0);
  }

  /** 유사 결과 구분선 — 필터는 이미 찾은 유사 결과(상한 안) 안에서 좁혀 본다는 점을 밝힌다 */
  private renderTierDivider() {
    const shown = (this.keywordHits ?? []).filter((h) => h.tier === "partial").length;
    const capped = this.keywordPartialTotal > shown;
    const divider = this.listEl.createDiv({
      cls: "bible-verse-tier-divider",
      text: `일부 단어만 들어 있는 절 · ${capped ? `관련성 상위 ${shown}절` : "관련성 순"}`,
    });
    divider.title = capped
      ? `검색어의 일부 단어만 들어 있는 절 ${this.keywordPartialTotal.toLocaleString()}절 가운데 관련성이 높은 ${shown}절입니다. 범위·권·장 필터는 이 ${shown}절 안에서 좁혀 봅니다.`
      : "검색어의 일부 단어만 들어 있는 절입니다 (관련성 높은 순).";
  }

  /** 필터를 거친 결과가 0줄 — 원인과 되돌리기 버튼 */
  private renderFilterEmpty() {
    const empty = this.listEl.createDiv({ cls: "bible-verse-filter-empty" });
    empty.createSpan({
      text: this.selectedOnly ? "고른 절이 없습니다." : "이 범위에는 결과가 없습니다.",
    });
    const btn = empty.createEl("button", {
      cls: "bible-verse-chip is-toggle",
      text: this.selectedOnly ? "목록으로" : "필터 해제",
    });
    btn.tabIndex = -1;
    btn.addEventListener("click", () => {
      if (this.selectedOnly) {
        this.selectedOnly = false;
        this.refreshKeywordView();
      } else {
        this.applyKeywordFilter(NO_FILTER);
      }
    });
  }

  // ── 단어 검색 결과 필터 (범위 › 권 › 장) ─────────────────

  /** 필터·모아 보기 상태로 keywordView를 다시 계산하고 막대·목록·컨텍스트를 그린다 (다시 검색하지 않음) */
  private refreshKeywordView() {
    const hits = this.keywordHits ?? [];
    this.keywordView = this.selectedOnly
      ? hits.filter((h) => this.selected.has(h.entry.linkTarget))
      : applyFilter(hits, this.filter);
    this.highlight = -1;
    this.renderList();
    this.renderContext();
    // 누른 칩은 다시 그려지며 사라진다 — 포커스를 입력창 존으로 돌려 ↓·타이핑이 바로 이어지게
    this.inputEl.focus();
  }

  /** 칩 클릭 — 선택(체크)은 그대로 두고 보기만 바꾼다 */
  private applyKeywordFilter(next: ResultFilter) {
    if (!this.keywordHits) return;
    this.filter = next;
    this.selectedOnly = false;
    this.refreshKeywordView();
  }

  /**
   * 필터 막대 — 1줄 범위(전체·구약·신약) + 「모든 단어만」 + (선택 N), 2줄 권, 권을 고르면 3줄 장.
   * 칩 숫자는 그 칩을 눌렀을 때 나오는 줄 수다(각 칩은 자기 차원만 빼고 나머지 필터를 반영해 센다).
   * 결과가 1절 이하이고 걸린 필터도 없으면 그리지 않는다(참조 모드·0건 포함).
   */
  private renderFilterBar() {
    this.filterEl.empty();
    const hits = this.keywordHits;
    if (!hits || (hits.length < 2 && !isFiltered(this.filter) && !this.selectedOnly)) return;
    const f = this.filter;
    const facets = facetCounts(hits, f);
    // 모아 보기 중에는 필터가 잠시 빠져 있다는 표시로 흐리게 (누르면 모아 보기를 끝내고 그 필터로)
    this.filterEl.toggleClass("is-picking", this.selectedOnly);

    const top = this.filterRow("범위");
    this.filterChip(top, "전체", facets.total, !f.testament, selectTestament(f, null));
    for (const t of ["구약", "신약"] as const) {
      this.filterChip(top, t, facets.testaments[t], f.testament === t, selectTestament(f, t));
    }
    if (facets.mixedTiers) {
      const exactBtn = this.filterChip(top, "모든 단어만", facets.exact, f.exactOnly, {
        ...f,
        exactOnly: !f.exactOnly,
      });
      exactBtn.addClass("bible-verse-filter-exact");
      exactBtn.title = "검색어의 모든 단어가 들어 있는 절만 보기 (일부 단어만 든 유사 결과 숨김)";
    }
    const picked = this.selectedKeywordEntries().length;
    if (picked > 0 || this.selectedOnly) {
      const btn = top.createEl("button", {
        cls: `bible-verse-chip bible-verse-filter-chip bible-verse-filter-picked${
          this.selectedOnly ? " is-active" : ""
        }`,
      });
      btn.createSpan({ text: "선택" });
      btn.createSpan({ cls: "bible-verse-filter-count", text: picked.toLocaleString() });
      btn.title = this.selectedOnly
        ? "모아 보기 끝내기 — 필터 화면으로"
        : "고른 절만 모아 보기 — 다른 권·장에서 고른 절도 함께 삽입·복사됩니다";
      btn.tabIndex = -1;
      btn.addEventListener("click", () => {
        this.selectedOnly = !this.selectedOnly;
        this.refreshKeywordView();
      });
    }

    const bookRow = this.filterRow("권");
    if (!f.book) {
      const books = this.expandedChips.has("권")
        ? facets.books
        : collapseChips(facets.books, BOOK_CHIPS_INITIAL);
      for (const b of books) {
        this.filterChip(bookRow, b.name, b.count, false, selectBook(f, b.abbrev));
      }
      this.moreChip(bookRow, "권", facets.books.length, BOOK_CHIPS_INITIAL);
      return;
    }

    // 권을 고르면 권 줄은 「‹ 모든 권 + 고른 권」으로 줄고 장 줄이 생긴다
    const allBooks = this.filterChip(bookRow, "‹ 모든 권", null, false, selectBook(f, null));
    allBooks.title = "권 선택 풀기";
    const current = facets.books.find((b) => b.abbrev === f.book);
    const bookCount = current?.count ?? 0;
    const bookBtn = this.filterChip(
      bookRow,
      current?.name ?? f.book,
      bookCount,
      true,
      selectBook(f, f.book),
    );
    bookBtn.createSpan({ cls: "bible-verse-filter-x", text: "✕" });
    bookBtn.title = "권 선택 풀기";

    const chapterRow = this.filterRow("장");
    this.filterChip(chapterRow, "전체", bookCount, f.chapter === null, selectChapter(f, null));
    const chapters = this.expandedChips.has("장")
      ? facets.chapters
      : collapseChips(facets.chapters, CHAPTER_CHIPS_INITIAL, (c) => c.chapter === f.chapter);
    for (const c of chapters) {
      const active = f.chapter === c.chapter;
      this.filterChip(chapterRow, `${c.chapter}장`, c.count, active, selectChapter(f, c.chapter));
    }
    this.moreChip(chapterRow, "장", facets.chapters.length, CHAPTER_CHIPS_INITIAL);
  }

  /** 필터 막대 한 줄 — 왼쪽 라벨 + 칩 자리(칩이 여러 줄로 감겨도 라벨 오른쪽에 맞춰진다) */
  private filterRow(label: string): HTMLElement {
    const row = this.filterEl.createDiv({ cls: "bible-verse-filter-row" });
    row.createSpan({ cls: "bible-verse-context-label bible-verse-filter-label", text: label });
    return row.createDiv({ cls: "bible-verse-filter-chips" });
  }

  /** 필터 칩 — 0건은 흐리게·못 누름(이미 고른 칩은 0이어도 눌러서 풀 수 있게). count가 null이면 숫자 없음 */
  private filterChip(
    parent: HTMLElement,
    label: string,
    count: number | null,
    active: boolean,
    next: ResultFilter,
  ): HTMLButtonElement {
    const btn = parent.createEl("button", { cls: "bible-verse-chip bible-verse-filter-chip" });
    // 모아 보기 중에는 걸린 칩도 강조하지 않는다 — 지금 목록은 필터가 아니라 고른 절이므로
    btn.toggleClass("is-active", active && !this.selectedOnly);
    btn.createSpan({ text: label });
    if (count !== null) {
      btn.createSpan({ cls: "bible-verse-filter-count", text: count.toLocaleString() });
    }
    btn.tabIndex = -1;
    if (count === 0 && !active) btn.disabled = true;
    // 모아 보기 중에 이미 걸린 칩을 누르면 해제가 아니라 그 필터 화면으로 돌아간다
    const target = this.selectedOnly && active ? this.filter : next;
    btn.addEventListener("click", () => this.applyKeywordFilter(target));
    return btn;
  }

  /** 칩이 한도보다 많을 때만 [더보기 (N권)]/[접기] — 숨긴 칩도 전부 닿을 수 있게 (「외 N개」 금지) */
  private moreChip(parent: HTMLElement, unit: "권" | "장", total: number, limit: number) {
    if (total <= limit) return;
    const expanded = this.expandedChips.has(unit);
    const btn = parent.createEl("button", {
      cls: "bible-verse-chip is-toggle",
      text: expanded ? "접기" : `더보기 (${total}${unit})`,
    });
    btn.tabIndex = -1;
    btn.addEventListener("click", () => {
      if (expanded) this.expandedChips.delete(unit);
      else this.expandedChips.add(unit);
      this.renderFilterBar(); // 목록은 그대로 — 막대만 다시 그린다
      (this.highlight >= 0 ? this.listEl : this.inputEl).focus();
    });
  }

  private renderKeywordRow(hit: SearchHit, idx: number) {
    const entry = hit.entry;
    const currentText = entry.texts[this.version];
    const row = this.listEl.createDiv({
      cls: `bible-verse-row${this.highlight === idx ? " is-highlighted" : ""}${
        currentText ? "" : " is-disabled"
      }`,
    });
    this.keywordRows[idx] = row;

    const checkbox = row.createEl("input", { type: "checkbox" });
    checkbox.checked = this.selected.has(entry.linkTarget) && !!currentText;
    checkbox.disabled = !currentText;
    checkbox.tabIndex = -1;
    checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleVerse(entry.linkTarget);
    });
    this.keywordChecks.set(entry.linkTarget, checkbox);

    row.createSpan({
      cls: "bible-verse-ref",
      text: `${entry.bookName} ${entry.chapter}:${entry.verse}`,
    });

    const textEl = row.createSpan({ cls: "bible-verse-text" });
    if (hit.version === this.version && currentText) {
      this.appendHighlighted(textEl, currentText, hit.matchedRanges);
    } else if (currentText) {
      // 다른 역본에서 매칭 — 현재 역본 본문을 보여주고 매칭 역본 뱃지 표시
      textEl.setText(currentText);
      row.createSpan({ cls: "bible-verse-badge", text: `${hit.version} 일치` });
    } else {
      // 현재 역본 본문 없음 — 매칭된 역본 본문을 대신 표시 (삽입은 불가)
      this.appendHighlighted(textEl, entry.texts[hit.version] ?? "", hit.matchedRanges);
      row.createSpan({ cls: "bible-verse-badge", text: `${hit.version} 본문` });
    }

    this.registerHover(row, entry.linkTarget);
    row.addEventListener("click", () => {
      if (!currentText) return;
      this.setKeywordHighlight(idx);
      this.toggleVerse(entry.linkTarget);
    });
  }

  /** 키워드 모드 하이라이트 이동 — 전체 재렌더링 없이 클래스만 갱신 */
  private setKeywordHighlight(idx: number) {
    if (this.highlight >= 0) this.keywordRows[this.highlight]?.removeClass("is-highlighted");
    this.highlight = idx;
    if (idx >= 0) this.keywordRows[idx]?.addClass("is-highlighted");
  }

  /** matchedRanges 구간을 <span class="bible-verse-match">로 감싸 하이라이트 */
  private appendHighlighted(
    el: HTMLElement,
    text: string,
    ranges: Array<[number, number]>,
  ) {
    let pos = 0;
    for (const [start, end] of ranges) {
      if (start > pos) el.appendText(text.slice(pos, start));
      el.createSpan({ cls: "bible-verse-match", text: text.slice(start, end) });
      pos = end;
    }
    if (pos < text.length) el.appendText(text.slice(pos));
  }

  // ── 인라인 미리보기 ────────────────────────────────────

  /**
   * 칩 클릭 시 모달 안 우측 패널에 노트 내용을 렌더링한다.
   * [열기]로만 실제 이동하고, 미리보기 안의 위키링크 클릭은 연쇄 미리보기로 이어진다.
   * fromNav=true면 뒤로가기 복귀라 히스토리에 push하지 않는다.
   */
  private async openPreview(opts: PreviewOpts, fromNav = false) {
    if (!fromNav) this.pushNav();
    this.currentPreview = opts;
    this.citeCurrent = null;
    this.syncCitingActive();
    const { file, title, heading, searchInput, highlightPaths } = opts;
    this.previewEl.empty();
    this.previewEl.addClass("is-open");
    this.modalEl.addClass("bible-verse-modal-expanded");
    this.previewOpen = true;

    const header = this.previewEl.createDiv({ cls: "bible-verse-preview-header" });
    // 본문 컨테이너는 헤더 다음에 미리 만들어 둔다 — [열기]가 인용 블록의 인접 헤딩을 찾을 때 참조
    const body = this.previewEl.createDiv({ cls: "bible-verse-preview-body" });
    const backBtn = header.createEl("button", {
      cls: "bible-verse-preview-back",
      text: "←",
    });
    backBtn.title = "이전 화면으로";
    backBtn.tabIndex = -1;
    backBtn.addEventListener("click", () => this.goBack());
    header.createSpan({ cls: "bible-verse-preview-title", text: title });
    const actions = header.createDiv({ cls: "bible-verse-preview-actions" });
    // 인용 위치 배지·이동 버튼 자리 — 본문 렌더 후 renderCiteNav가 채운다 (빈 채로 두면 CSS로 숨김)
    const citeNav = actions.createDiv({ cls: "bible-verse-cite-nav" });
    if (searchInput) {
      const searchBtn = actions.createEl("button", { text: "검색" });
      searchBtn.addEventListener("click", () => {
        this.pushNav(); // 미리보기 → 검색 전환도 뒤로가기로 복귀 가능
        this.closePreview();
        this.inputEl.value = searchInput;
        void this.runSearch();
        this.inputEl.focus();
      });
    }
    const openBtn = actions.createEl("button", { text: "열기", cls: "mod-cta" });
    openBtn.addEventListener("click", () => {
      // 주석은 pericope 헤딩으로, 인용한 설교는 현재 인용 블록의 인접 헤딩으로 (없으면 파일 맨 위)
      const sub = heading ?? this.nearestHeadingFor(body, this.citeCurrent, file);
      const linktext = sub ? `${file.path}#${sub}` : file.path;
      void this.app.workspace.openLinkText(linktext, "", true);
      this.close();
    });
    const closeBtn = actions.createEl("button", { text: "✕" });
    closeBtn.addEventListener("click", () => this.closePreview());

    let md = await this.app.vault.cachedRead(file);
    if (md.startsWith("---")) {
      const end = md.indexOf("\n---", 3);
      if (end !== -1) md = md.slice(end + 4);
    }
    if (heading) md = extractHeadingSection(md, heading);

    await MarkdownRenderer.render(this.app, md, body, file.path, this.previewComponent);
    // 렌더 중 다른 미리보기가 시작됐으면(칩 연타·뒤로가기) 이 body는 이미 분리된 상태
    if (this.currentPreview !== opts) return;

    if (highlightPaths && highlightPaths.length > 0) {
      const blocks = this.markCitations(body, file.path, highlightPaths);
      this.renderCiteNav(citeNav, body, blocks, file, highlightPaths);
    }

    // 미리보기 안의 위키링크 → 연쇄 미리보기 (모달을 떠나지 않음)
    body.addEventListener("click", (e) => {
      const anchor = (e.target as HTMLElement).closest("a.internal-link");
      if (!anchor) return;
      e.preventDefault();
      e.stopPropagation();
      const href = anchor.getAttribute("data-href") ?? anchor.getAttribute("href");
      if (!href) return;
      const linkpath = href.split("#")[0];
      const target = this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
      if (!target) return;
      const ref = parseLinkTarget(target.basename);
      void this.openPreview({
        file: target,
        title: ref ? formatReference(ref) : target.basename,
        searchInput: ref ? `${ref.abbrev}${ref.chapter}:${ref.verseStart}` : undefined,
      });
    });
  }

  private closePreview() {
    this.previewEl.empty();
    this.previewEl.removeClass("is-open");
    this.modalEl.removeClass("bible-verse-modal-expanded");
    this.previewOpen = false;
    this.currentPreview = null;
    this.citeCurrent = null;
    this.syncCitingActive();
  }

  /** 렌더된 링크·임베드 요소가 가리키는 노트 경로 — 미해석 링크는 null */
  private resolveRenderedLink(el: HTMLElement, sourcePath: string): string | null {
    const raw = el.matches("a")
      ? el.getAttribute("data-href") ?? el.getAttribute("href")
      : el.getAttribute("src");
    if (!raw) return null;
    const linkpath = raw.split("#")[0];
    return this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)?.path ?? null;
  }

  /**
   * 인용한 설교 미리보기: paths(검색 중인 절 노트 경로)를 가리키는 링크·임베드에 강조 클래스를
   * 붙이고, 그 컨테이너 블록(불릿·문단·콜아웃…)을 문서 순서로 중복 없이 돌려준다.
   * "인용 N곳"은 블록 단위 — 플러그인이 삽입한 범위 콜아웃(제목 링크 + 절별 링크)은 1곳.
   */
  private markCitations(body: HTMLElement, sourcePath: string, paths: string[]): HTMLElement[] {
    const wanted = new Set(paths);
    const blockSelector = "li, p, td, th, blockquote, h1, h2, h3, h4, h5, h6";
    const blocks: HTMLElement[] = [];
    const candidates = body.querySelectorAll<HTMLElement>("a.internal-link, .internal-embed[src]");
    for (const el of Array.from(candidates)) {
      const dest = this.resolveRenderedLink(el, sourcePath);
      if (!dest || !wanted.has(dest)) continue;
      el.addClass("bible-verse-cite");
      const block =
        el.closest<HTMLElement>(".callout") ??
        el.closest<HTMLElement>(blockSelector) ??
        el.parentElement ??
        el;
      if (blocks.includes(block)) continue;
      block.addClass("bible-verse-cite-block");
      blocks.push(block);
    }
    return blocks;
  }

  /**
   * 미리보기 본문(overflow 컨테이너) 안에서만 스크롤한다 — scrollIntoView는 모달·페이지 조상까지
   * 움직여 모달 상단 고정을 깨뜨릴 수 있다. 대상 블록을 상단 1/3 지점에 둔다.
   */
  private scrollPreviewTo(body: HTMLElement, el: HTMLElement) {
    const b = body.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    body.scrollTop += r.top - b.top - Math.max(0, (body.clientHeight - r.height) / 3);
  }

  /** 헤더의 "인용 N/M" 배지와 ↑/↓ 이동 버튼. 매치가 없으면 사유(속성에서만 인용 등)를 배지로 알린다 */
  private renderCiteNav(
    nav: HTMLElement,
    body: HTMLElement,
    blocks: HTMLElement[],
    file: TFile,
    paths: string[],
  ) {
    nav.empty();
    if (blocks.length === 0) {
      // resolvedLinks엔 잡히지만 본문 렌더엔 없는 경우: frontmatter 속성 링크(성경구절 등)가 대표적
      const wanted = new Set(paths);
      const fmOnly = (this.app.metadataCache.getFileCache(file)?.frontmatterLinks ?? []).some((l) => {
        const dest = this.app.metadataCache.getFirstLinkpathDest(l.link.split("#")[0], file.path);
        return !!dest && wanted.has(dest.path);
      });
      const badge = nav.createSpan({
        cls: "bible-verse-cite-badge is-empty",
        text: fmOnly ? "속성에서만 인용" : "인용 위치 없음",
      });
      badge.title = fmOnly
        ? "본문에는 링크가 없고 frontmatter 속성(예: 성경구절)에서만 인용했습니다"
        : "본문에서 이 구절로 가는 링크를 찾지 못했습니다";
      return;
    }

    let cur = 0;
    const badge = nav.createSpan({ cls: "bible-verse-cite-badge" });
    const show = (idx: number) => {
      blocks[cur].removeClass("is-current");
      cur = (idx + blocks.length) % blocks.length;
      blocks[cur].addClass("is-current");
      badge.setText(blocks.length === 1 ? "인용 1곳" : `인용 ${cur + 1}/${blocks.length}`);
      this.citeCurrent = blocks[cur];
      this.scrollPreviewTo(body, blocks[cur]);
    };
    if (blocks.length > 1) {
      const prev = nav.createEl("button", { text: "↑" });
      prev.title = "이전 인용 위치";
      prev.tabIndex = -1;
      prev.addEventListener("click", () => show(cur - 1));
      const next = nav.createEl("button", { text: "↓" });
      next.title = "다음 인용 위치";
      next.tabIndex = -1;
      next.addEventListener("click", () => show(cur + 1));
    }
    // 레이아웃이 확정된 뒤 첫 인용 위치로
    window.requestAnimationFrame(() => {
      if (body.isConnected) show(0);
    });
  }

  /**
   * 블록 바로 앞의 헤딩 텍스트 — 메타데이터 캐시의 헤딩과 정확히 일치할 때만 돌려준다.
   * (헤딩에 인라인 마크다운·링크가 있어 렌더 텍스트가 다르면 undefined → 파일 맨 위로 연다)
   */
  private nearestHeadingFor(
    body: HTMLElement,
    block: HTMLElement | null,
    file: TFile,
  ): string | undefined {
    if (!block) return undefined;
    let found: string | undefined;
    for (const h of Array.from(body.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"))) {
      // 헤딩이 블록보다 뒤에 있으면 중단
      if (!(h.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
      found = h.dataset.heading ?? h.textContent ?? undefined;
    }
    if (!found) return undefined;
    const target = found.trim();
    // 헤딩 자체가 위키링크(`## [[…]]`)이거나 #·|·^가 들어 있으면 `path#heading` 서브패스 문법이 깨진다
    if (/[[\]#|^]/.test(target)) return undefined;
    const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
    return headings.some((hc) => hc.heading.trim() === target) ? target : undefined;
  }

  /** Cmd 호버 시 옵시디언 페이지 미리보기 (hover-editor 설치 시 그쪽으로 연동) */
  private registerHover(el: HTMLElement, linktext: string) {
    el.addEventListener("mouseover", (event) => {
      this.app.workspace.trigger("hover-link", {
        event,
        source: "a4p-bible-verse",
        hoverParent: this,
        targetEl: el,
        linktext,
        sourcePath: "",
      });
    });
  }

  /** 하이라이트된 절(없으면 첫 절)의 관련구절·평행본문 칩 + 주석 + 연구 자료 + 인용한 설교 줄 */
  private renderContext() {
    this.contextEl.empty();
    if (this.keywordHits) {
      const hit = this.keywordView[Math.max(this.highlight, 0)];
      if (hit) void this.renderKeywordContext(hit);
      return;
    }
    if (!this.loaded || this.loaded.verses.length === 0) return;

    const verse = this.loaded.verses[Math.max(this.highlight, 0)] ?? this.loaded.verses[0];
    this.renderContextFor(verse);
  }

  /**
   * 키워드 모드: 인덱스에는 frontmatter(관련구절 등)가 없으므로
   * 하이라이트된 절 하나만 lazy 로드해 컨텍스트를 채운다 (1파일, ~1ms).
   */
  private async renderKeywordContext(hit: SearchHit) {
    const ref = parseLinkTarget(hit.entry.linkTarget);
    if (!ref) return;
    const outcome = await this.data.loadVerses(ref);
    // 하이라이트가 이미 다른 절로 이동했거나 필터·검색이 바뀌었으면 폐기
    const current = this.keywordHits ? this.keywordView[Math.max(this.highlight, 0)] : undefined;
    if (current !== hit) return;
    if (!outcome.ok || !outcome.result.verses[0]) return;
    const verse = outcome.result.verses[0];
    this.citing = this.data.citingNotes([verse.path ?? ""]);
    this.research = this.data.researchNotes([verse.path ?? ""]);
    this.contextEl.empty();
    this.renderContextFor(verse);
  }

  private renderContextFor(verse: VerseData) {
    const chipRow = (label: string, targets: string[], onClick: (t: string) => void) => {
      if (targets.length === 0) return;
      const row = this.contextEl.createDiv({ cls: "bible-verse-context-row" });
      row.createSpan({ cls: "bible-verse-context-label", text: label });
      for (const target of targets) {
        const btn = row.createEl("button", { cls: "bible-verse-chip" });
        const ref = parseLinkTarget(target);
        btn.setText(ref ? formatReference(ref) : target);
        btn.tabIndex = -1;
        this.registerHover(btn, target);
        btn.addEventListener("click", () => onClick(target));
      }
    };

    // 칩 클릭 = 모달 안 미리보기. 실제 이동은 미리보기의 [열기], 검색 전환은 [검색] 버튼.
    const previewTarget = (target: string) => {
      const ref = parseLinkTarget(target);
      const file = this.app.metadataCache.getFirstLinkpathDest(target, "");
      if (!file) {
        // 노트가 없으면(비정규 링크) 검색 전환으로 폴백
        // (미리보기가 열려 있으면 runSearch가 push하므로 여기선 목록 상태만 기록)
        if (!this.previewOpen) this.pushNav();
        this.inputEl.value = ref ? `${ref.abbrev}${ref.chapter}:${ref.verseStart}` : target;
        void this.runSearch();
        this.inputEl.focus();
        return;
      }
      void this.openPreview({
        file,
        title: ref ? formatReference(ref) : file.basename,
        searchInput: ref ? `${ref.abbrev}${ref.chapter}:${ref.verseStart}` : undefined,
      });
    };

    chipRow("관련구절", verse.related ?? [], previewTarget);
    chipRow("평행본문", verse.parallel ?? [], previewTarget);

    // 주석: 하이라이트된 절이 속한 장 통합주석의 pericope 헤딩으로 딥링크
    const commentary = this.data.findCommentary(
      verse.linkTarget.match(/^[가-힣]+/)?.[0] ?? "",
      verse.chapter,
      verse.verse,
    );
    if (commentary) {
      const row = this.contextEl.createDiv({ cls: "bible-verse-context-row" });
      row.createSpan({ cls: "bible-verse-context-label", text: "주석" });
      const btn = row.createEl("button", { cls: "bible-verse-chip is-note" });
      btn.setText(commentary.label);
      btn.tabIndex = -1;
      const linktext = commentary.heading
        ? `${commentary.path}#${commentary.heading}`
        : commentary.path;
      this.registerHover(btn, linktext);
      btn.addEventListener("click", () => {
        const file = this.app.vault.getAbstractFileByPath(commentary.path);
        if (!(file instanceof TFile)) return;
        void this.openPreview({
          file,
          title: commentary.label,
          heading: commentary.heading,
        });
      });
    }

    this.renderResearchRow(verse);
    this.renderCitingRow(verse);
  }

  /**
   * 인용 위치를 강조할 절 노트 경로 — 참조 모드 = 범위 전체, 키워드 모드 = 선택한 1절.
   * citingNotes·researchNotes 판정과 같은 집합이라, 목록에 떴으면 이 중 하나로 가는 링크가 있다.
   */
  private highlightPathsFor(verse: VerseData): string[] {
    return (this.loaded?.verses ?? [verse]).map((v) => v.path).filter((p): p is string => !!p);
  }

  /** 인용한 설교·연구 자료 줄·칩 클릭 — 미리보기에서 검색 구절의 인용 위치를 보여 준다 */
  private previewCitation(path: string, verse: VerseData) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    void this.openPreview({ file, title: file.basename, highlightPaths: this.highlightPathsFor(verse) });
  }

  /**
   * 연구 자료 — 연구 자료 폴더에서 검색 구절을 링크한 노트. 줄 모양은 인용한 설교와 같고(날짜 · 분류 ·
   * 제목 · 본문), 위 노트(견해 지도)가 링크한 하위 폴더 노트(원문 발췌)는 그 줄 아래 「원문 발췌 20 ▸」로
   * 접어 두었다가 누르면 칩으로 펼친다. 찾은 노트는 전부 닿을 수 있어야 한다(숨김 없음) — 위 노트가
   * CITING_INITIAL보다 많을 때만 [더보기]. 펼침 상태는 모달이 열려 있는 동안 유지된다.
   */
  private renderResearchRow(verse: VerseData) {
    if (this.research.length === 0) return;
    const root = this.data.researchRootPath();
    const colors = this.groupColors(root);
    // 이 구절을 많이 링크한(많이 다룬) 노트 먼저, 같으면 최신순
    const items = this.research.map((it) => ({
      path: it.path,
      hits: it.hits,
      meta: this.noteMeta(it.path, RESEARCH_DATE_KEYS),
      // 분류 = 연구 자료 폴더 아래 첫 폴더 (바로 아래 노트는 빈칸)
      group: sermonGroup(it.path, root),
      bundles: groupChildren(it.path, it.children, root).map((g) => {
        const labels = chipLabels(g.paths.map((p) => this.noteMeta(p, RESEARCH_DATE_KEYS).title));
        const chips = g.paths
          .map((path, i) => ({ path, label: labels[i] }))
          .sort((a, b) => a.label.localeCompare(b.label, "ko"));
        return { key: `${it.path}\n${g.label}`, label: g.label, chips };
      }),
    }));
    items.sort((a, b) => b.hits - a.hits || compareSermons(a, b));
    const hasGroups = items.some((it) => it.group);
    // 머리줄 요약 — 묶인 노트의 묶음별 합계 (연구 자료 1편 · 원문 발췌 20)
    const bundleTotals = new Map<string, number>();
    for (const it of items) {
      for (const b of it.bundles) {
        bundleTotals.set(b.label, (bundleTotals.get(b.label) ?? 0) + b.chips.length);
      }
    }
    const summary = Array.from(bundleTotals, ([label, n]) => ` · ${label} ${n}`).join("");

    const section = this.contextEl.createDiv({ cls: "bible-verse-citing bible-verse-research" });
    const fill = () => {
      section.empty();
      const collapsible = items.length > CITING_INITIAL;
      const expanded = collapsible && this.researchExpanded;
      const shown = collapsible && !expanded ? items.slice(0, CITING_INITIAL) : items;
      // 펼친 묶음·더보기가 있으면 목록 안에서 스크롤 (모달이 화면 밖으로 늘어나지 않게)
      section.toggleClass(
        "is-expanded",
        expanded || shown.some((it) => it.bundles.some((b) => this.researchOpen.has(b.key))),
      );

      const head = section.createDiv({ cls: "bible-verse-citing-head" });
      head.createSpan({
        cls: "bible-verse-context-label",
        text: `연구 자료 ${items.length}편${summary}`,
      });

      const list = section.createDiv({
        cls: `bible-verse-citing-list${hasGroups ? "" : " is-flat"}`,
      });
      for (const it of shown) {
        this.noteRow(list, it, hasGroups ? colors : null, verse);

        // 이 노트가 링크한 하위 폴더 노트 — 묶음마다 「원문 발췌 20 ▸」, 펼치면 그 아래 줄에 칩
        for (const b of it.bundles) {
          const open = this.researchOpen.has(b.key);
          const sub = list.createDiv({ cls: "bible-verse-research-sub" });
          const bundleEl = sub.createDiv({ cls: "bible-verse-research-bundle" });
          const toggle = bundleEl.createEl("button", {
            cls: "bible-verse-chip is-toggle",
            text: `${b.label} ${b.chips.length} ${open ? "▾" : "▸"}`,
          });
          toggle.tabIndex = -1;
          toggle.title = open ? "접기" : `${b.label} ${b.chips.length}개 펼치기`;
          toggle.addEventListener("click", () => {
            if (open) this.researchOpen.delete(b.key);
            else this.researchOpen.add(b.key);
            fill();
          });
          if (!open) continue;
          const chipsEl = bundleEl.createDiv({ cls: "bible-verse-research-chips" });
          for (const c of b.chips) {
            const chip = chipsEl.createEl("button", {
              cls: "bible-verse-chip is-note bible-verse-research-chip",
              text: c.label,
            });
            chip.dataset.path = c.path;
            chip.title = c.path;
            chip.tabIndex = -1;
            this.registerHover(chip, c.path);
            chip.addEventListener("click", () => this.previewCitation(c.path, verse));
          }
        }
      }
      this.syncCitingActive();

      if (collapsible) {
        const toggle = section.createEl("button", {
          cls: "bible-verse-chip is-toggle",
          text: expanded ? "접기" : "더보기",
        });
        toggle.tabIndex = -1;
        toggle.addEventListener("click", () => {
          this.researchExpanded = !this.researchExpanded;
          fill();
        });
      }
    };
    fill();
  }

  /**
   * 인용한 설교 — 최신순 목록(날짜 · 부서 · 제목 · 본문 열 맞춤). 찾은 노트는 전부 닿을 수 있어야 한다
   * ("외 N개"로 숨기지 않음). CITING_INITIAL보다 많을 때만 앞부분 뒤에 [더보기], 펼치면 [접기].
   * 날짜·본문은 파일명에서(sermon-meta), 부서는 설교 폴더 바로 아래 폴더. 버튼은 이 목록만 다시 그린다.
   */
  private renderCitingRow(verse: VerseData) {
    if (this.citing.length === 0) return;
    const root = normalizeFolderPath(this.plugin.settings.sermonFolder);
    const colors = this.groupColors(root);
    // 부서: 설교 폴더 아래 분류 폴더 → 파일명 날짜 뒤 부서 표시 → 없으면 빈칸
    const items = this.citing
      .map((path) => {
        const meta = this.noteMeta(path, SERMON_DATE_KEYS);
        return { path, meta, group: sermonGroup(path, root) ?? meta.dept };
      })
      .sort(compareSermons);
    const hasGroups = items.some((it) => it.group);
    const counts = new Map<string, number>();
    for (const it of items) if (it.group) counts.set(it.group, (counts.get(it.group) ?? 0) + 1);

    const section = this.contextEl.createDiv({ cls: "bible-verse-citing" });
    const fill = () => {
      section.empty();
      const collapsible = items.length > CITING_INITIAL;
      const expanded = collapsible && this.citingExpanded;
      section.toggleClass("is-expanded", expanded);

      const head = section.createDiv({ cls: "bible-verse-citing-head" });
      head.createSpan({ cls: "bible-verse-context-label", text: `인용한 설교 ${items.length}편` });
      // 부서가 둘 이상이면 부서별 편수 (목록 배지와 같은 색)
      if (counts.size >= 2) {
        for (const [group, n] of Array.from(counts).sort((a, b) => b[1] - a[1])) {
          this.groupBadge(head, group, colors, `${group} ${n}`);
        }
      }

      const list = section.createDiv({
        cls: `bible-verse-citing-list${hasGroups ? "" : " is-flat"}`,
      });
      for (const it of collapsible && !expanded ? items.slice(0, CITING_INITIAL) : items) {
        this.noteRow(list, it, hasGroups ? colors : null, verse);
      }
      this.syncCitingActive();

      if (collapsible) {
        const toggle = section.createEl("button", {
          cls: "bible-verse-chip is-toggle",
          text: expanded ? "접기" : "더보기",
        });
        toggle.tabIndex = -1;
        toggle.addEventListener("click", () => {
          this.citingExpanded = !this.citingExpanded;
          fill();
        });
      }
    };
    fill();
  }

  /**
   * 인용한 설교·연구 자료 목록의 한 줄 — 날짜 · 부서/분류 배지 · 제목(+꼬리표) · 본문 (subgrid 열 맞춤).
   * colors가 null이면 목록에 배지 열이 없다(is-flat). 클릭 = 미리보기에서 검색 구절의 인용 위치.
   */
  private noteRow(
    list: HTMLElement,
    it: { path: string; meta: SermonMeta; group?: string },
    colors: Map<string, number> | null,
    verse: VerseData,
  ) {
    const row = list.createDiv({ cls: "bible-verse-citing-item" });
    row.dataset.path = it.path;
    row.title = it.path;
    row.createSpan({
      cls: "bible-verse-citing-date",
      text: it.meta.date ? formatSermonDate(it.meta.date) : "—",
    });
    if (colors) {
      if (it.group) this.groupBadge(row, it.group, colors);
      else row.createSpan(); // 배지 열 자리
    }
    const title = row.createSpan({ cls: "bible-verse-citing-title" });
    title.createSpan({ cls: "bible-verse-citing-title-text", text: it.meta.title });
    if (it.meta.tag) title.createSpan({ cls: "bible-verse-citing-tag", text: it.meta.tag });
    row.createSpan({ cls: "bible-verse-citing-passage", text: it.meta.passage ?? "" });
    this.registerHover(row, it.path);
    row.addEventListener("click", () => this.previewCitation(it.path, verse));
  }

  /**
   * 파일명에서 날짜·제목·본문을 읽고, 날짜가 없으면 노트 속성(dateKeys 순서 — 설교는 date·설교일,
   * 연구 노트는 date·created)으로 보충
   */
  private noteMeta(path: string, dateKeys: readonly string[]): SermonMeta {
    const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
    // 수강생마다 이름 규칙이 달라도 목록은 떠야 한다 — 뜻밖의 실패는 이름만 보여 주는 행으로
    try {
      const meta = parseSermonName(basename);
      if (!meta.date) {
        const fm = this.app.metadataCache.getCache(path)?.frontmatter;
        for (const key of dateKeys) {
          meta.date = dateFromProperty(fm?.[key]);
          if (meta.date) break;
        }
      }
      return meta;
    } catch (e) {
      console.error("[a4p-bible-verse] 노트 이름 판독 실패:", path, e);
      return { title: basename };
    }
  }

  /**
   * 폴더 부서 → 색 번호: 설교 폴더 아래 분류 폴더(연도 폴더 안의 분류 포함)의 이름순 자리라
   * 검색마다 바뀌지 않는다. 설교 폴더를 지정하지 않았으면 빈 지도(파일명 부서는 labelColor로).
   */
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

  private groupBadge(parent: HTMLElement, group: string, colors: Map<string, number>, text = group) {
    const color = colors.get(group) ?? labelColor(group, GROUP_COLORS);
    parent.createSpan({ cls: `bible-verse-citing-group is-c${color}`, text });
  }

  /** 미리보기 중인 설교·연구 자료 줄(과 묶음 칩) 표시 — 미리보기가 바뀌거나 닫히면 따라간다 */
  private syncCitingActive() {
    const open = this.currentPreview?.file.path;
    this.contextEl
      .querySelectorAll<HTMLElement>(".bible-verse-citing-item, .bible-verse-research-chip")
      .forEach((row) => row.toggleClass("is-active", row.dataset.path === open));
  }

  private updateInsertButton() {
    if (!this.editor) {
      this.insertBtnEl.setText("삽입");
      this.insertBtnEl.disabled = true;
      this.insertBtnEl.title = "편집 중인 노트가 없습니다 — 복사만 가능합니다";
      return;
    }
    const verses = this.insertableVerses();
    const count = verses.length;
    this.insertBtnEl.setText(count > 0 ? `${count}절 삽입` : "삽입");
    this.insertBtnEl.disabled = count === 0;
    // 필터로 가려진 줄에서 고른 절도 함께 들어간다 — 숫자만 보고 놀라지 않게
    const visible = this.keywordHits
      ? new Set(this.keywordView.map((h) => h.entry.linkTarget))
      : null;
    const hidden = visible ? verses.filter((v) => !visible.has(v.linkTarget)).length : 0;
    this.insertBtnEl.title = hidden > 0 ? `다른 권·장에서 고른 ${hidden}절 포함` : "";
  }

  /** 삽입 직전 편집기 확인 — 복사 전용 모드면 안내 후 null */
  private requireEditor(): Editor | null {
    if (!this.editor) {
      new Notice("편집 중인 노트가 없어 삽입할 수 없습니다. 복사(Cmd+Shift+C)를 이용해주세요.");
    }
    return this.editor;
  }

  // ── 상태 조작 ─────────────────────────────────────────

  private toggleVerse(linkTarget: string) {
    if (this.selected.has(linkTarget)) this.selected.delete(linkTarget);
    else this.selected.add(linkTarget);
    if (this.keywordHits) {
      // 대형 목록 재렌더링 없이 해당 체크박스만 동기화
      const check = this.keywordChecks.get(linkTarget);
      if (check) check.checked = this.selected.has(linkTarget);
      this.updateInsertButton();
      this.renderFilterBar(); // (선택 N) 숫자
      this.renderContext();
      return;
    }
    this.renderList();
    this.renderContext();
  }

  private setVersion(v: Version) {
    this.version = v;
    sessionVersion = v;
    this.renderVersionBar();
    if (this.keywordHits) {
      // 키워드 매칭은 역본 종속 — 바뀐 역본으로 재검색 (보던 범위·권·장은 그대로)
      this.restoreFilter = { query: this.inputEl.value.trim(), filter: this.filter };
      void this.runSearch();
      return;
    }
    this.renderReferenceStatus();
    this.renderList();
  }

  /** 설정의 등록 역본 이름 (순서 = 버튼·Tab 순서) */
  private names(): string[] {
    return versionNames(this.plugin.settings.versions);
  }

  /** 목록에 없는 역본(설정에서 뺀 뒤 남은 세션 값 등)은 기본 역본 → 첫 항목으로 되돌린다 */
  private resolveVersion(candidate: string | null): Version {
    const names = this.names();
    if (candidate && names.includes(candidate)) return candidate;
    const def = this.plugin.settings.defaultVersion;
    return names.includes(def) ? def : names[0];
  }

  /** 모달 내부 상태만 방어한다 — 설정값 자체는 sanitizeVersionSettings가 보장 */
  private syncVersionState() {
    this.version = this.resolveVersion(this.version);
    if (
      this.secondary &&
      (this.secondary === this.version || !this.names().includes(this.secondary))
    ) {
      this.secondary = null;
    }
  }

  private cycleVersion(dir: 1 | -1) {
    const names = this.names();
    const idx = Math.max(0, names.indexOf(this.version));
    this.setVersion(names[(idx + dir + names.length) % names.length]);
  }

  private moveHighlight(dir: 1 | -1) {
    const count = this.keywordHits ? this.keywordView.length : (this.loaded?.verses.length ?? 0);
    if (count === 0) return;
    const next = this.highlight + dir;
    if (next < 0) {
      this.focusInput();
      return;
    }
    if (this.keywordHits) {
      this.setKeywordHighlight(Math.min(next, count - 1));
      this.listEl.focus();
      this.renderContext();
      this.keywordRows[this.highlight]?.scrollIntoView({ block: "nearest" });
      return;
    }
    this.highlight = Math.min(next, count - 1);
    this.listEl.focus();
    this.renderList();
    this.renderContext();
    const row = this.listEl.children[this.highlight];
    if (row instanceof HTMLElement) row.scrollIntoView({ block: "nearest" });
  }

  private focusInput() {
    if (this.keywordHits) {
      this.setKeywordHighlight(-1);
    } else {
      this.highlight = -1;
      this.renderList();
    }
    this.inputEl.focus();
    this.inputEl.select();
  }

  private onListKeydown(e: KeyboardEvent) {
    if (e.key === " ") {
      e.preventDefault();
      const verse = this.keywordHits
        ? this.keywordView[this.highlight]?.entry
        : this.loaded?.verses[this.highlight];
      if (verse && verse.texts[this.version]) this.toggleVerse(verse.linkTarget);
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
    if (this.keywordHits) {
      // 지금 보이는 줄(필터)만 더하거나 뺀다 — 다른 권·장에서 고른 절은 그대로
      const visible = this.keywordView.map((h) => h.entry).filter((v) => v.texts[this.version]);
      if (visible.length === 0) return;
      const allSelected = visible.every((v) => this.selected.has(v.linkTarget));
      for (const v of visible) {
        if (allSelected) this.selected.delete(v.linkTarget);
        else this.selected.add(v.linkTarget);
      }
      // 렌더링된 체크박스만 동기화 (미렌더 청크는 생성 시 selected를 반영)
      for (const [linkTarget, check] of this.keywordChecks) {
        check.checked = this.selected.has(linkTarget) && !check.disabled;
      }
      this.updateInsertButton();
      this.renderFilterBar(); // (선택 N) 숫자
      return;
    }
    const items = this.loaded?.verses;
    if (!items) return;
    const insertable = items.filter((v) => v.texts[this.version]);
    const allSelected = insertable.every((v) => this.selected.has(v.linkTarget));
    if (allSelected) this.selected.clear();
    else this.selected = new Set(insertable.map((v) => v.linkTarget));
    this.renderList();
  }

  // ── 삽입 ──────────────────────────────────────────────

  private insertableVerses() {
    if (this.keywordHits) {
      return this.selectedKeywordEntries();
    }
    if (!this.loaded) return [];
    return this.loaded.verses.filter(
      (v) => this.selected.has(v.linkTarget) && v.texts[this.version],
    );
  }

  /** 키워드 모드에서 선택된(+현재 역본 본문이 있는) 절들 — 정경 순 */
  private selectedKeywordEntries(): IndexEntry[] {
    if (!this.keywordHits) return [];
    return this.keywordHits
      .filter((h) => this.selected.has(h.entry.linkTarget) && h.entry.texts[this.version])
      .map((h) => h.entry)
      .sort((a, b) => a.sortKey - b.sortKey);
  }

  /** 인덱스 엔트리 → 삽입용 절 데이터 (각주 정리 설정을 삽입 시점에 적용) */
  private toInsertableEntries(entries: IndexEntry[]): IndexEntry[] {
    if (!this.plugin.settings.stripAnnotations) return entries;
    return entries.map((entry) => {
      const texts = { ...entry.texts };
      for (const key of Object.keys(texts)) {
        texts[key] = stripAnnotations(texts[key]!);
      }
      return { ...entry, texts };
    });
  }

  /** 키워드 결과는 여러 책·장에 걸치므로 책+장 그룹별로 블록을 만들어 이어 붙인다 */
  private formatKeywordBlock(entries: IndexEntry[], kind: "insert" | "plain"): string {
    const groups = groupForInsert(this.toInsertableEntries(entries));
    return groups
      .map((group) => {
        const opts = {
          bookName: group.bookName,
          chapter: group.chapter,
          version: this.version,
          secondaryVersion: this.secondary ?? undefined,
          wholeChapter: false,
          format: this.plugin.settings.insertFormat,
          verseNewline: this.plugin.settings.verseNewline,
        };
        return kind === "plain"
          ? formatPlainVerses(group.verses, opts)
          : formatVerses(group.verses, opts);
      })
      .join("\n");
  }

  private insertSelected(close: boolean) {
    const editor = this.requireEditor();
    if (!editor) return;
    if (this.keywordHits) {
      const entries = this.selectedKeywordEntries();
      if (entries.length === 0) {
        new Notice("삽입할 절이 없습니다. 목록에서 절을 먼저 선택해주세요.");
        return;
      }
      const block = this.formatKeywordBlock(entries, "insert");
      if (!insertBlock(this.app, block, editor)) return;
      if (close) this.close();
      return;
    }
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
      secondaryVersion: this.secondary ?? undefined,
      wholeChapter,
      format: this.plugin.settings.insertFormat,
      verseNewline: this.plugin.settings.verseNewline,
    });
    if (!insertBlock(this.app, block, editor)) return;
    if (close) this.close();
  }

  /** Cmd+Shift+C: 선택된 절을 플레인 텍스트(콜아웃·wikilink 없음)로 클립보드 복사 */
  private async copySelected() {
    if (this.keywordHits) {
      const entries = this.selectedKeywordEntries();
      if (entries.length === 0) {
        new Notice("복사할 절이 없습니다. 목록에서 절을 먼저 선택해주세요.");
        return;
      }
      await navigator.clipboard.writeText(this.formatKeywordBlock(entries, "plain"));
      new Notice("클립보드에 복사됨 (플레인 텍스트)");
      return;
    }
    if (!this.ref || !this.loaded) return;
    const verses = this.insertableVerses();
    if (verses.length === 0) {
      new Notice("복사할 절이 없습니다.");
      return;
    }
    const wholeChapter =
      this.ref.verseStart === undefined && verses.length === this.loaded.verses.length;
    const text = formatPlainVerses(verses, {
      bookName: this.ref.bookName,
      chapter: this.ref.chapter,
      version: this.version,
      secondaryVersion: this.secondary ?? undefined,
      wholeChapter,
    });
    await navigator.clipboard.writeText(text);
    new Notice("클립보드에 복사됨 (플레인 텍스트)");
  }

  /** Cmd+Enter: 하이라이트된 절(기본 첫 절) 1개만 삽입하고 모달 유지 — 연속 삽입 모드 */
  private insertHighlighted() {
    const editor = this.requireEditor();
    if (!editor) return;
    if (this.keywordHits) {
      const idx = this.highlight >= 0 ? this.highlight : 0;
      const entry = this.keywordView[idx]?.entry;
      if (!entry) return;
      if (!entry.texts[this.version]) {
        new Notice(`이 절에는 ${this.version} 본문이 없습니다.`);
        return;
      }
      const block = this.formatKeywordBlock([entry], "insert");
      if (!insertBlock(this.app, block, editor)) return;
      new Notice(`${entry.bookName} ${entry.chapter}:${entry.verse} 삽입됨 (${this.version})`);
      this.focusInput();
      return;
    }
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
      secondaryVersion: this.secondary ?? undefined,
      wholeChapter: false,
      format: this.plugin.settings.insertFormat,
      verseNewline: this.plugin.settings.verseNewline,
    });
    if (!insertBlock(this.app, block, editor)) return;
    new Notice(`${this.ref.bookName} ${verse.chapter}:${verse.verse} 삽입됨 (${this.version})`);
    this.focusInput();
  }
}
