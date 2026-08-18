/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ENDPOINT?: string;
  readonly VITE_IOS_STORE_URL?: string;
  readonly VITE_ANDROID_STORE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
