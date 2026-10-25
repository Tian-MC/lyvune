#!/usr/bin/env python3
"""Checks that no CI workflow of this repository can publish anything by accident. Python 3, standard library only.

    scripts/check_no_publishing.py [REPO_DIR]

Publishing means a login to a registry, an image or package push, a release, a pull request opened by a bot, or the
use of a secret other than the workflow's own token. All of it may exist only in .github/workflows/release.yml, where
every job must be switched off (`if: ${{ false }}`) and the only trigger is a manual run. The other workflows verify:
they build, test and lint, and the packaging step runs GoReleaser as a snapshot with publishing skipped.

This is a text check, on purpose: it needs no YAML library, and it fails closed, so a new line that looks like
publishing fails it until someone looks at it. It exits with 0 when the repository is clean.
"""

import os
import re
import sys

RELEASE = "release.yml"

# These write comments and labels on this repository's own pull requests and issues, and nothing else
MAY_WRITE_PULL_REQUESTS = {"coverage-on-pr.yml", "stale.yml"}

# (what it is, regular expression) for lines that publish or authenticate to publish
FORBIDDEN = [
    ("a registry login", re.compile(r"docker/login-action|docker login|registry:\s*(ghcr\.io|docker\.io)", re.I)),
    ("an image push", re.compile(r"\bpush:\s*true\b|\bpush=true\b|push-by-digest|imagetools\s+create|docker\s+push", re.I)),
    ("write access to packages", re.compile(r"\bpackages:\s*write\b")),
    ("write access to the repository's contents", re.compile(r"\bcontents:\s*write\b")),
    ("write access to the repository's pull requests or issues", re.compile(r"\b(pull-requests|issues):\s*write\b")),
    # `git tag -l` and `git tag --sort=...` only read; `git tag v1.0` creates a tag
    ("a release or a tag", re.compile(r"gh\s+release\b|action-gh-release|create-release|\bgit\s+push\b|\bgit\s+tag\s+[^-\s]", re.I)),
    ("a bot that opens pull requests", re.compile(r"create-pull-request", re.I)),
    ("a secret other than the workflow's own token", re.compile(r"secrets\.(?!GITHUB_TOKEN\b)\w+")),
    ("the upstream project's registries or services", re.compile(r"DOCKER_HUB|POEDITOR|navidrome/navidrome|navidrome-bot", re.I)),
]

# GoReleaser is fine as a snapshot; any other use could create a release. Fail closed: any `args:` or
# `goreleaser ...` command line that says "release" has to say how it does not publish
GORELEASER = re.compile(r"(\bargs:|\bgoreleaser\s).*\brelease\b", re.I)
GORELEASER_SAFE = ("--snapshot", "--skip=publish")


def strip(line):
    """The line without a trailing comment (a # that starts one is preceded by a space)."""
    return re.sub(r"\s+#.*$", "", line.rstrip("\n"))


def jobs_of(lines):
    """job id -> (first line number, lines of its body), for the top-level `jobs:` mapping."""
    jobs, current, in_jobs = {}, None, False
    for i, line in enumerate(lines, 1):
        if re.match(r"^jobs:\s*$", line):
            in_jobs = True
            continue
        if in_jobs and re.match(r"^\S", line):
            in_jobs = False
        if not in_jobs:
            continue
        m = re.match(r"^  ([\w-]+):\s*$", line)
        if m:
            current = m.group(1)
            jobs[current] = (i, [])
        elif current:
            jobs[current][1].append(line)
    return jobs


def triggers_of(lines):
    """The names of the events in the `on:` mapping."""
    events, in_on = [], False
    for line in lines:
        if re.match(r"^(on|'on'|\"on\"):\s*$", line):
            in_on = True
            continue
        if in_on and re.match(r"^\S", line):
            break
        m = re.match(r"^  ([\w_]+):", line) if in_on else None
        if m:
            events.append(m.group(1))
    return events


def check_workflow(path, problems):
    name = os.path.basename(path)
    with open(path, encoding="utf-8") as f:
        lines = f.readlines()
    text = [strip(l) for l in lines]
    is_release = name == RELEASE

    for n, line in enumerate(text, 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not is_release:
            for what, rx in FORBIDDEN:
                if name in MAY_WRITE_PULL_REQUESTS and "pull requests or issues" in what:
                    continue
                if rx.search(line):
                    problems.append(f"{name}:{n}: {what}: {line.strip()}")
        if GORELEASER.search(line) and not all(f in line for f in GORELEASER_SAFE):
            problems.append(f"{name}:{n}: GoReleaser without --snapshot and --skip=publish: {line.strip()}")

    events = triggers_of(lines)
    if is_release:
        if events != ["workflow_dispatch"]:
            problems.append(f"{name}: the only trigger of the publishing workflow is a manual run, found {events}")
        jobs = jobs_of(lines)
        if not jobs:
            problems.append(f"{name}: no jobs found, the check cannot tell what it protects")
        for job, (n, body) in jobs.items():
            ifs = [strip(l).strip() for l in body if re.match(r"^    if:", l)]
            if not ifs or not re.fullmatch(r"if:\s*(\$\{\{\s*false\s*\}\}|false)", ifs[0]):
                problems.append(f"{name}:{n}: job '{job}' is not switched off (it needs `if: ${{{{ false }}}}`)")
    else:
        for ev in events:
            if ev == "workflow_run":
                continue  # reads the verification run's results; it cannot publish (the rules above forbid how)
        if "workflow_dispatch" in events and "inputs" in "".join(text) and re.search(r"\bpublish\b", "".join(text)):
            problems.append(f"{name}: a manual `publish` input outside the publishing workflow")
        # a tag push must never start a verification workflow that releases: nothing above allows it, but say so
        tags = re.search(r"^    tags:", "\n".join(lines), re.M)
        if tags and name == "docker.yml":
            problems.append(f"{name}: tag triggers belong to the publishing workflow")


def check_goreleaser(repo, problems):
    path = os.path.join(repo, "release", "goreleaser.yml")
    if not os.path.exists(path):
        return
    text = open(path, encoding="utf-8").read()
    m = re.search(r"^release:\n((?:[ \t]+.*\n|\n)+)", text, re.M)
    if not m or not re.search(r"^\s+disable:\s*true\b", m.group(1), re.M):
        problems.append("release/goreleaser.yml: `release:` must say `disable: true`, so that GoReleaser creates no release")
    for what, rx in [("a link to the upstream project", re.compile(r"navidrome\.org|github\.com/navidrome|github\.com/sponsors/deluan|ko-fi\.com/deluan", re.I))]:
        for n, line in enumerate(text.splitlines(), 1):
            if rx.search(line) and not line.lstrip().startswith("#"):
                problems.append(f"release/goreleaser.yml:{n}: {what}: {line.strip()}")


def main():
    repo = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..")
    workflows = os.path.join(repo, ".github", "workflows")
    problems = []
    names = sorted(f for f in os.listdir(workflows) if f.endswith((".yml", ".yaml")))
    if RELEASE not in names:
        problems.append(f".github/workflows/{RELEASE}: the publishing workflow is missing, so there is nowhere for publishing to live")
    for name in names:
        check_workflow(os.path.join(workflows, name), problems)
    check_goreleaser(repo, problems)
    actions = os.path.join(repo, ".github", "actions")
    if os.path.isdir(actions):
        for d in sorted(os.listdir(actions)):
            problems.append(f".github/actions/{d}: a composite action nothing needs; the ones that existed logged in to registries")

    print(f"checked {len(names)} workflows and release/goreleaser.yml")
    for p in problems:
        print("PROBLEM  " + p)
    print("clean: nothing here can publish" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
