/// <reference types="vite/client" />

interface PiAPI {
  getSettings: () => Promise<any>;
  setSettings: (data: any) => Promise<boolean>;
  getAuth: () => Promise<any>;
  setAuth: (data: any) => Promise<boolean>;
  getModels: () => Promise<any>;
  setModels: (data: any) => Promise<boolean>;
  setWindowBackground: (color: string) => Promise<boolean>;
  openInFinder: (path: string) => Promise<boolean>;
  openExternal?: (url: string) => Promise<boolean>;
  openTerminal?: (path: string) => Promise<boolean>;
}

declare global {
  interface Window {
    piAPI: PiAPI;
  }

  // Electron's <webview> is a custom element, so JSX needs to be told it
  // exists. Only the attributes the browser panel sets are declared.
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          partition?: string;
          useragent?: string;
          allowpopups?: boolean;
          preload?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};
