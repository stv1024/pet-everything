/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** off：不显示作者链接（GitHub、X），用于 Cloudflare 临时地址那一版 */
  readonly VITE_LINKS?: string;
}
