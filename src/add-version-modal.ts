import { App, Modal, Setting } from "obsidian";
import { QuoteTitleScan } from "./bible-data";
import type BibleVersePlugin from "./main";
import { normalizeVersionName, shortLabel, versionNames } from "./versions";

/** 삽입 헤더 `(ESV)`·콜아웃 줄을 깨뜨리는 문자 */
const FORBIDDEN_CHARS = /[[\]|]/;

type CheckKind = "muted" | "ok" | "warn" | "error";

export interface AddVersionResult {
  name: string;
  short?: string;
  /** 표본 노트에서 콜아웃을 하나라도 찾았는가 — 설정 탭 안내 문구용 */
  foundInSamples: boolean;
}

/** 대소문자·띄어쓰기만 다른 제목 찾기용 */
const fold = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/**
 * 역본 추가 모달. 콜아웃 제목(필수)·버튼 짧은 이름(선택)을 받고, 열릴 때 표본 노트 3곳을 한 번
 * 읽어 두었다가 입력할 때마다 즉시 대조한다. 0건이어도 등록은 허용하되 버튼이 "그래도 추가"로
 * 바뀐다. Esc·바깥 클릭·취소는 null.
 */
export class AddVersionModal extends Modal {
  private decided = false;
  private nameInput!: HTMLInputElement;
  private shortInput!: HTMLInputElement;
  private detectedEl!: HTMLElement;
  private checkEl!: HTMLElement;
  private recheckBtn!: HTMLButtonElement;
  private addBtn!: HTMLButtonElement;
  private scan: QuoteTitleScan | null = null;
  private scanning = false;
  /** 현재 입력이 유효하면 제출할 값 — refresh()가 갱신 */
  private valid: { name: string; short?: string; found: boolean } | null = null;

  private constructor(
    app: App,
    private plugin: BibleVersePlugin,
    private resolve: (result: AddVersionResult | null) => void,
  ) {
    super(app);
  }

  /** 모달을 열고, 추가됐으면 그 역본을, 취소면 null을 돌려준다 */
  static ask(app: App, plugin: BibleVersePlugin): Promise<AddVersionResult | null> {
    return new Promise((resolve) => new AddVersionModal(app, plugin, resolve).open());
  }

  onOpen() {
    this.titleEl.setText("역본 추가");
    const { contentEl } = this;
    this.detectedEl = contentEl.createDiv({ cls: "bible-verse-version-detected" });

    new Setting(contentEl)
      .setName("콜아웃 제목")
      .setDesc(
        "구절 노트의 `> [!quote] ESV` 줄에 적힌 이름 그대로 입력하세요. 띄어쓰기와 영문 대소문자까지 같아야 찾습니다.",
      )
      .addText((text) => {
        text.setPlaceholder("예: ESV");
        this.nameInput = text.inputEl;
        text.inputEl.addEventListener("input", () => this.refresh());
      });

    new Setting(contentEl)
      .setName("버튼 짧은 이름 (선택)")
      .setDesc("모달의 역본 버튼에 보일 이름입니다 (6자 이내). 비우면 이름 그대로 씁니다.")
      .addText((text) => {
        text.setPlaceholder("예: 개역");
        text.inputEl.maxLength = 6;
        this.shortInput = text.inputEl;
        text.inputEl.addEventListener("input", () => this.refresh());
      });

    const checkRow = contentEl.createDiv({ cls: "bible-verse-add-check-row" });
    this.checkEl = checkRow.createDiv({ cls: "bible-verse-add-check" });
    this.recheckBtn = checkRow.createEl("button", { text: "다시 확인" });
    this.recheckBtn.title = "노트에 콜아웃을 방금 넣었다면 표본 노트를 다시 읽습니다";
    this.recheckBtn.addEventListener("click", () => void this.rescan());

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: "취소" });
    cancel.addEventListener("click", () => this.finish(null));
    this.addBtn = buttons.createEl("button", { text: "추가", cls: "mod-cta" });
    this.addBtn.addEventListener("click", () => this.submit());

    this.scope.register([], "Enter", (e) => {
      if (e.isComposing) return; // 한글 조합을 확정하는 Enter는 제출이 아니다
      e.preventDefault();
      this.submit();
    });

    this.refresh();
    this.nameInput.focus();
    void this.rescan();
  }

  onClose() {
    this.finish(null, false);
  }

  /** 표본 노트 3곳을 읽는다 — 열릴 때 1회 + "다시 확인" */
  private async rescan() {
    this.scanning = true;
    this.refresh();
    try {
      this.scan = await this.plugin.bibleData.detectQuoteTitles();
    } catch (err) {
      console.warn("[a4p-bible-verse] 표본 노트 확인 실패", err);
      this.scan = { titles: [], total: 0, reason: "표본 노트를 읽지 못했습니다." };
    }
    this.scanning = false;
    if (this.decided) return;
    this.renderDetected();
    this.refresh();
  }

  /** 표본에 있지만 아직 등록하지 않은 제목을 칩으로 — 클릭하면 제목 칸에 채워진다 */
  private renderDetected() {
    this.detectedEl.empty();
    if (!this.scan || this.scan.total === 0) return;
    const registered = versionNames(this.plugin.settings.versions);
    const fresh = this.scan.titles.filter((t) => !registered.includes(t.title));
    if (fresh.length === 0) return;
    this.detectedEl.createSpan({ cls: "bible-verse-context-label", text: "노트에서 찾은 역본:" });
    for (const { title } of fresh) {
      const chip = this.detectedEl.createEl("button", {
        cls: "bible-verse-chip",
        text: `+ ${title}`,
      });
      chip.title = "클릭하면 제목 칸에 채워집니다";
      chip.addEventListener("click", () => {
        this.nameInput.value = title;
        this.refresh();
        this.shortInput.focus();
      });
    }
  }

  private setCheck(kind: CheckKind, text: string) {
    this.checkEl.className = `bible-verse-add-check is-${kind}`;
    this.checkEl.setText(text);
  }

  /** 입력·표본 결과를 대조해 확인 줄과 추가 버튼 상태를 갱신한다 */
  private refresh() {
    const name = normalizeVersionName(this.nameInput.value);
    const shortRaw = normalizeVersionName(this.shortInput.value);
    const short = shortRaw && shortRaw !== name ? shortRaw : undefined;
    const registered = this.plugin.settings.versions;
    this.valid = null;
    let okText = "추가";

    if (!name) {
      this.setCheck(
        "muted",
        `콜아웃 제목을 입력하면 표본 노트 ${this.scan?.total || 3}곳(창1_1·시23_1·요3_16)에서 바로 찾아봅니다.`,
      );
    } else if (FORBIDDEN_CHARS.test(name)) {
      this.setCheck("error", "역본 이름에는 [ ] | 를 쓸 수 없습니다.");
    } else if (registered.some((d) => d.name === name)) {
      this.setCheck("error", `'${name}'은(는) 이미 등록되어 있습니다.`);
    } else if (short && registered.some((d) => shortLabel(d) === short)) {
      const owner = registered.find((d) => shortLabel(d) === short)!;
      this.setCheck(
        "error",
        `짧은 이름 '${short}'은(는) 이미 '${owner.name}'이(가) 쓰고 있어 버튼이 구분되지 않습니다.`,
      );
    } else if (this.scanning || !this.scan) {
      this.setCheck("muted", "표본 노트를 읽는 중…");
    } else if (this.scan.total === 0) {
      const { otPath, ntPath } = this.plugin.settings;
      this.setCheck(
        "warn",
        !otPath && !ntPath
          ? "구약·신약 성경 폴더가 아직 등록되지 않아 노트를 확인할 수 없습니다. 추가는 가능합니다."
          : "표본 노트를 읽지 못했습니다. 설정의 성경 폴더 '검증'을 먼저 해주세요. 추가는 가능합니다.",
      );
      this.valid = { name, short, found: false };
      okText = "그래도 추가";
    } else {
      const total = this.scan.total;
      const found = this.scan.titles.find((t) => t.title === name)?.found ?? 0;
      if (found === total) {
        this.setCheck("ok", `표본 ${total}곳 모두에서 '${name}' 콜아웃을 찾았습니다.`);
        this.valid = { name, short, found: true };
      } else if (found > 0) {
        this.setCheck(
          "warn",
          `표본 ${total}곳 중 ${found}곳에서만 '${name}' 콜아웃을 찾았습니다. 일부 노트에만 들어 있는 것 같습니다 — 추가는 가능합니다.`,
        );
        this.valid = { name, short, found: true };
      } else {
        const variant = this.scan.titles.find((t) => fold(t.title) === fold(name));
        if (variant) {
          this.setCheck(
            "warn",
            `노트에는 '${variant.title}'(으)로 적혀 있습니다. 대소문자·띄어쓰기가 다르면 찾지 못합니다.`,
          );
          const fix = this.checkEl.createEl("button", {
            cls: "bible-verse-add-check-fix",
            text: `'${variant.title}'(으)로 바꾸기`,
          });
          fix.addEventListener("click", () => {
            this.nameInput.value = variant.title;
            this.refresh();
          });
        } else {
          this.setCheck(
            "warn",
            `표본 노트에서 '${name}' 콜아웃을 찾지 못했습니다. 노트에 \`> [!quote] ${name}\` 줄이 있는지 확인해주세요. 콜아웃을 나중에 넣을 계획이면 지금 추가해도 됩니다 — 그때까지 모달에는 '(${name} 본문 없음)'으로 표시됩니다.`,
          );
        }
        this.valid = { name, short, found: false };
        okText = "그래도 추가";
      }
    }

    this.addBtn.disabled = !this.valid;
    this.addBtn.setText(okText);
    this.recheckBtn.disabled = this.scanning;
  }

  private submit() {
    if (!this.valid || this.decided) return;
    const { name, short, found } = this.valid;
    // updateVersionSettings는 settings를 동기적으로 바꾼 뒤 저장을 기다린다 —
    // 먼저 resolve해 설정 탭이 새 목록으로 다시 그려지게 하고, 저장은 뒤에서 끝난다
    void this.plugin.updateVersionSettings({
      versions: [...this.plugin.settings.versions, short ? { name, short } : { name }],
    });
    this.finish({ name, short, foundInSamples: found });
  }

  private finish(result: AddVersionResult | null, close = true) {
    if (!this.decided) {
      this.decided = true;
      this.resolve(result);
    }
    if (close) this.close();
  }
}
