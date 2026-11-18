/**
 * TypeScript type definitions for resume-preview
 */

import { IncomingMessage, ServerResponse } from "http";
import { SUPPORTED_LOCALES } from "./constants.js";

// ===== Locale =====

/** A language the tool ships translations for. */
export type Locale = (typeof SUPPORTED_LOCALES)[number];

// ===== Resume Types =====

export interface ResumeLink {
  label: string;
  url: string;
}

export interface ResumeBasics {
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  location?: string;
  links?: ResumeLink[];
}

export interface ResumeExperience {
  company: string;
  title?: string;
  start?: string;
  end?: string;
  location?: string;
  highlights?: string[];
}

export interface ResumeProject {
  name: string;
  role?: string;
  period?: string;
  highlights?: string[];
}

export interface ResumeEducation {
  school: string;
  degree?: string;
  period?: string;
  highlights?: string[];
}

export interface ResumeSkillGroup {
  category: string;
  items: string[];
}

export interface ResumeExtras {
  label: string;
  items: string[];
}

/**
 * The unified resume content model. This is the single source of truth for a
 * resume — rendered artifacts are derived from it and can always be rebuilt.
 *
 * Only `basics` is meaningful-by-default; every other section is optional and
 * is omitted entirely from the rendering when absent.
 */
export interface ResumeContent {
  version?: number;
  basics?: ResumeBasics;
  summary?: string;
  experience?: ResumeExperience[];
  projects?: ResumeProject[];
  education?: ResumeEducation[];
  skills?: ResumeSkillGroup[];
  extras?: ResumeExtras[];
}

export interface ResumeOptions {
  template: string;
  theme: string;
  /**
   * The language of the resume itself — section headings and the exported
   * document. Independent of the browser UI language.
   */
  locale: Locale;
}

export interface ResumeRenderOptions extends ResumeOptions {
  content: ResumeContent;
  resumeId: string;
}

export interface ResumeInfo {
  id: string;
  template: string;
  theme: string;
  modifiedAt: Date;
  sizeBytes: number;
}

// ===== Route Types =====

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: string;
  port: number;
}

// ===== Page Rendering Types =====

export interface PageData {
  [key: string]: string | number | boolean | undefined;
}

export interface PageRenderOptions {
  title?: string;
  /** Dictionary key for the page title. Wins over `title` when both are given. */
  titleKey?: string;
  styles?: string[];
  scripts?: string[];
  includeNav?: boolean;
  includeFooter?: boolean;
  /** Language of the page chrome. */
  locale?: Locale;
  /** Path of the current request, used to build the language switch links. */
  path?: string;
}

// ===== WebSocket Types =====

export interface LiveSessionState {
  filePath: string;
  watcher: import("fs").FSWatcher;
  clients: Set<import("ws").WebSocket>;
}
