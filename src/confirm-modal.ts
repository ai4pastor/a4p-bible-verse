import { App, Modal } from "obsidian";

export interface ConfirmOptions {
  title: string;
  /** 본문 문단들 (한국어) */
  body: string[];
  okText: string;
  /** true면 확인 버튼을 경고색으로 — 되돌리기처럼 사용자 입력이 사라지는 동작 */
  warning?: boolean;
}

/** 범용 확인창 — Esc·바깥 클릭·취소는 false. Promise는 정확히 한 번 resolve된다 */
export function confirmModal(app: App, opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => new ConfirmModal(app, opts, resolve).open());
}

class ConfirmModal extends Modal {
  private decided = false;

  constructor(
    app: App,
    private opts: ConfirmOptions,
    private resolve: (ok: boolean) => void,
  ) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText(this.opts.title);
    for (const text of this.opts.body) this.contentEl.createEl("p", { text });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: "취소" });
    cancel.addEventListener("click", () => this.finish(false));
    const ok = buttons.createEl("button", {
      text: this.opts.okText,
      cls: this.opts.warning ? "mod-warning" : "mod-cta",
    });
    ok.addEventListener("click", () => this.finish(true));
    this.scope.register([], "Enter", (e) => {
      e.preventDefault();
      this.finish(true);
    });
    ok.focus();
  }

  onClose() {
    this.finish(false, false);
  }

  private finish(ok: boolean, close = true) {
    if (!this.decided) {
      this.decided = true;
      this.resolve(ok);
    }
    if (close) this.close();
  }
}
