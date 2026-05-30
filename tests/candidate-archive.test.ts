import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { AbsolutePath } from "../src/domain.js"
import { CandidateArchive, CandidateArchiveLive } from "../src/run/candidate-archive.js"

const execFilePromise = promisify(execFile)

describe("CandidateArchiveLive", () => {
  it("creates a candidate tarball without generated or prior-run directories", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "sanity-archive-test-"))
    await writeFile(path.join(projectRoot, "package.json"), "{}")
    await mkdir(path.join(projectRoot, ".git"), { recursive: true })
    await mkdir(path.join(projectRoot, "node_modules"), { recursive: true })
    await mkdir(path.join(projectRoot, "dist"), { recursive: true })
    await mkdir(path.join(projectRoot, "coverage"), { recursive: true })
    await mkdir(path.join(projectRoot, ".sanity", "runs", "old-run"), { recursive: true })
    await writeFile(path.join(projectRoot, ".git", "config"), "secret")
    await writeFile(path.join(projectRoot, "node_modules", "dep.js"), "dep")
    await writeFile(path.join(projectRoot, "dist", "bundle.js"), "bundle")
    await writeFile(path.join(projectRoot, "coverage", "coverage.json"), "{}")
    await writeFile(path.join(projectRoot, ".sanity", "runs", "old-run", "recording.mp4"), "video")

    const archivePath = await Effect.runPromise(
      Effect.gen(function* () {
        const archive = yield* CandidateArchive
        return yield* archive.createLocalTar({ _tag: "LocalCandidate", path: AbsolutePath.make(projectRoot) })
      }).pipe(Effect.provide(CandidateArchiveLive))
    )
    const { stdout } = await execFilePromise("tar", ["-tzf", archivePath])

    expect(stdout).toContain("./package.json")
    expect(stdout).not.toContain("./.git/")
    expect(stdout).not.toContain("./node_modules/")
    expect(stdout).not.toContain("./dist/")
    expect(stdout).not.toContain("./coverage/")
    expect(stdout).not.toContain("./.sanity/runs/")

    await Effect.runPromise(
      Effect.gen(function* () {
        const archive = yield* CandidateArchive
        yield* archive.cleanupLocalTar(archivePath)
      }).pipe(Effect.provide(CandidateArchiveLive))
    )
  })

  it("cleans up its temp archive directory when tar creation fails", async () => {
    const missingRoot = AbsolutePath.make(path.join(os.tmpdir(), "sanity-missing-candidate"))
    const before = new Set((await readdir(os.tmpdir())).filter((entry) => entry.startsWith("sanity-candidate-")))

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const archive = yield* CandidateArchive
          yield* archive.createLocalTar({ _tag: "LocalCandidate", path: missingRoot })
        }).pipe(Effect.provide(CandidateArchiveLive))
      )
    ).rejects.toMatchObject({ _tag: "RunFailure" })

    const after = (await readdir(os.tmpdir())).filter((entry) => entry.startsWith("sanity-candidate-"))
    expect(after.filter((entry) => !before.has(entry))).toEqual([])
  })
})
