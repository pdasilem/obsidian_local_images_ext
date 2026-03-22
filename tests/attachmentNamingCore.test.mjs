import test from "node:test";
import assert from "node:assert/strict";

const { buildAttachmentNamingDecision, getNoteAttachmentBaseName } =
  await import("../src/attachmentNamingCore.ts");
const { DEFAULT_SETTINGS } = await import("../src/config.ts");

class MemoryAdapter {
  constructor(files = {}) {
    this.files = new Map(
      Object.entries(files).map(([filePath, bytes]) => [filePath, bytes])
    );
  }

  async exists(filePath) {
    return this.files.has(filePath);
  }

  async readBinary(filePath) {
    const value = this.files.get(filePath);
    if (!value) {
      throw new Error(`Missing file: ${filePath}`);
    }
    return value;
  }

  async list(dir) {
    const prefix = dir.endsWith("/") ? dir : `${dir}/`;
    return {
      files: [...this.files.keys()].filter((filePath) => filePath.startsWith(prefix)),
    };
  }
}

function bytes(text) {
  return new TextEncoder().encode(text).buffer;
}

test("md5 strategy never falls back to noteNameCounter naming", async () => {
  const adapter = new MemoryAdapter();
  const settings = { ...DEFAULT_SETTINGS, newAttachmentNaming: "md5" };
  const noteBaseName = "Habr";
  const content = bytes("big-video-content");

  const decision = await buildAttachmentNamingDecision(
    adapter,
    "_resources/big",
    noteBaseName,
    "Pasted image 2026-03-22 12-00-00.mkv",
    "mkv",
    content,
    settings
  );

  assert.equal(decision.strategy, "md5");
  assert.match(decision.fileName, /_MD5\.mkv$/);
  assert.doesNotMatch(
    decision.fileName,
    new RegExp(`${getNoteAttachmentBaseName(noteBaseName)}-\\d+\\.mkv$`)
  );
});

test("md5 strategy stays md5 even when current file path looks like noteNameCounter", async () => {
  const adapter = new MemoryAdapter();
  const settings = { ...DEFAULT_SETTINGS, newAttachmentNaming: "md5" };
  const noteBaseName = "Habr";
  const content = bytes("same-content");

  const decision = await buildAttachmentNamingDecision(
    adapter,
    "_resources/big",
    noteBaseName,
    "Habr-1.mkv",
    "mkv",
    content,
    settings,
    "_resources/big/Habr-1.mkv"
  );

  assert.equal(decision.strategy, "md5");
  assert.match(decision.fileName, /_MD5\.mkv$/);
  assert.equal(decision.alreadyMatchesCurrentPath, false);
});

test("noteNameCounter strategy produces note-based names", async () => {
  const adapter = new MemoryAdapter({
    "_resources/Habr-1.png": bytes("older"),
  });
  const settings = { ...DEFAULT_SETTINGS, newAttachmentNaming: "noteNameCounter" };
  const decision = await buildAttachmentNamingDecision(
    adapter,
    "_resources",
    "Habr",
    "Pasted image.png",
    "png",
    bytes("newer"),
    settings
  );

  assert.equal(decision.strategy, "noteNameCounter");
  assert.equal(decision.fileName, "_resources/Habr-2.png");
});
