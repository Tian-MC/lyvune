# Releasing Lyvune

> **Publishing is switched off.** Nothing in this repository publishes an image, a package or a release, not on a
> push, not on a tag and not by hand. It stays that way until the Docker image has been built and tested on a real
> Docker host (see [What has to be true before publishing](#what-has-to-be-true-before-publishing)).

## What runs, and what is blocked

| Workflow | Runs when | What it does | Status |
| --- | --- | --- | --- |
| `pipeline.yml` ("Pipeline: Test, Lint, Build") | a push to `master`, a pull request to `master`, a `v*` tag | Go and UI tests, lint, migration and translation checks, builds the binaries for 11 platforms and starts them under QEMU, builds the Windows installers and the `.deb`/`.rpm` packages **as a snapshot** (nothing uploaded), and checks that no workflow publishes | **works**, verification only, read-only token |
| `docker.yml` ("Docker image: test") | a pull request or a push to `master` that changes the image, Compose files or scripts, or by hand | builds the image for `amd64` and `arm64`, each on its own architecture, and runs `scripts/docker-smoke-test.sh` against it. The image stays on the runner | **written, never run yet**: it needs a Docker host and the ARM runner |
| `coverage-on-pr.yml`, `download-link-on-pr.yml` | after the pipeline finishes for a pull request | comment the coverage and the artifact links on that pull request | works, comments only |
| `stale.yml` | every night, or by hand | closes and locks stale issues and pull requests of this repository | works |
| `release.yml` ("Release (DISABLED)") | by hand only | would publish the image to `ghcr.io/tian-mc/lyvune` and create a draft GitHub release | **disabled: every job is `if: ${{ false }}`** |

Pushing a branch, with or without commits that touch the files above, starts no workflow: the triggers are the ones in
the table.

### Why nothing can publish by accident

1. `pipeline.yml` and `docker.yml` have no registry login, no push, no release, and a token that can only read the
   repository. The GoReleaser step in the pipeline always runs as `--snapshot --skip=publish`, for a tag as for a
   branch, and without a token.
2. `release/goreleaser.yml` says `release: disable: true`, so GoReleaser creates no release even when it is run without
   those flags.
3. `release.yml` is the one place where publishing may exist. Its only trigger is a manual run, and every job in it is
   switched off with a literal `if: ${{ false }}`. The tag trigger is a commented block.
4. `scripts/check_no_publishing.py` runs in the pipeline (the "Check that no workflow publishes" job, which the build
   waits for). It fails if a workflow other than `release.yml` gains a registry login, an image push, a release or a tag,
   write access to packages or contents, a secret other than the workflow's own token, a reference to Navidrome's Docker
   Hub or translation service, or GoReleaser without the snapshot flags; and if a job of `release.yml` loses its switch,
   or `release.yml` gains a trigger other than a manual run. It fails closed. It was tried against 16 deliberate mistakes
   and against a brand new publishing workflow, and caught every one, and accepted two harmless changes.

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

## What has to be true before publishing

1. **The Docker image has been built and tested on a Docker host, on both platforms.**
   - *Done for `linux/amd64`* (run by the maintainer on an Arch Linux host with `scripts/docker-smoke-test.sh`, all checks
     passed): the image builds, runs as an unprivileged user and is `healthy`; the web interface, assets, accounts,
     Subsonic, scan, streaming and lyrics work; users and saved lyrics survive a restart; SIGTERM stops it with exit
     code 0; a read-only library refuses to save lyrics; a copied `navidrome.db` and `navidrome.toml` are used; an
     unwritable data folder fails loudly; Compose files are valid.
   - *Also done on amd64:* `mpv`, the `libwebp` libraries, no `curl`, and an MP3 transcode through ffmpeg.
   - *Not done yet:* `linux/arm64` (the binary has been compiled, never started), and `docker.yml` in CI.
2. **What is published is Lyvune's.** Today only the image and the Linux binaries are. The `.deb`, `.rpm` and Windows
   installers still carry Navidrome's names, paths and users (`/etc/navidrome`, the `navidrome` user, `navidrome.wxs`);
   they are built as snapshots and **not** published until they have been rebranded and tried on a real system.
3. **The first image has a plan to be tried.** After publishing, `docker pull` it on a clean host and run the smoke test
   against the published image.

## The first alpha: Docker only

`v0.1.0-alpha.1` can be an image and nothing else, because the image is the one thing that is Lyvune's end to end and
has been run on a real Docker host. Still to do before it, in this order:

1. Merge this work into `master` and see the pipeline and `docker.yml` pass there. `docker.yml` has not run in CI yet,
   and its `arm64` leg is the first time the arm64 image is started anywhere.
2. Make the repository public, or the image private. A private repository publishes a private package that nobody can
   pull; decide it before enabling anything.
3. Enable `publish-image` only (see below). `publish-binaries` stays off.
4. Pull the published image on a clean host and run `scripts/docker-smoke-test.sh --image ghcr.io/tian-mc/lyvune:0.1.0-alpha.1`.

An alpha is for people who accept that: say in the release notes that arm64 is new, that the `.deb`, `.rpm` and Windows
installers are not part of it, and that the server still reports itself to Subsonic clients as `navidrome`.

## Release strategy

For when publishing is on.

- **Versions** follow SemVer. Pre-releases carry a suffix (`v0.1.0-alpha`, `v0.1.0-beta.1`, `v0.1.0-rc.1`); a stable
  version has none (`v1.0.0`). The module is `github.com/Tian-MC/lyvune`.
- **Tags are made by a person, by hand,** on a commit of `master` that the pipeline has passed. No workflow creates a tag.
- **The image** is `ghcr.io/tian-mc/lyvune`, for `linux/amd64` and `linux/arm64`. A pre-release publishes its own tag
  (`0.1.0-alpha`) and nothing else. A stable version publishes `1.2.3` and `1.2`, and only a stable version moves `latest`.
- **The GitHub release** is created as a draft, and as a pre-release when the tag has a suffix. It carries the Linux
  tarballs for `amd64` and `arm64` and a checksums file; the binary inside is `lyvune`. The notes are generated from the
  commit messages. A person reads the draft and publishes it.
- **Nothing else is released** until it is Lyvune's (see above).

## Enabling publication

This is a decision, made in a reviewed commit, after the checks above. It is not a setting to flip.

1. In `.github/workflows/release.yml`, replace `if: ${{ false }}` of `publish-image` with the condition written in the
   comment above it (the Lyvune repository, and a tag that starts with `v`), and uncomment the tag trigger. Leave
   `publish-binaries` off until the Linux tarballs have been tried.
2. In `scripts/check_no_publishing.py`, change the rule for `release.yml` to say which job may be on. The check refuses
   a job that is on and a trigger that is not manual until it is changed, and that change is what a reviewer reads.
3. Merge, then tag by hand, for example `git tag -a v0.1.0-alpha -m "Lyvune 0.1.0-alpha" && git push origin v0.1.0-alpha`.
4. Look at the package that appeared in the repository's *Packages* (the first one is private; decide its visibility),
   pull it on a clean host and run `scripts/docker-smoke-test.sh --image ghcr.io/tian-mc/lyvune:0.1.0-alpha`.

To take a bad release back: delete the draft release or the package version in GitHub, and delete the tag
(`git push origin :v0.1.0-alpha`). Nothing deletes them automatically.
