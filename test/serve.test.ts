import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: Function) => cb(null)),
}));

vi.mock("fs/promises", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    access: vi.fn(),
  };
});

vi.mock("../src/live-server.js", () => ({
  ensureLiveServer: vi.fn().mockResolvedValue(3737),
  addLiveSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/resume-service.js", () => ({
  listResumes: vi.fn(),
}));

import { access } from "fs/promises";
import { ensureLiveServer, addLiveSession } from "../src/live-server.js";
import { listResumes } from "../src/resume-service.js";
import { SESSION_NAMESPACES } from "../src/constants.js";
import { startServeMode } from "../src/serve.js";

const mockAccess = vi.mocked(access);
const mockEnsureLiveServer = vi.mocked(ensureLiveServer);
const mockAddLiveSession = vi.mocked(addLiveSession);
const mockListResumes = vi.mocked(listResumes);

function resumeInfo(id: string) {
  return {
    id,
    template: "default",
    theme: "default",
    modifiedAt: new Date(),
    sizeBytes: 1024,
  };
}

describe("startServeMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureLiveServer.mockResolvedValue(3737);
    mockListResumes.mockResolvedValue([]);
  });

  it("starts the live server and opens the gallery", async () => {
    await startServeMode();

    expect(mockEnsureLiveServer).toHaveBeenCalled();
  });

  it("registers the stored resumes that have a rendered HTML file", async () => {
    mockListResumes.mockResolvedValue([resumeInfo("flow"), resumeInfo("arch")]);
    mockAccess.mockResolvedValue(undefined);

    await startServeMode();

    expect(mockAddLiveSession).toHaveBeenCalledTimes(2);
    expect(mockAddLiveSession).toHaveBeenCalledWith(
      "flow",
      expect.stringContaining("resume.html"),
      SESSION_NAMESPACES.RESUME
    );
    expect(mockAddLiveSession).toHaveBeenCalledWith(
      "arch",
      expect.stringContaining("resume.html"),
      SESSION_NAMESPACES.RESUME
    );
  });

  it("skips resumes without a rendered HTML file", async () => {
    mockListResumes.mockResolvedValue([resumeInfo("good"), resumeInfo("bad")]);
    mockAccess.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("ENOENT"));

    await startServeMode();

    expect(mockAddLiveSession).toHaveBeenCalledTimes(1);
    expect(mockAddLiveSession).toHaveBeenCalledWith(
      "good",
      expect.stringContaining("resume.html"),
      SESSION_NAMESPACES.RESUME
    );
  });

  it("handles an empty resume directory gracefully", async () => {
    mockListResumes.mockResolvedValue([]);

    await startServeMode();

    expect(mockAddLiveSession).not.toHaveBeenCalled();
    expect(mockEnsureLiveServer).toHaveBeenCalled();
  });
});
