/**
 * Resume Service
 * Single Responsibility: Business logic for resume data access and management
 */

import { readdir, stat } from "fs/promises";
import {
  getResumesDir,
  getResumeFilePath,
  validatePreviewId,
  loadResumeOptions,
  deleteResumeDirectory,
} from "./file-utils.js";
import { webLogger } from "./logger.js";
import type { ResumeInfo } from "./types.js";

/**
 * Artifacts that can stand in for "the rendered resume", in the order they
 * are probed. The format is deliberately not exposed in the API response —
 * probing for it turned into a known modelling gap.
 */
const ARTIFACT_KINDS = ["html", "exportHtml", "pdf", "content"] as const;

/**
 * Lists all resumes stored under the resumes directory.
 * @returns Array of resume info sorted by modification time (newest first)
 */
export async function listResumes(): Promise<ResumeInfo[]> {
  try {
    const resumesDir = getResumesDir();
    const entries = await readdir(resumesDir, { withFileTypes: true });
    const resumes: ResumeInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      try {
        // The directory name is the slug, which always satisfies the id rules
        validatePreviewId(entry.name);

        const info = await getResumeInfo(entry.name);
        if (info) {
          resumes.push(info);
        }
      } catch (error) {
        // Skip invalid or inaccessible resumes
        webLogger.debug(`Skipping resume directory: ${entry.name}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Sort by modification time (newest first)
    resumes.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

    webLogger.debug(`Listed ${resumes.length} resumes`);
    return resumes;
  } catch (error) {
    webLogger.error("Failed to list resumes", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Gets detailed information about a specific resume.
 * @param resumeId The resume id or slug
 * @returns Resume info or null if not found
 */
export async function getResumeInfo(resumeId: string): Promise<ResumeInfo | null> {
  try {
    validatePreviewId(resumeId);

    let modifiedAt: Date | null = null;
    let sizeBytes = 0;

    for (const kind of ARTIFACT_KINDS) {
      try {
        const filePath = getResumeFilePath(resumeId, kind);
        const stats = await stat(filePath);
        modifiedAt = stats.mtime;
        sizeBytes = stats.size;
        break;
      } catch {
        continue;
      }
    }

    if (!modifiedAt) {
      webLogger.debug(`Resume not found: ${resumeId}`);
      return null;
    }

    const options = await loadResumeOptions(resumeId);

    return {
      id: resumeId,
      template: options.template,
      theme: options.theme,
      modifiedAt,
      sizeBytes,
    };
  } catch (error) {
    webLogger.error(`Error getting resume info: ${resumeId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Deletes a resume and all its associated files.
 * @param resumeId The resume id or slug
 */
export async function deleteResume(resumeId: string): Promise<void> {
  try {
    validatePreviewId(resumeId);

    const info = await getResumeInfo(resumeId);
    if (!info) {
      throw new Error(`Resume not found: ${resumeId}`);
    }

    await deleteResumeDirectory(resumeId);

    webLogger.info(`Deleted resume: ${resumeId}`);
  } catch (error) {
    webLogger.error(`Error deleting resume: ${resumeId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
