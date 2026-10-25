#!/usr/bin/env bash
# End-to-end test of the Lyvune Docker image. It needs Docker and Python 3, builds the image (or uses one you name),
# and runs real containers against temporary folders and a small generated music library. It touches nothing else:
# every container, folder and image it makes carries the prefix below and is removed at the end.
#
#   scripts/docker-smoke-test.sh                       build lyvune:smoke and test it
#   scripts/docker-smoke-test.sh --image IMG           test an existing image (it is built for the platform
#                                                      Docker runs on; use --platform to pick another)
#   scripts/docker-smoke-test.sh --keep                leave the temporary folders and containers
#
# The checks themselves are in scripts/smoke_test.py, which can also be pointed at any running server.
set -euo pipefail

cd "$(dirname "$0")/.."

PREFIX="lyvune-smoke-$$"
IMAGE=""
BUILD=1
KEEP=0
PLATFORM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --image) IMAGE="$2"; BUILD=0; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    --keep) KEEP=1; shift ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    -h | --help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

command -v docker > /dev/null || { echo "docker is required" >&2; exit 2; }
command -v python3 > /dev/null || { echo "python3 is required" >&2; exit 2; }

WORK="$(mktemp -d -t "$PREFIX-XXXXXX")"
BUILT_IMAGE=""
PLATFORM_ARGS=()
[ -n "$PLATFORM" ] && PLATFORM_ARGS=(--platform "$PLATFORM")
USER_ARGS=(--user "$(id -u):$(id -g)")
FAILED=0

# shellcheck disable=SC2329 # called by the trap
cleanup() {
  if [ "$KEEP" = 1 ]; then
    echo "kept: $WORK and the containers named $PREFIX-*"
    return
  fi
  docker ps -aq --filter "name=$PREFIX-" | xargs -r docker rm -f > /dev/null 2>&1 || true
  docker volume ls -q --filter "name=$PREFIX-" | xargs -r docker volume rm > /dev/null 2>&1 || true
  [ -n "$BUILT_IMAGE" ] && docker rmi "$BUILT_IMAGE" > /dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
ok() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILED=1; }
expect() { # description, command...
  local what="$1"; shift
  if "$@" > /dev/null 2>&1; then ok "$what"; else fail "$what"; fi
}

free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])'; }

# Starts a container and waits for Docker's own HEALTHCHECK to call it healthy.
# usage: start NAME DATA_DIR MUSIC_DIR ro|rw PORT [docker run options...]
start() {
  local name="$1" data="$2" music="$3" mode="$4" port="$5"; shift 5
  local mount="$music:/music"; [ "$mode" = ro ] && mount="$mount:ro"
  docker run -d --name "$PREFIX-$name" "${PLATFORM_ARGS[@]}" "${USER_ARGS[@]}" \
    -p "127.0.0.1:$port:4533" -v "$data:/data" -v "$mount" \
    --cap-drop ALL --security-opt no-new-privileges:true "$@" "$IMAGE" > /dev/null
  local i status
  for i in $(seq 1 90); do
    status="$(docker inspect -f '{{if .State.Running}}{{.State.Health.Status}}{{else}}exited{{end}}' "$PREFIX-$name")"
    case "$status" in
      healthy) printf 'healthy after about %ss\n' "$i"; return 0 ;;
      exited) echo "the container exited:"; docker logs "$PREFIX-$name" 2>&1 | tail -8; return 1 ;;
    esac
    sleep 1
  done
  echo "not healthy after 90 s (status: $status)"; docker logs "$PREFIX-$name" 2>&1 | tail -8
  return 1
}

smoke() { python3 scripts/smoke_test.py check "http://127.0.0.1:$1" "${@:2}"; }

if [ "$BUILD" = 1 ]; then
  IMAGE="lyvune:$PREFIX"
  BUILT_IMAGE="$IMAGE"
  step "Building the image ($IMAGE)"
  docker build "${PLATFORM_ARGS[@]}" -t "$IMAGE" .
fi
[ -n "$IMAGE" ] || IMAGE="lyvune:smoke"

step "Compose files"
export LYVUNE_MUSIC_DIR="$WORK/compose-music"
expect "compose.yaml is valid" docker compose -f compose.yaml config -q
expect "compose.yaml with the sidecars overlay is valid" docker compose -f compose.yaml -f compose.sidecars.yaml config -q
expect "compose.yaml refuses to start without LYVUNE_MUSIC_DIR" bash -c '! env -u LYVUNE_MUSIC_DIR docker compose -f compose.yaml config -q'
expect "the example environment file is complete" docker compose --env-file .env.example -f compose.yaml config -q

step "The image"
expect "it runs as an unprivileged user" bash -c "[ \"\$(docker run --rm ${PLATFORM_ARGS[*]} --entrypoint id $IMAGE -u)\" != 0 ]"
expect "it has the OCI labels" bash -c "docker image inspect -f '{{index .Config.Labels \"org.opencontainers.image.source\"}}' $IMAGE | grep -q github.com/Tian-MC/lyvune"
expect "the binary is there and reports a version" docker run --rm "${PLATFORM_ARGS[@]}" "$IMAGE" --version
expect "ffmpeg is there for transcoding" docker run --rm "${PLATFORM_ARGS[@]}" --entrypoint ffmpeg "$IMAGE" -version
expect "CA certificates are there for HTTPS" docker run --rm "${PLATFORM_ARGS[@]}" --entrypoint sh "$IMAGE" -c 'test -s /etc/ssl/certs/ca-certificates.crt'
expect "time zones are there" docker run --rm "${PLATFORM_ARGS[@]}" --entrypoint sh "$IMAGE" -c 'test -f /usr/share/zoneinfo/Europe/Rome'

step "New installation, writable library"
mkdir -p "$WORK/a/data" "$WORK/a/music"
python3 scripts/smoke_test.py library "$WORK/a/music"
PORT_A="$(free_port)"
if start a "$WORK/a/data" "$WORK/a/music" rw "$PORT_A"; then
  ok "the container is healthy (Docker's HEALTHCHECK)"
  smoke "$PORT_A" --sidecars rw --music-dir "$WORK/a/music" || FAILED=1
  expect "the log says the insights collector is disabled" bash -c "docker logs $PREFIX-a 2>&1 | grep -q 'Insight Collector is DISABLED'"
  expect "the database was created as lyvune.db" test -f "$WORK/a/data/lyvune.db"
else
  fail "the container did not become healthy"
fi

step "Restart: the users and the saved lyrics are still there"
docker restart "$PREFIX-a" > /dev/null
for _ in $(seq 1 90); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$PREFIX-a")" = healthy ] && break
  sleep 1
done
expect "it is healthy again" bash -c "[ \"\$(docker inspect -f '{{.State.Health.Status}}' $PREFIX-a)\" = healthy ]"
out="$(smoke "$PORT_A" --sidecars rw --music-dir "$WORK/a/music" || true)"
echo "$out" | tail -3
expect "the administrator from before signed in (nothing was created again)" grep -q 'administrator signed in' <<< "$out"

step "Clean shutdown on SIGTERM"
docker stop -t 30 "$PREFIX-a" > /dev/null
expect "it stopped with exit code 0" bash -c "[ \"\$(docker inspect -f '{{.State.ExitCode}}' $PREFIX-a)\" = 0 ]"
expect "it said goodbye" bash -c "docker logs $PREFIX-a 2>&1 | grep -q 'Lyvune stopped, bye'"

step "Read-only library"
mkdir -p "$WORK/b/data" "$WORK/b/music"
python3 scripts/smoke_test.py library "$WORK/b/music"
PORT_B="$(free_port)"
if start b "$WORK/b/data" "$WORK/b/music" ro "$PORT_B"; then
  smoke "$PORT_B" --sidecars ro --music-dir "$WORK/b/music" || FAILED=1
else
  fail "the read-only container did not become healthy"
fi

step "Migration from Navidrome (an existing navidrome.db and navidrome.toml, no lyvune.toml)"
mkdir -p "$WORK/c/data" "$WORK/c/music"
cp -r "$WORK/a/music/." "$WORK/c/music/"
cp "$WORK/a/data/lyvune.db" "$WORK/c/data/navidrome.db"
printf 'UIWelcomeMessage = "Welcome back from navidrome.toml"\n' > "$WORK/c/data/navidrome.toml"
PORT_C="$(free_port)"
if start c "$WORK/c/data" "$WORK/c/music" rw "$PORT_C"; then
  out="$(smoke "$PORT_C" --sidecars rw --music-dir "$WORK/c/music" || true)"
  expect "the administrator in the old database signed in" grep -q 'administrator signed in' <<< "$out"
  expect "navidrome.toml was read" bash -c "curl -fs http://127.0.0.1:$PORT_C/app/ | grep -q 'Welcome back from navidrome.toml'"
  expect "no lyvune.db was created next to navidrome.db" test ! -e "$WORK/c/data/lyvune.db"
else
  fail "the migrated container did not become healthy"
fi

step "A data folder the user cannot write to"
mkdir -p "$WORK/d/data" "$WORK/d/music"
chmod 555 "$WORK/d/data"
docker run -d --name "$PREFIX-d" "${PLATFORM_ARGS[@]}" "${USER_ARGS[@]}" -v "$WORK/d/data:/data" -v "$WORK/d/music:/music:ro" "$IMAGE" > /dev/null
sleep 6
expect "the container exits with an error instead of running without a database" bash -c "[ \"\$(docker inspect -f '{{.State.Running}}' $PREFIX-d)\" = false ] && [ \"\$(docker inspect -f '{{.State.ExitCode}}' $PREFIX-d)\" != 0 ]"
expect "the log says the database could not be opened" bash -c "docker logs $PREFIX-d 2>&1 | grep -q 'Database could not be opened'"
chmod 755 "$WORK/d/data"

echo
if [ "$FAILED" = 0 ]; then echo "All Docker checks passed."; else echo "Some Docker checks FAILED."; fi
exit "$FAILED"
