import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { Context, Effect, Layer } from "effect"
import { AbsolutePath, RunFailure, type Candidate } from "../domain.js"

const execFilePromise = promisify(execFile)

export type CandidateArchiveShape = {
  readonly createLocalTar: (candidate: Candidate) => Effect.Effect<AbsolutePath, RunFailure>
  readonly cleanupLocalTar: (archivePath: AbsolutePath) => Effect.Effect<void, RunFailure>
}

export class CandidateArchive extends Context.Service<CandidateArchive, CandidateArchiveShape>()("CandidateArchive") {}

export const CandidateArchiveLive = Layer.succeed(CandidateArchive, {
  createLocalTar: (candidate) =>
    Effect.gen(function* () {
      const tempDir = yield* Effect.tryPromise({
        try: () => mkdtemp(path.join(os.tmpdir(), "sanity-candidate-")),
        catch: (cause) =>
          new RunFailure({
            phase: "candidate",
            message: `Could not create temporary candidate archive directory: ${String(cause)}`,
            actionableFix: "Check local filesystem permissions and available disk space."
          })
      })
      const archivePath = AbsolutePath.make(path.join(tempDir, "candidate.tgz"))
      yield* Effect.tryPromise({
        try: () =>
          execFilePromise("tar", [
            "-czf",
            archivePath,
            "--exclude",
            ".git",
            "--exclude",
            "node_modules",
            "--exclude",
            "dist",
            "--exclude",
            "coverage",
            "--exclude",
            ".sanity/runs",
            "-C",
            candidate.path,
            "."
          ]),
        catch: (cause) =>
          new RunFailure({
            phase: "candidate",
            message: `Could not archive local candidate ${candidate.path}: ${String(cause)}`,
            actionableFix: "Make sure --candidate points to a readable local directory with tar available."
          })
      }).pipe(
        Effect.tapError(() => Effect.promise(() => rm(tempDir, { recursive: true, force: true })))
      )
      return archivePath
    }),
  cleanupLocalTar: (archivePath) =>
    Effect.tryPromise({
      try: () => rm(path.dirname(archivePath), { recursive: true, force: true }),
      catch: (cause) =>
        new RunFailure({
          phase: "candidate",
          message: `Could not remove temporary candidate archive ${archivePath}: ${String(cause)}`,
          actionableFix: "Check local filesystem permissions and remove the temporary archive manually if needed."
        })
    })
})

export const makeCandidateArchiveFake = (archivePath: AbsolutePath): CandidateArchiveShape => ({
  createLocalTar: () => Effect.succeed(archivePath),
  cleanupLocalTar: () => Effect.void
})
