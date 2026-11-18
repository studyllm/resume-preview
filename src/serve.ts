/**
 * Standalone server mode (--serve)
 * Starts the live server without the MCP stdio transport,
 * registers the resumes stored on disk, and opens the gallery in the browser.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { access } from "fs/promises";
import { ensureLiveServer, addLiveSession } from "./live-server.js";
import { getResumeFilePath, getOpenCommand } from "./file-utils.js";
import { listResumes } from "./resume-service.js";
import { SESSION_NAMESPACES } from "./constants.js";

const execFileAsync = promisify(execFile);

/**
 * Registers the stored resumes as live preview sessions so their pages
 * refresh when the file changes.
 */
async function registerExistingResumes(): Promise<number> {
  let registered = 0;

  for (const resume of await listResumes()) {
    const htmlPath = getResumeFilePath(resume.id, "html");
    try {
      await access(htmlPath);
      await addLiveSession(resume.id, htmlPath, SESSION_NAMESPACES.RESUME);
      registered++;
    } catch {
      // Skip resumes that have no rendered HTML yet
    }
  }

  return registered;
}

export async function startServeMode(): Promise<void> {
  const resumeCount = await registerExistingResumes();
  const port = await ensureLiveServer();
  const galleryUrl = `http://localhost:${port}/`;

  console.log(`Serving ${resumeCount} resume(s) at ${galleryUrl}`);

  const { command, args } = getOpenCommand(galleryUrl);
  try {
    await execFileAsync(command, args);
  } catch {
    console.warn(`Could not open browser automatically. Open ${galleryUrl} manually.`);
  }
}
