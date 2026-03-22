import { App, Modal } from "obsidian";
import { APP_TITLE } from "./config";
import LocalImagesPlugin from "./main";


export class ModalW1 extends Modal {

	plugin: LocalImagesPlugin;
	messg: string = "";
	callbackFunc: CallableFunction = null;
	 

	constructor(app: App) {
		super(app);
	}

	onOpen() {
		let { contentEl, titleEl } = this;
		titleEl.setText(APP_TITLE);
		const div = contentEl.createDiv({
			text: this.messg
		})


		contentEl.createEl("button", {
			cls: ["mod-cta"],
			text: "Cancel"
		}).addEventListener("click", async () => {
			this.close();
		});


		contentEl.createEl("button", {
			cls: ["mod-cta"],
			text: "Confirm"
		}).addEventListener("click", async () => {
			 
			this.close();
			
			if (this.callbackFunc) {
				this.callbackFunc();
			}

		});
	}

	onClose() {
		let { contentEl } = this;
		contentEl.empty();
	}
}



export class ModalW2 extends Modal {

	plugin: LocalImagesPlugin;
	messg: string = "";

	constructor(app: App) {
		super(app);
	}

	onOpen() {
		let { contentEl, titleEl } = this;
		titleEl.setText(APP_TITLE);
		const div = contentEl.createDiv({
			text: this.messg
		})

 		contentEl.createEl("button", {
			cls: ["mod-cta"],
			text: "OK"
		}).addEventListener("click", async () => {
			 
			this.close();
 

		});
	}

	onClose() {
		let { contentEl } = this;
		contentEl.empty();
	}
}

export class BulkProgressModal extends Modal {
	private statusLines: string[] = [];
	private detailLines: string[] = [];
	private statusEl: HTMLDivElement | null = null;
	private detailsEl: HTMLDivElement | null = null;
	private closeButtonEl: HTMLButtonElement | null = null;
	private cancelButtonEl: HTMLButtonElement | null = null;
	private onCancelCallback: (() => void) | null = null;

	constructor(app: App) {
		super(app);
	}

	setProgress(lines: string[], details: string[] = []) {
		this.statusLines = lines;
		this.detailLines = details;
		this.render();
	}

	setFinished(lines: string[], details: string[] = []) {
		this.statusLines = lines;
		this.detailLines = details;
		this.render();
		if (this.cancelButtonEl) {
			this.cancelButtonEl.disabled = true;
		}
		if (this.closeButtonEl) {
			this.closeButtonEl.disabled = false;
			this.closeButtonEl.focus();
		}
	}

	setOnCancel(callback: (() => void) | null) {
		this.onCancelCallback = callback;
	}

	onOpen() {
		const { contentEl, titleEl } = this;
		titleEl.setText(APP_TITLE);

		this.statusEl = contentEl.createDiv();
		this.detailsEl = contentEl.createDiv();
		this.cancelButtonEl = contentEl.createEl("button", {
			cls: ["mod-cta"],
			text: "Cancel"
		});
		this.cancelButtonEl.addEventListener("click", async () => {
			if (this.cancelButtonEl) {
				this.cancelButtonEl.disabled = true;
				this.cancelButtonEl.setText("Stopping...");
			}
			if (this.onCancelCallback) {
				this.onCancelCallback();
			}
		});
		this.closeButtonEl = contentEl.createEl("button", {
			cls: ["mod-cta"],
			text: "Close"
		});
		this.closeButtonEl.disabled = true;
		this.closeButtonEl.addEventListener("click", async () => {
			this.close();
		});

		this.render();
	}

	private render() {
		if (!this.statusEl || !this.detailsEl) {
			return;
		}

		this.statusEl.empty();
		this.detailsEl.empty();

		for (const line of this.statusLines) {
			this.statusEl.createDiv({ text: line });
		}

		for (const line of this.detailLines) {
			this.detailsEl.createDiv({ text: line });
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		this.statusEl = null;
		this.detailsEl = null;
		this.closeButtonEl = null;
		this.cancelButtonEl = null;
		this.onCancelCallback = null;
	}
}
