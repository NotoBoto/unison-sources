// Plugin contract, api 1. Mirrors SOURCES_DESIGN.md §5 and §19 in the Unison repository.

export type Lang = "ru" | "en";

export interface Manifest {
  id: string;                      // stable, never changes
  name: string;
  version: string;                 // semver of the plugin
  api: 1;
  lang: Lang;                      // default language of books
  site: string;
  domains: string[];               // fetch is allowed only here
  icon: string;                    // repository path, e.g. "icons/wikisource-ru.png"
  content: ("text" | "audio")[];
  features: Feature[];
  nsfw: boolean;
  studio: "none" | "private" | "public" | "permission";   // upper bound for Unison Studio (§14)
  browser: "never" | "onChallenge" | "always";             // when a WebView is needed (§5.1)
  rateLimit: { rps: number; burst: number };
  login: Login | null;
}

export type Feature = "popular" | "latest" | "search" | "filters" | "login" | "byUrl";

export interface Login {           // §19.2
  url: string;
  kind: "cookies" | "localStorage";
  key?: string;
  path?: string;                   // JSON Pointer (RFC 6901) inside the localStorage value
  header?: string;                 // default "Authorization: Bearer {token}"
  expiresPath?: string;
}

export interface BookStub { id: string; title: string; cover?: string; author?: string; nsfw?: boolean }

export interface BookDetails {
  id: string; title: string; author?: string; translator?: string; cover?: string; description?: string;
  tags: string[]; status: "ongoing" | "completed" | "unknown"; lang?: Lang; nsfw?: boolean; url: string;
  license?: "public-domain" | "cc-by" | "cc-by-sa" | "unknown";
}

export interface ChapterStub {
  id: string; title: string; url: string; volume?: string;
  date?: string;                   // ISO 8601, UTC, with Z
  locked?: boolean;
}

export interface Image { after: number; src: string; w?: number; h?: number }   // after: paragraph index, -1 = before the first

export type ChapterContent =
  | { kind: "text"; title: string; paras: string[]; images: Image[] }
  | { kind: "audio"; url: string; duration?: number; mime?: string };

export interface Page<T> { items: T[]; hasNext: boolean }

export type FilterValues = Record<string, string | string[] | boolean>;

export interface Filter {          // §19.4
  id: string; title: string;
  type: "select" | "multiselect" | "toggle" | "text" | "sort";
  options?: { id: string; title: string }[];
  default?: string | string[] | boolean;
}

export interface Plugin {
  popular?(page: number, filters?: FilterValues): Promise<Page<BookStub>>;
  latest?(page: number): Promise<Page<BookStub>>;
  search?(query: string, page: number, filters?: FilterValues): Promise<Page<BookStub>>;
  details(bookId: string): Promise<BookDetails>;
  chapters(bookId: string): Promise<ChapterStub[]>;
  chapter(bookId: string, chapterId: string): Promise<ChapterContent>;
  filters?(): Promise<Filter[]>;
  bookIdFromUrl?(url: string): Promise<string | null>;
}

export type ErrorCode =
  | "NEEDS_BROWSER" | "NEEDS_LOGIN" | "RATE_LIMITED" | "NOT_FOUND" | "CHANGED_LAYOUT"
  | "TIMEOUT" | "ENGINE" | "UNAVAILABLE";          // the last three are raised by the host

export interface PluginError { code: ErrorCode; message: string; url?: string }

export interface FetchInit { method?: string; headers?: Record<string, string>; body?: string }
export interface FetchResponse { status: number; headers: Record<string, string>; text: string; url: string }
