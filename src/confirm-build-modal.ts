import { App, Modal } from "obsidian";

/**
 * 본문 키워드 인덱스를 처음 만들기 직전(디스크 캐시가 없을 때만) 띄우는 확인창.
 * 저사양 PC·클라우드 동기화 중인 볼트에서 3만 파일 읽기가 실수로 시작되는 일을 막는다.
 * Esc·바깥 클릭·닫기 버튼은 모두 취소로 처리한다.
 */
export class ConfirmBuildModal extends Modal {
  private decided = false;

  private constructor(
    app: App,
    private fileCount: number,
    private resolve: (ok: boolean) => void,
  ) {
    super(app);
  }

  /** 확인창을 열고 사용자의 선택(만들기 true / 취소 false)을 돌려준다 */
  static ask(app: App, fileCount: number): Promise<boolean> {
    return new Promise((resolve) => new ConfirmBuildModal(app, fileCount, resolve).open());
  }

  onOpen() {
    this.titleEl.setText("본문 인덱스를 만들까요?");
    const { contentEl } = this;
    contentEl.createEl("p", {
      text: `구절 노트 ${this.fileCount.toLocaleString()}개를 읽어 본문 검색 인덱스를 만듭니다. 처음 한 번만 걸리며 보통 수십 초, 사양이 낮은 PC나 클라우드 동기화 중인 볼트에서는 수 분이 걸릴 수 있습니다.`,
    });
    contentEl.createEl("p", {
      text: "만드는 동안에도 옵시디언은 계속 쓸 수 있고, 이후에는 캐시로 바로 검색됩니다.",
    });
    contentEl.createEl("p", {
      cls: "bible-verse-confirm-build-hint",
      text: "단어 검색을 쓰지 않으려면 설정 → A4P 성경구절 → \"본문 키워드 검색 사용\"을 끄세요.",
    });

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: "취소" });
    cancel.addEventListener("click", () => this.finish(false));
    const ok = buttons.createEl("button", { text: "지금 만들기", cls: "mod-cta" });
    ok.addEventListener("click", () => this.finish(true));
    this.scope.register([], "Enter", (e) => {
      e.preventDefault();
      this.finish(true);
    });
    ok.focus();
  }

  onClose() {
    // 버튼 없이 닫힌 경우(Esc·바깥 클릭) = 취소. 이미 결정됐으면 무시.
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
