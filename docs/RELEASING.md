# Releasing Lyvune

> **Nothing publishes by itself.** The one thing this repository can publish is the Docker image
> `ghcr.io/tian-mc/lyvune`, and only when a person starts [`release.yml`](../.github/workflows/release.yml) by hand, from
> `master`, names a tag that already exists and types `publish`. No push, no pull request and no tag starts it.
> Packages (`.deb`, `.rpm`, Windows) and GitHub releases are never published by a workflow.

## What runs, and what is blocked

| Workflow | Runs when | What it does | Status |
| --- | --- | --- | --- |
| `pipeline.yml` ("Pipeline: Test, Lint, Build") | a push to `master`, a pull request to `master`, a `v*` tag | Go and UI tests, lint, migration and translation checks, builds the binaries for 11 platforms and starts them under QEMU, builds the Windows installers and the `.deb`/`.rpm` packages **as a snapshot** (nothing uploaded), and checks that no workflow publishes | **works**, verification only, read-only token |
| `docker.yml` ("Docker image: test") | a pull request or a push to `master` that changes the image, Compose files or scripts, or by hand | builds the image for `amd64` and `arm64`, each on its own architecture, and runs `scripts/docker-smoke-test.sh` against it. The image stays on the runner | works (see [Tested on](#tested-on)) |
| `coverage-on-pr.yml`, `download-link-on-pr.yml` | after the pipeline finishes for a pull request | comment the coverage and the artifact links on that pull request | works, comments only |
| `stale.yml` | every night, or by hand | closes and locks stale issues and pull requests of this repository | works |
| `release.yml` ("Release: Docker image to GHCR") | by hand only, from `master`, with a tag and the word `publish` | checks the request, tests the image on amd64 and arm64, pushes it to `ghcr.io/tian-mc/lyvune` as one tag, tests the pushed image again | **ready, never run**: it only appears in the Actions tab once it is on `master` |

Pushing a branch, with or without commits that touch the files above, starts no workflow: the triggers are the ones in
the table.

### Why nothing can publish by accident

1. `pipeline.yml` and `docker.yml` have no registry login, no push, no release, and a token that can only read the
   repository. The GoReleaser step in the pipeline always runs as `--snapshot --skip=publish`, for a tag as for a
   branch, and without a token.
2. `release/goreleaser.yml` says `release: disable: true`, so GoReleaser creates no release even when it is run without
   those flags.
3. `release.yml` is the one place where publishing may exist. Its only trigger is a manual run. The first job refuses
   to go on unless the run is on `master`, in this repository, `confirm` says `publish`, the tag looks like a version
   (`v0.1.0-alpha.1`), exists, points at a commit of `master`, and the Pipeline passed on that commit. Every other job
   waits for it. The image is tested before it is pushed and again after, by its digest. It pushes one tag (the
   version), never `latest`, only to `ghcr.io`, and creates no tag and no GitHub release. The Linux tarball job is off.
4. `scripts/check_no_publishing.py` runs in the pipeline (the "Check that no workflow publishes" job, which the build
   waits for). It fails if a workflow other than `release.yml` gains a registry login, an image push, a release or a tag,
   write access to packages or contents, a secret other than the workflow's own token, a reference to Navidrome's Docker
   Hub or translation service, or GoReleaser without the snapshot flags; and if `release.yml` gains a trigger other than
   a manual run, loses a guard or a `needs`, tags `latest`, uses another registry or GoReleaser, or gives any job but
   the one that pushes the right to push. It fails closed. It was tried against 24 deliberate mistakes and caught every one,
   and it accepted two harmless changes.

You can run it yourself: `python3 scripts/check_no_publishing.py` (it needs Python 3 and nothing else).

## What was removed from the inherited pipeline

The pipeline that came with Navidrome published images and releases. This is what it did, and what happened to it:

| Was | Because | Now |
| --- | --- | --- |
| `build` pushed an image to `ghcr.io/<repo>` and to Docker Hub (`vars.DOCKER_HUB_REPO`) | it did so whenever the secret `DOCKER_HUB_USERNAME` existed, on every push to `master` and every pull request (tags `develop`, `pr-N`) | removed, with the registry logins |
| `push-manifest-ghcr` (`packages: write`), `push-manifest-dockerhub`, `cleanup-digests` | merged the pushed images into tags; the Docker Hub job also pushed to `navidrome/navidrome` when run in Navidrome's repository | removed |
| `release` ran GoReleaser **with publishing** on a `v*` tag | creating a GitHub release (a draft) with packages named and described as Navidrome's, with links to Navidrome's website and a sponsor appeal | always a snapshot, publishing skipped, no token; the GoReleaser config can no longer create a release |
| `.github/actions/prepare-docker` | logged in to Docker Hub and the GitHub registry, labelled images `deluan@navidrome.org` | removed |
| `push-translations.yml`, `update-translations.yml` (and their scripts) | pushed translations to Navidrome's POEditor project and opened pull requests as `navidrome-bot` with a personal token; they only ran for the `navidrome` owner | removed |
| `.github/FUNDING.yml` | put Navidrome's sponsor links on the repository page | removed |
| issue templates, `stale.yml` | sent bug reports and questions to Navidrome's repository | point to this repository |

One dependency on Navidrome's organisation is left, and it only reads: the Windows test job downloads the ffmpeg
build `navidrome/ffmpeg-windows-builds`.

## Tested on

`scripts/docker-smoke-test.sh` builds or pulls the image, starts it and checks it (the web interface and assets, accounts,
Subsonic, scan, streaming, an MP3 transcode, lyrics saved and refused on a read-only library, the health check, a restart,
SIGTERM, a Navidrome migration, an unwritable data folder, `mpv`, `libwebp`, no `curl`).

| | Where | Result |
| --- | --- | --- |
| `linux/amd64` | the maintainer's Docker host (Arch Linux), before the audit fixes | all checks passed |
| `linux/amd64` | GitHub runner, `docker.yml` | not run in CI yet |
| `linux/arm64` | GitHub ARM runner, `docker.yml` | not run in CI yet |
| the published image | `verify-published` in `release.yml` | not run: nothing is published |

Not tested anywhere: the `.deb`, `.rpm` and Windows installers (they are not published), a real ARM board.

## What has to be true before publishing

1. **The image is tested on both platforms** (above), and `docker.yml` and the Pipeline pass on the commit to tag.
2. **What is published is Lyvune's.** Only the image is. The `.deb`, `.rpm` and Windows installers still carry
   Navidrome's names, paths and users (`/etc/navidrome`, the `navidrome` user, `navidrome.wxs`); they are built as
   snapshots and **not** published until they have been rebranded and tried on a real system.
3. **The package can be pulled.** A package pushed from a private repository is private. Make the repository, or the
   package (*Packages*, then *Package settings*, then *Change visibility*; GitHub offers no API for that), public
   before telling anyone to pull it.

## Release strategy

- **Versions** follow SemVer. Pre-releases carry a suffix (`v0.1.0-alpha.1`, `v0.1.0-beta.1`, `v0.1.0-rc.1`); a stable
  version has none (`v1.0.0`). The module is `github.com/Tian-MC/lyvune`.
- **Tags are made by a person, by hand,** on a commit of `master` that the pipeline has passed. No workflow creates a tag.
- **The image** is `ghcr.io/tian-mc/lyvune:<version>` (without the `v`), for `linux/amd64` and `linux/arm64`: exactly
  one tag per release. `latest` and `major.minor` tags are not produced by the workflow; adding them for a stable version
  is a reviewed change to `release.yml` and to the checker.
- **The GitHub release** is created by a person, after the image has been checked, as a pre-release when the tag has a
  suffix. The notes are in `docs/releases/`. No binaries are attached to the first alpha.
- **Nothing else is released** until it is Lyvune's (see above).

## How to publish the image

1. Merge the pull request. Check that the Pipeline and `docker.yml` are green on `master`.
2. Write the release notes (`docs/releases/vX.Y.Z.md`) and merge them.
3. Tag by hand, on that commit of `master`:
   `git tag -a v0.1.0-alpha.1 -m "Lyvune 0.1.0-alpha.1" && git push origin v0.1.0-alpha.1`.
4. In *Actions*, *Release: Docker image to GHCR*, *Run workflow* on `master`: the tag, and `publish` in the confirmation.
   Or: `gh workflow run release.yml --ref master -f tag=v0.1.0-alpha.1 -f confirm=publish`.
5. The run checks the request, tests the image on both architectures, pushes it and tests what was pushed. Its summary
   has the digest. Check by hand: `docker buildx imagetools inspect ghcr.io/tian-mc/lyvune:0.1.0-alpha.1` lists
   `linux/amd64` and `linux/arm64`.
6. Create the GitHub pre-release from the tag with the notes: `gh release create v0.1.0-alpha.1 --prerelease --verify-tag
   --title "Lyvune v0.1.0-alpha.1" --notes-file docs/releases/v0.1.0-alpha.1.md`. Add the digest to the notes.
7. Set the package visibility (above), pull the image on a clean host and follow the notes from the top.

To take a bad release back: delete the package version in GitHub (*Packages*), the release, and the tag
(`git push origin :v0.1.0-alpha.1`). Nothing deletes them automatically. If the run stops before the push, nothing was
published; running it again with the same tag is safe.
