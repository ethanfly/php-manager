/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// 注意：Window.electronAPI 的类型不再在此手写维护，
// 统一由 electron/preload.ts 中的 `declare global { interface Window { electronAPI: ElectronAPI } }`
// 提供单一来源（ElectronAPI = typeof api），确保渲染端类型与主进程实际暴露的运行时 API 一致。
// 此前在此文件维护的副本曾因遗漏 git/go/python/composer/log 等成员而导致大量 TS2339 误报。

// unzipper 自带类型声明，这里给出最小占位声明以通过类型检查。
// 实际使用仅涉及 Extract/Parse/ParseOne/Open 等流式 API，故宽松声明为 NodeJS 流。
declare module "unzipper" {
  import type { Transform } from "node:stream";
  const unzipper: {
    Extract: (opts: { path: string }) => Transform;
    Parse: () => Transform;
    ParseOne: (match?: RegExp) => Transform;
    Open: (source: any) => Promise<any>;
  };
  export default unzipper;
  export const Extract: typeof unzipper.Extract;
  export const Parse: typeof unzipper.Parse;
  export const ParseOne: typeof unzipper.ParseOne;
  export const Open: typeof unzipper.Open;
}