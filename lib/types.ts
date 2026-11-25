/** Version of the stored data shape. Bump it and add a migration when the shape changes. */
export const SCHEMA_VERSION = 1;

/** Everything Blob remembers about the element a comment is pinned to. */
export interface AnchorDescriptor {
  /** CSS path to the element at the time it was chosen. */
  selector: string;
  /** Lower-case tag name, e.g. "button". */
  tag: string;
  /** Short human name shown in the UI, e.g. `Button "Explore our work"`. */
  label: string;
  /** Element id, when it looks stable rather than generated. */
  id?: string;
  /** Up to 80 characters of the element's own text. Never taken from form fields. */
  text?: string;
  /** Text of the nearest heading above the element; tells repeated elements apart. */
  context?: string;
  /** A few identifying attributes. Never includes values typed by the person. */
  attrs?: Partial<Record<AnchorAttr, string>>;
  /** Up to three class names that do not look machine-generated. */
  classes?: string[];
  /** Where the pin sits inside the element, as fractions of its width and height. */
  offset: { x: number; y: number };
}

export type AnchorAttr = 'role' | 'type' | 'name' | 'href' | 'alt' | 'ariaLabel' | 'testId';

export interface Message {
  id: string;
  body: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export type ThreadStatus = 'open' | 'resolved';

/** One conversation: the first message is the comment, the rest are replies. */
export interface Thread {
  id: string;
  /** Identity of the page this conversation belongs to. See lib/page.ts. */
  pageKey: string;
  /** Website origin, e.g. "https://example.com". */
  origin: string;
  /** Pin number, unique within the page. */
  number: number;
  status: ThreadStatus;
  anchor: AnchorDescriptor;
  messages: Message[];
  createdAt: string;
  /** Time of the latest comment, reply, resolve or reopen. Lists sort by this. */
  updatedAt: string;
  resolvedAt?: string;
}

export interface PageRecord {
  key: string;
  origin: string;
  /** Sanitised address that can be opened again. Never contains credentials. */
  url: string;
  title: string;
  /** Short path shown in lists, e.g. "/pricing". */
  label: string;
}

/** The whole of Blob's saved guest data. Stored under one key. */
export interface BlobData {
  version: number;
  threads: Record<string, Thread>;
  pages: Record<string, PageRecord>;
}

export interface BlobSettings {
  /** True once the person has chosen "Continue as a Guest". */
  onboarded: boolean;
  /** Centre of the Blob button as fractions of the viewport. */
  blobPosition: { x: number; y: number } | null;
}

/** Unsent text, keyed by `new:<pageKey>` or `reply:<threadId>`. */
export type Drafts = Record<string, string>;

/** Websites where the person granted lasting access. Mirrors Chrome's permission state. */
export type EnabledSites = string[];

export const emptyData = (): BlobData => ({ version: SCHEMA_VERSION, threads: {}, pages: {} });
export const defaultSettings = (): BlobSettings => ({ onboarded: false, blobPosition: null });

export const LIMITS = {
  body: 5000,
  anchorText: 80,
  anchorContext: 80,
  label: 80,
  selector: 1000,
  title: 160,
} as const;
