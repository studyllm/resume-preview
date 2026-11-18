import { spawn } from "child_process";
import { writeFile, mkdir, copyFile } from "fs/promises";
import { dirname } from "path";
import { ensureLiveServer, addLiveSession, hasActiveConnections } from "./live-server.js";
import {
  validateSavePath,
  getOpenCommand,
  getResumeFilePath,
  saveResumeContent,
  saveResumeOptions,
  loadResumeContent,
  loadResumeOptions,
  normalizeResumeContent,
  validateResumeId,
  validateResumeTemplate,
  validateResumeTheme,
  validateResumeFormat,
  validateResumeLocale,
  slugifyResumeId,
  invalidateResumeArtifacts,
  isResumeArtifactStale,
} from "./file-utils.js";
import { mcpLogger } from "./logger.js";
import { renderResumeHtml, renderResumeExportHtml, renderResumePdf } from "./resume-renderer.js";
import type { ResumeContent, Locale } from "./types.js";
import {
  DEFAULT_RESUME_TEMPLATE,
  DEFAULT_RESUME_THEME,
  DEFAULT_RESUME_FORMAT,
  DEFAULT_RESUME_LOCALE,
  SESSION_NAMESPACES,
} from "./constants.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createErrorResponse(text: string) {
  return { content: [{ type: "text", text }], isError: true };
}

// ===== Resume tools =====

/**
 * Registers the resume's live preview session and opens the browser the
 * first time it is rendered.
 */
async function setupResumeLivePreview(
  resumeId: string,
  slug: string,
  htmlPath: string
): Promise<{ serverUrl: string; hasConnections: boolean }> {
  const port = await ensureLiveServer();
  const hasConnections = hasActiveConnections(slug, SESSION_NAMESPACES.RESUME);

  await addLiveSession(slug, htmlPath, SESSION_NAMESPACES.RESUME);
  const serverUrl = `http://localhost:${port}/resume/${slug}`;

  if (!hasConnections) {
    mcpLogger.info(`Opening browser for new resume: ${slug}`, { serverUrl });
    const { command, args } = getOpenCommand(serverUrl);
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore" });
      child.on("error", (error) => {
        mcpLogger.warn("Failed to open browser", { error: error.message, serverUrl });
      });
      child.unref();
    } catch (error) {
      // On Windows, spawn throws synchronously when the command exists but is
      // not a valid executable — the async "error" event never fires. The
      // resume is already rendered at this point, so failing to open a browser
      // must not fail the call: the client still needs the live URL.
      mcpLogger.warn("Failed to open browser", { error: errorMessage(error), serverUrl });
    }
  } else {
    mcpLogger.info(`Reusing existing browser tab for resume: ${slug}`);
  }

  return { serverUrl, hasConnections };
}

function createResumePreviewResponse(
  workingFile: string,
  serverUrl: string,
  hasConnections: boolean
): any {
  const actionMessage = hasConnections
    ? "Resume updated successfully."
    : "Resume rendered successfully and opened in browser.";

  const liveMessage = hasConnections
    ? "\nResume updated. Browser will refresh automatically."
    : `\nLive reload URL: ${serverUrl}\nThe resume will auto-refresh when you update it.`;

  return {
    content: [
      {
        type: "text",
        text: `${actionMessage}\nWorking file: ${workingFile}\n${liveMessage}`,
      },
    ],
  };
}

export async function handleResumePreview(args: any) {
  const resumeId = args.resume_id as string;
  const providedTemplate = args.template as string | undefined;
  const providedTheme = args.theme as string | undefined;
  const providedLocale = args.locale as string | undefined;

  if (!resumeId) {
    return createErrorResponse("resume_id parameter is required");
  }
  if (args.content === undefined || args.content === null) {
    return createErrorResponse("content parameter is required");
  }

  let content: ResumeContent;
  let validatedLocale: Locale | undefined;
  try {
    validateResumeId(resumeId);
    if (providedTemplate !== undefined) validateResumeTemplate(providedTemplate);
    if (providedTheme !== undefined) validateResumeTheme(providedTheme);
    if (providedLocale !== undefined) validatedLocale = validateResumeLocale(providedLocale);
    content = normalizeResumeContent(args.content);
  } catch (error) {
    return createErrorResponse(errorMessage(error));
  }

  try {
    const storedOptions = await loadResumeOptions(resumeId);
    const template = providedTemplate ?? storedOptions.template ?? DEFAULT_RESUME_TEMPLATE;
    const theme = providedTheme ?? storedOptions.theme ?? DEFAULT_RESUME_THEME;
    // An omitted locale keeps the language the resume was written in.
    const locale = validatedLocale ?? storedOptions.locale ?? DEFAULT_RESUME_LOCALE;

    await saveResumeContent(resumeId, content);
    await saveResumeOptions(resumeId, { template, theme, locale });

    // The content changed, so any cached export artifact is stale. Dropping
    // it here keeps the next export in sync with what the browser shows.
    await invalidateResumeArtifacts(resumeId);

    const htmlPath = getResumeFilePath(resumeId, "html");
    await writeFile(htmlPath, await renderResumeHtml(content, locale), "utf-8");

    const slug = slugifyResumeId(resumeId);
    const { serverUrl, hasConnections } = await setupResumeLivePreview(resumeId, slug, htmlPath);

    mcpLogger.info(`Resume rendered: ${slug}`, { template, theme, locale });

    return createResumePreviewResponse(
      getResumeFilePath(resumeId, "content"),
      serverUrl,
      hasConnections
    );
  } catch (error) {
    return createErrorResponse(`Error rendering resume: ${errorMessage(error)}`);
  }
}

export async function handleResumeExport(args: any) {
  const resumeId = args.resume_id as string;
  const savePath = args.save_path as string;
  const format = (args.format as string) ?? DEFAULT_RESUME_FORMAT;
  const refresh = args.refresh === true;

  if (!savePath) {
    return createErrorResponse("save_path parameter is required");
  }
  if (!resumeId) {
    return createErrorResponse("resume_id parameter is required");
  }

  try {
    validateResumeId(resumeId);
    validateResumeFormat(format);
  } catch (error) {
    return createErrorResponse(errorMessage(error));
  }

  try {
    validateSavePath(savePath, format);
  } catch (error) {
    return createErrorResponse(`Invalid save path: ${errorMessage(error)}`);
  }

  try {
    const content = await loadResumeContent(resumeId);
    // The exported document follows the resume's own language, never the
    // language of whoever triggered the export.
    const options = await loadResumeOptions(resumeId);
    const artifactKind = format === "pdf" ? "pdf" : "exportHtml";
    const target = getResumeFilePath(resumeId, artifactKind);

    // The cached artifact is reused only when it is at least as new as the
    // content it was rendered from. Otherwise the export would ship the
    // previous version of the resume.
    const stale = await isResumeArtifactStale(resumeId, artifactKind);
    if (refresh || stale) {
      await invalidateResumeArtifacts(resumeId);
      if (format === "pdf") {
        await writeFile(target, await renderResumePdf(content, options.locale));
      } else {
        await writeFile(target, await renderResumeExportHtml(content, options.locale), "utf-8");
      }
    }

    const saveDir = dirname(savePath);
    await mkdir(saveDir, { recursive: true });
    await copyFile(target, savePath);

    return {
      content: [
        {
          type: "text",
          text: `Resume saved to: ${savePath} (${format.toUpperCase()})`,
        },
      ],
    };
  } catch (error) {
    return createErrorResponse(`Error saving resume: ${errorMessage(error)}`);
  }
}
