import path from "path";
import md5 from "crypto-js/md5";
import { AttachmentNamingStrategy, ISettings } from "./config";

export interface MinimalBinaryAdapter {
  exists(filePath: string, sensitive?: boolean): Promise<boolean>;
  readBinary(filePath: string): Promise<ArrayBuffer>;
  list(dir: string): Promise<{ files: string[] }>;
}

export interface AttachmentNamingDecision {
  strategy: AttachmentNamingStrategy;
  fileName: string;
  needWrite: boolean;
  alreadyMatchesCurrentPath: boolean;
}

const NOTE_ATTACHMENT_NAME_MAX_LENGTH = 20;

function cFileName(name: string, sep: string = " ") {
  return name.replace(/(\)|\(|\"|\'|\#|\]|\[|\:|\>|\<|\*|\|)/g, sep);
}

function pathJoin(parts: Array<string>): string {
  return path.join(...parts).replace(/\\/g, "/");
}

function md5Sig(contentData: ArrayBuffer | Uint8Array) {
  const dec = new TextDecoder("utf-8");
  const data = contentData instanceof Uint8Array ? contentData : new Uint8Array(contentData);
  const arrMid = Math.round(data.byteLength / 2);
  const chunk = 15000;
  return md5([
    data.slice(0, chunk),
    data.slice(arrMid, arrMid + chunk),
    data.slice(-chunk)
  ].map(x => dec.decode(x)).join()).toString() + "_MD5";
}

export function getAttachmentNamingStrategy(settings: ISettings): AttachmentNamingStrategy {
  return settings.newAttachmentNaming ?? "md5";
}

export function getNoteAttachmentBaseName(noteBaseName: string): string {
  const truncatedName = noteBaseName.slice(0, NOTE_ATTACHMENT_NAME_MAX_LENGTH);
  const normalizedName = truncatedName.replace(/ /g, "_");
  const safeName = cFileName(normalizedName);
  return safeName.length > 0 ? safeName : "attachment";
}

export function matchesNoteNameCounterPattern(noteBaseName: string, filePath: string): boolean {
  const normalizedBaseName = getNoteAttachmentBaseName(noteBaseName);
  const fileBaseName = path.parse(filePath).name;
  const counterPattern = new RegExp(`^${normalizedBaseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+$`);
  return counterPattern.test(fileBaseName);
}

function getOriginalAttachmentBaseName(link: string, noteBaseName: string): string {
  try {
    const parsedUrl = new URL(link);
    const rawName = path.parse(decodeURI(parsedUrl.pathname)).name;
    const safeName = cFileName(rawName);
    if (safeName.length > 0) {
      return safeName;
    }
  } catch {
    // local links are not valid URLs here
  }

  return getNoteAttachmentBaseName(noteBaseName);
}

async function getNextNoteAttachmentCounter(
  adapter: MinimalBinaryAdapter,
  dir: string,
  baseName: string
): Promise<number> {
  const listed = await adapter.list(dir);
  const counterPattern = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-([0-9]+)(\\..+)?$`);
  let maxCounter = 0;

  for (const filePath of listed.files) {
    const fileName = path.basename(filePath);
    const match = fileName.match(counterPattern);
    if (!match) {
      continue;
    }

    const currentCounter = Number(match[1]);
    if (!isNaN(currentCounter) && currentCounter > maxCounter) {
      maxCounter = currentCounter;
    }
  }

  return maxCounter + 1;
}

async function getNextOriginalNamePath(
  adapter: MinimalBinaryAdapter,
  dir: string,
  baseName: string,
  fileExt: string
): Promise<string> {
  let candidate = pathJoin([dir, cFileName(`${baseName}.${fileExt}`)]);
  if (!await adapter.exists(candidate, false)) {
    return candidate;
  }

  let inc = 1;
  while (await adapter.exists(candidate, false)) {
    candidate = pathJoin([dir, cFileName(`(${inc}) ${baseName}.${fileExt}`)]);
    inc++;
  }

  return candidate;
}

function getExpectedMd5Path(dir: string, fileExt: string, contentData: ArrayBuffer | Uint8Array): string {
  return pathJoin([dir, cFileName(`${md5Sig(contentData)}.${fileExt}`)]);
}

function getExpectedOriginalNamePath(dir: string, link: string, fileExt: string, noteBaseName: string): string {
  const originalBaseName = getOriginalAttachmentBaseName(link, noteBaseName);
  return pathJoin([dir, cFileName(`${originalBaseName}.${fileExt}`)]);
}

function matchesOriginalNamePattern(
  noteBaseName: string,
  filePath: string,
  link: string,
  fileExt: string
): boolean {
  return path.basename(filePath) === path.basename(getExpectedOriginalNamePath(path.dirname(filePath), link, fileExt, noteBaseName));
}

export function isCurrentAttachmentPathValidForNamingStrategy(
  noteBaseName: string,
  currentFilePath: string,
  dir: string,
  link: string,
  fileExt: string,
  contentData: ArrayBuffer | Uint8Array,
  settings: ISettings
): boolean {
  const strategy = getAttachmentNamingStrategy(settings);

  if (strategy === "md5") {
    return path.basename(currentFilePath) === path.basename(getExpectedMd5Path(dir, fileExt, contentData));
  }

  if (strategy === "originalName") {
    return matchesOriginalNamePattern(noteBaseName, currentFilePath, link, fileExt);
  }

  return matchesNoteNameCounterPattern(noteBaseName, currentFilePath);
}

export async function buildAttachmentNamingDecision(
  adapter: MinimalBinaryAdapter,
  dir: string,
  noteBaseName: string,
  link: string,
  fileExt: string,
  contentData: ArrayBuffer | Uint8Array,
  settings: ISettings,
  currentFilePath?: string
): Promise<AttachmentNamingDecision> {
  const strategy = getAttachmentNamingStrategy(settings);
  const alreadyMatchesCurrentPath = currentFilePath
    ? isCurrentAttachmentPathValidForNamingStrategy(
      noteBaseName,
      currentFilePath,
      dir,
      link,
      fileExt,
      contentData,
      settings
    )
    : false;

  if (strategy === "md5") {
    const suggestedName = getExpectedMd5Path(dir, fileExt, contentData);
    if (await adapter.exists(suggestedName, false)) {
      const fileData = await adapter.readBinary(suggestedName);
      const existingFileMd5 = md5Sig(fileData);
      const currentMd5 = md5Sig(contentData);
      if (existingFileMd5 === currentMd5) {
        return { strategy, fileName: suggestedName, needWrite: false, alreadyMatchesCurrentPath };
      }

      return {
        strategy,
        fileName: pathJoin([dir, cFileName(Math.random().toString(9).slice(2) + `.${fileExt}`)]),
        needWrite: true,
        alreadyMatchesCurrentPath,
      };
    }

    return { strategy, fileName: suggestedName, needWrite: true, alreadyMatchesCurrentPath };
  }

  if (strategy === "noteNameCounter") {
    const noteAttachmentBaseName = getNoteAttachmentBaseName(noteBaseName);
    const counter = await getNextNoteAttachmentCounter(adapter, dir, noteAttachmentBaseName);
    return {
      strategy,
      fileName: pathJoin([dir, cFileName(`${noteAttachmentBaseName}-${counter}.${fileExt}`)]),
      needWrite: true,
      alreadyMatchesCurrentPath,
    };
  }

  return {
    strategy,
    fileName: await getNextOriginalNamePath(adapter, dir, getOriginalAttachmentBaseName(link, noteBaseName), fileExt),
    needWrite: true,
    alreadyMatchesCurrentPath,
  };
}
