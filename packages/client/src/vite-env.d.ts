/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Cloudflare Web Analytics site token. Public; unset disables the beacon. */
  readonly VITE_CF_BEACON_TOKEN?: string;
}
