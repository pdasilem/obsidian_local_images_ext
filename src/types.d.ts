import "obsidian";

declare module "obsidian" {
  interface Plugin {
    ensureFolderExists?(folderPath: string): Promise<void>;
  }

  interface Vault {
    getConfig?(key: string): any;
    exists?(path: string): Promise<boolean>;
  }

  interface FileManager {
    processFrontMatter?(
      file: TFile,
      fn: (frontmatter: Record<string, unknown>) => unknown
    ): Promise<void>;
  }

  interface Workspace {
    activeEditor?: {
      file: TFile | null;
      editor: Editor;
      getSelection?: () => string;
    };
  }

  interface DataAdapter {
    basePath?: string;
  }

  interface App {
    internalPlugins?: any;
  }

  interface MetadataCache {
    getFirstLinkpathDest?(linkpath: string, sourcePath: string): TFile | null;
  }
}

export {};
