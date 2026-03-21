import { URL } from "url";
import path from "path";
import {
  App,
  DataAdapter,
  TFile,
  Plugin
} from "obsidian";


import {
  isUrl,
  downloadImage,
  readFromDisk,
  cFileName,
  logError,
  trimAny,
  pathJoin,
  normalizePath,
  base64ToBuff,
  md5Sig,
  getFileExt,
  blobToJpegArrayBuffer
} from "./utils";

import {
  AttachmentNamingStrategy,
  ISettings,
  SUPPORTED_OS
} from "./config";


import AsyncLock from "async-lock";
import moment from "moment";

type LocalImagesPluginLike = Plugin & {
  ensureFolderExists(folderPath: string): Promise<void>;
};

const NOTE_ATTACHMENT_NAME_MAX_LENGTH = 20;

export function imageTagProcessor(app: LocalImagesPluginLike,
  noteFile: TFile,
  settings: ISettings,
  defaultdir: boolean
) {

  const unique = Math.random().toString(16).slice(2,);

  async function processImageTag(match: string,
    anchor: string,
    link: string,
    caption: string,
    imgsize: string) {


    logError("processImageTag: " + match)
    if (!isUrl(link)) {
      return match;
    }

    try {

      var lock = new AsyncLock();
      let fpath;
      let fileData: ArrayBuffer;
      const opsys = process.platform;
      const protocol = link.slice(0, 5);

      if (protocol == "data:") {
        logError("ReadBase64: \r\n" + fpath, false);
        fileData = await base64ToBuff(link);
      }
      else

        if (protocol == "file:") {
          logError("Readlocal: \r\n" + fpath, false);
          if (SUPPORTED_OS.win.includes(opsys)) { fpath = link.replace("file:///", ""); }
          else if (SUPPORTED_OS.unix.includes(opsys)) { fpath = link.replace("file://", ""); }
          else { fpath = link.replace("file://", ""); }

          fileData = await readFromDisk(fpath);
          if (fileData === null) {
            fileData = await readFromDisk(decodeURI(fpath));
          }
        }
        else {
          //Try to download several times
          let trycount = 0;
          while (trycount < settings.tryCount) {
            fileData = await downloadImage(link);
            logError("\r\n\nDownloading (try): " + trycount + "\r\n\n");
            if (fileData !== null) { break; }
            trycount++;
          }
        }
      if (fileData === null) {
        logError("Cannot get an attachment content!", false);
        return null;
      }


      if (Math.round(fileData.byteLength / 1024) < settings.filesizeLimit) {
        logError("Lower limit of the file size!", false);
        return null;
      }

      const mediaDir = await getTargetMediaDir(
        app.app,
        noteFile,
        settings,
        fileData.byteLength,
        defaultdir,
        unique
      );
      await app.ensureFolderExists(mediaDir);

      try {


        const { fileName, needWrite } = await lock.acquire(match, async function () {


          const parsedUrl = new URL(link);

          let fileExt = await getFileExt(fileData, parsedUrl.pathname);


          if (fileExt == "png" && settings.PngToJpeg) {


            let compType = (settings.ImgCompressionType == "") ? "image/jpeg" : settings.ImgCompressionType;
            const blob = new Blob([new Uint8Array(fileData)]);
            fileData = await blobToJpegArrayBuffer(blob, settings.JpegQuality * 0.01, compType)
            logError("arbuf: ")
            logError(fileData)
          }
          const { fileName, needWrite } = await chooseAttachmentPath(
            app.app.vault.adapter,
            mediaDir,
            noteFile,
            link,
            fileExt,
            fileData,
            settings
          );
          return { fileName, needWrite };
        });



        if (needWrite && fileName) {
          await app.app.vault.createBinary(fileName, fileData);
        }

        if (fileName) {

          let shortName = "";
          const rdir = await getRDir(noteFile, settings, fileName, link, app.app.vault.getConfig("useMarkdownLinks"));
          let pathWiki = rdir[0];
          let pathMd = rdir[1];


          if (settings.addNameOfFile && protocol == "file:") {

            if (!app.app.vault.getConfig("useMarkdownLinks")) {

              shortName = "\r\n[[" +
                fileName +
                "\|" +
                rdir[2]["lnkurid"] + "]]\r\n";
            }
            else {
              shortName = "\r\n[" +
                rdir[2]["lnkurid"] +
                "](" +
                rdir[2]["pathuri"] +
                ")\r\n";
            }
          }

          if (!app.app.vault.getConfig("useMarkdownLinks")) {

            // image caption
            (!settings.useCaptions || !caption.length) ? caption = "" : caption = "\|" + caption;

            // image size has higher priority
            (!settings.useCaptions || !imgsize.length) ? caption = "" : caption = "\|" + imgsize;

            return [match, `![[${pathWiki}${caption}]]`, `${shortName}`];
          }

          else {
            (!settings.useCaptions || !caption.length) ? caption = "" : caption = " " + caption;
            return [match, `![${anchor}](${pathMd}${caption})`, `${shortName}`];
          }



        } else {
          return null;
        }

      } catch (error) {
        if (error.message === "File already exists.") {
        } else {
          throw error;
        }
      }

      return null;
    } catch (error) {
      logError("Image processing failed: " + error, false);
      return null;
    }
  }

  return processImageTag;
}





export async function getRDir(noteFile: TFile,
  settings: ISettings,
  fileName: string,
  link: string = undefined,
  useMarkdownLinks: boolean = true):
  Promise<Array<any>> {
  let pathWiki = "";
  let pathMd = "";

  const notePath = normalizePath(noteFile.parent.path);
  const parsedPath = path.parse(normalizePath(fileName));

  const parsedPathE = {
    parentd: path.basename(parsedPath["dir"]),
    basen: (parsedPath["name"] + parsedPath["ext"]),
    lnkurid: path.basename(decodeURI(link)),
    pathuri: encodeURI(normalizePath(fileName))
  };



  switch (settings.pathInTags) {
    case "baseFileName":
      pathWiki = pathMd = parsedPathE["basen"];
      break;
    case "onlyRelative":
      pathMd = encodeURI(pathJoin([path.relative(path.sep + notePath, path.sep + parsedPath["dir"]), parsedPathE["basen"]]));
      pathWiki = useMarkdownLinks ? pathMd : parsedPathE["basen"];
      break;
    case "fullDirPath":
      pathWiki = fileName.replace(/\\/g, "/");
      pathMd = parsedPathE["pathuri"];
      break;
    default:
      pathWiki = fileName;
      pathMd = parsedPathE["pathuri"];
  };
  return [pathWiki, pathMd, parsedPathE];

}


export async function getMDir(app: App,
  noteFile: TFile,
  settings: ISettings,
  defaultdir: boolean = false,
  unique: string = ""): Promise<string> {


  const notePath = noteFile.parent.path;
  const date = new Date();
  const current_date = moment().format(settings.DateFormat);
  const obsmediadir = app.vault.getConfig("attachmentFolderPath");
  const mediadir = settings.mediaRootDir;
  var attdir = settings.saveAttE;
  if (defaultdir) { attdir = "" };
  let root = "/";

  switch (attdir) {

    case 'inFolderBelow':
      root = mediadir
        .replace("${notename}", noteFile.basename)
        .replace("${unique}", unique)
        .replace("${date}", current_date);
      break;

    case 'nextToNoteS':
      root = (pathJoin([noteFile.parent.path, mediadir]))
        .replace("${notename}", noteFile.basename)
        .replace("${unique}", unique)
        .replace("${date}", current_date);
      break;

    default:

      if (obsmediadir === '/') {
        root = obsmediadir;
      }
      else if (obsmediadir === './') {
        root = pathJoin([noteFile.parent.path]);
      }
      else if (obsmediadir.match(/\.\/.+/g) !== null) {
        root = pathJoin([noteFile.parent.path, obsmediadir.replace('\.\/', '')]);
      }
      else {
        root = normalizePath(obsmediadir);
      }

  }

  return trimAny(root, ["/", "\\"]);


}

export async function getTargetMediaDir(app: App,
  noteFile: TFile,
  settings: ISettings,
  byteLength: number,
  defaultdir: boolean = false,
  unique: string = ""): Promise<string> {

  const mediaDir = await getMDir(app, noteFile, settings, defaultdir, unique);
  const fileSizeKb = Math.round(byteLength / 1024);
  const oversizeSubdir = trimAny(settings.oversizeMediaSubdir, ["/", "\\", " "]);

  if (
    settings.maxMediaFileSizeKb <= 0 ||
    fileSizeKb <= settings.maxMediaFileSizeKb ||
    oversizeSubdir.length === 0
  ) {
    return mediaDir;
  }

  return trimAny(pathJoin([mediaDir, oversizeSubdir]), ["/", "\\"]);
}










export function getAttachmentNamingStrategy(settings: ISettings): AttachmentNamingStrategy {
  if (settings.newAttachmentNaming) {
    return settings.newAttachmentNaming;
  }

  return settings.useMD5ForNewAtt ? "md5" : "originalName";
}

export function getNoteAttachmentBaseName(noteFile: TFile): string {
  const truncatedName = noteFile.basename.slice(0, NOTE_ATTACHMENT_NAME_MAX_LENGTH);
  const normalizedName = truncatedName.replace(/ /g, "_");
  const safeName = cFileName(normalizedName);

  return safeName.length > 0 ? safeName : "attachment";
}

export function matchesNoteNameCounterPattern(noteFile: TFile, filePath: string): boolean {
  const noteBaseName = getNoteAttachmentBaseName(noteFile);
  const fileBaseName = path.parse(filePath).name;
  const counterPattern = new RegExp(`^${noteBaseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+$`);

  return counterPattern.test(fileBaseName);
}

function getOriginalAttachmentBaseName(link: string, noteFile: TFile): string {
  try {
    const parsedUrl = new URL(link);
    const rawName = path.parse(decodeURI(parsedUrl.pathname)).name;
    const safeName = cFileName(rawName);

    if (safeName.length > 0) {
      return safeName;
    }
  } catch (error) {
    logError(error);
  }

  return getNoteAttachmentBaseName(noteFile);
}

async function getNextNoteAttachmentCounter(
  adapter: DataAdapter,
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
  adapter: DataAdapter,
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

export async function chooseAttachmentPath(
  adapter: DataAdapter,
  dir: string,
  noteFile: TFile,
  link: string,
  fileExt: string,
  contentData: ArrayBuffer | Uint8Array,
  settings: ISettings
): Promise<{ fileName: string; needWrite: boolean }> {
  const ignoredExt = settings.ignoredExt.split("|");
  logError("file: " + link + " content: " + contentData + " file ext: " + fileExt, false);



  if (fileExt == "unknown" && !settings.downUnknown) {
    return { fileName: "", needWrite: false };
  }


  if (ignoredExt.includes(fileExt)) {
    return { fileName: "", needWrite: false };
  }




  const strategy = getAttachmentNamingStrategy(settings);
  const baseName = md5Sig(contentData);

  let needWrite = true;
  let fileName = "";
  if (strategy === "md5") {
    const suggestedName = pathJoin([dir, cFileName(`${baseName}` + `.${fileExt}`)]);
    if (await adapter.exists(suggestedName, false)) {
      const fileData = await adapter.readBinary(suggestedName);
      const existing_file_md5 = md5Sig(fileData);
      if (existing_file_md5 === baseName) {
        fileName = suggestedName;
        needWrite = false;
      }
      else {
        fileName = pathJoin([dir, cFileName(Math.random().toString(9).slice(2,) + `.${fileExt}`)]);
      }

    } else {
      fileName = suggestedName;
    }
  } else if (strategy === "noteNameCounter") {
    const noteBaseName = getNoteAttachmentBaseName(noteFile);
    const counter = await getNextNoteAttachmentCounter(adapter, dir, noteBaseName);
    fileName = pathJoin([dir, cFileName(`${noteBaseName}-${counter}.${fileExt}`)]);
  } else {
    const originalBaseName = getOriginalAttachmentBaseName(link, noteFile);
    fileName = await getNextOriginalNamePath(adapter, dir, originalBaseName, fileExt);
  }

  logError("File name: " + fileName, false);
  if (!fileName) {
    throw new Error("Failed to generate file name for media file.");
  }

  //linkHashes.ensureHashGenerated(link, contentData);

  return { fileName, needWrite };
}






export async function FrontMatterParser(app: Plugin, noteFile: TFile, SearchPattern: Array<RegExp>) {

  const FrontMatterEmbeds = { files: new Array, urls: new Array };
 
  await app.app.fileManager.processFrontMatter(noteFile, (frontmatter: Object): Object => {

    if (!frontmatter) {
      return FrontMatterEmbeds;
    }

    Object.entries(frontmatter).forEach(([key, value]) => {
 
      for (const reg_p of SearchPattern) {
        if (reg_p.test(String(value))) {

          const LocLinkfound = String(value).match(reg_p)?.groups?.loclink;

          if (LocLinkfound != undefined) {
            const FileBaseName = trimAny(LocLinkfound, ["]", "[", ")", "(", " "]);
            const MDMatch = trimAny(String(value).match(reg_p)[0], [" "]);
            FrontMatterEmbeds.files.push({ "key": key, "match": MDMatch, "link": FileBaseName });
          }
        }
      }

    });

  });

  return FrontMatterEmbeds;
} 
