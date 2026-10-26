# Node major used to build the UI: the one in .nvmrc, so the image and a local build agree
ARG NODE_VERSION=24

FROM --platform=$BUILDPLATFORM ghcr.io/crazy-max/osxcross:14.5-debian AS osxcross

########################################################################################################################
### Build xx (original image: tonistiigi/xx)
FROM --platform=$BUILDPLATFORM alpine:3.24 AS xx-build

# v1.9.0
ENV XX_VERSION=a5592eab7a57895e8d385394ff12241bc65ecd50

RUN apk add -U --no-cache git
RUN git clone https://github.com/tonistiigi/xx && \
    cd xx && \
    git checkout ${XX_VERSION} && \
    mkdir -p /out && \
    cp src/xx-* /out/

RUN cd /out && \
    ln -s xx-cc /out/xx-clang && \
    ln -s xx-cc /out/xx-clang++ && \
    ln -s xx-cc /out/xx-c++ && \
    ln -s xx-apt /out/xx-apt-get

# xx mimics the original tonistiigi/xx image
FROM scratch AS xx
COPY --from=xx-build /out/ /usr/bin/

########################################################################################################################
### Build Lyvune UI
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS ui
WORKDIR /app

# Install node dependencies
COPY ui/package.json ui/package-lock.json ./
COPY ui/bin/ ./bin/
RUN npm ci

# Build bundle. Without source maps: they are 31 of the 52 MB of the bundle, which the binary embeds, and
# nothing in a running server reads them
COPY ui/ ./
RUN npm run build -- --outDir=/build --sourcemap false

FROM scratch AS ui-bundle
COPY --from=ui /build /build

########################################################################################################################
### Build Lyvune binary for Docker image (dynamic musl, enables native libwebp via dlopen)
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build-alpine
COPY --from=xx / /

ARG TARGETPLATFORM

RUN apk add --no-cache clang lld file git
RUN xx-apk add --no-cache gcc musl-dev zlib-dev
RUN xx-verify --setup

WORKDIR /workspace

RUN --mount=type=bind,source=. \
    --mount=type=cache,target=/root/.cache \
    --mount=type=cache,target=/go/pkg/mod \
    go mod download

ARG GIT_SHA
ARG GIT_TAG

RUN --mount=type=bind,source=. \
    --mount=from=ui,source=/build,target=./ui/build,ro \
    --mount=type=cache,target=/root/.cache \
    --mount=type=cache,target=/go/pkg/mod <<EOT
    set -e
    xx-go --wrap
    export CGO_ENABLED=1
    BUILD_TAGS=$(./release/build-tags.sh)
    # -latomic is required on 32-bit arm (arm/v6, arm/v7) so SQLite's 64-bit atomics resolve.
    go build -tags="${BUILD_TAGS}" -ldflags="-w -s \
        -linkmode=external -extldflags '-latomic' \
        -X github.com/Tian-MC/lyvune/consts.gitSha=${GIT_SHA} \
        -X github.com/Tian-MC/lyvune/consts.gitTag=${GIT_TAG}" \
        -o /out/navidrome .
    # Fail the build if native libwebp (purego) leaked into a 32-bit binary (issue #5738).
    ./release/verify-binary.sh /out/navidrome
    # Fail the build if the binary is accidentally statically linked: dlopen (and
    # therefore native libwebp detection) only works with a dynamic interpreter.
    file /out/navidrome | grep -q "dynamically linked" || { echo "ERROR: /out/navidrome is not dynamically linked"; file /out/navidrome; exit 1; }
EOT

########################################################################################################################
### Build Lyvune binary for standalone distribution (static glibc, cross-compiled)
FROM --platform=$BUILDPLATFORM golang:1.27-trixie AS base
RUN apt-get update && apt-get install -y clang lld
COPY --from=xx / /
WORKDIR /workspace

FROM --platform=$BUILDPLATFORM base AS build

# Install build dependencies for the target platform
ARG TARGETPLATFORM

RUN xx-apt install -y binutils gcc g++ libc6-dev zlib1g-dev
RUN xx-verify --setup

RUN --mount=type=bind,source=. \
    --mount=type=cache,target=/root/.cache \
    --mount=type=cache,target=/go/pkg/mod \
    go mod download

ARG GIT_SHA
ARG GIT_TAG

RUN --mount=type=bind,source=. \
    --mount=from=ui,source=/build,target=./ui/build,ro \
    --mount=from=osxcross,src=/osxcross/SDK,target=/xx-sdk,ro \
    --mount=type=cache,target=/root/.cache \
    --mount=type=cache,target=/go/pkg/mod <<EOT
    set -e

    # Setup CGO cross-compilation environment
    xx-go --wrap
    export CGO_ENABLED=1
    cat "$(go env GOENV)" 2>/dev/null || true

    # Only Darwin (macOS) requires clang (default), Windows requires gcc, everything else can use any compiler.
    # So let's use gcc for everything except Darwin.
    if [ "$(xx-info os)" != "darwin" ]; then
        export CC=$(xx-info)-gcc
        export CXX=$(xx-info)-g++
        export LD_EXTRA="-extldflags '-static -latomic'"
    fi
    # GNU ld corrupts the R_ARM_IRELATIVE addends of libatomic's ifunc resolvers
    # (wrong address, Thumb bit lost) once .text outgrows the 16MB Thumb branch
    # range, making static arm binaries jump to garbage inside glibc's ifunc
    # resolution and crash before main() (issue #5738). Link 32-bit arm with LLD,
    # which emits correct addends.
    if [ "$(xx-info arch)" = "arm" ]; then
        export LD_EXTRA="-extldflags '-static -latomic -fuse-ld=lld'"
    fi
    if [ "$(xx-info os)" = "windows" ]; then
        export EXT=".exe"
    fi

    BUILD_TAGS=$(./release/build-tags.sh)
    go build -tags="${BUILD_TAGS}" -ldflags="${LD_EXTRA} -w -s \
        -X github.com/Tian-MC/lyvune/consts.gitSha=${GIT_SHA} \
        -X github.com/Tian-MC/lyvune/consts.gitTag=${GIT_TAG}" \
        -o /out/navidrome${EXT} .
    # Fail the build if native libwebp (purego) leaked into a 32-bit binary (issue #5738).
    ./release/verify-binary.sh /out/navidrome*
EOT

# Verify if the binary was built for the correct platform and it is statically linked
RUN xx-verify --static /out/navidrome*

FROM scratch AS binary
COPY --from=build /out /

########################################################################################################################
### Build no-op stubs for mpv's video-output libraries
# mpv links libEGL/libgbm for video output only; Lyvune drives it headless, for audio.
# Real mesa pulls in LLVM + gallium (+218MB uncompressed), so ship stubs it never calls.
FROM --platform=$BUILDPLATFORM alpine:3.24 AS mpv-stubs
COPY --from=xx / /
RUN apk add --no-cache clang lld binutils mesa-egl mesa-gbm
ARG TARGETPLATFORM
RUN xx-apk add --no-cache musl-dev
RUN <<EOT
    set -e
    mkdir -p /out
    for so in libEGL.so.1 libgbm.so.1; do
        readelf -sW /usr/lib/$so \
            | awk '$5 == "GLOBAL" && $7 != "UND" { print $8 }' \
            | sed 's/@.*//' \
            | grep -vE '^(_init|_fini|_edata|_end|__bss_start|_GLOBAL_OFFSET_TABLE_)$' \
            | sort -u \
            | awk '{ print "void " $1 "(void) {}" }' > /tmp/stub.c
        test -s /tmp/stub.c
        xx-clang -shared -nostdlib -fPIC -Wl,-soname,$so -o /out/$so /tmp/stub.c
        xx-verify /out/$so
    done
EOT

########################################################################################################################
### Build Final Image
FROM alpine:3.24 AS final

ARG GIT_SHA
ARG GIT_TAG
# The user the server runs as. A bind-mounted data folder has to be writable by it;
# `user:` in Compose (or --user) runs the image as any other id
ARG LYVUNE_UID=1000
ARG LYVUNE_GID=1000

LABEL org.opencontainers.image.title="Lyvune" \
      org.opencontainers.image.description="A self-hosted music server and streamer, with word-by-word karaoke lyrics" \
      org.opencontainers.image.url="https://github.com/Tian-MC/lyvune" \
      org.opencontainers.image.source="https://github.com/Tian-MC/lyvune" \
      org.opencontainers.image.documentation="https://github.com/Tian-MC/lyvune/blob/master/docs/DOCKER.md" \
      org.opencontainers.image.licenses="GPL-3.0" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${GIT_TAG}"

# Install runtime dependencies
# - ca-certificates: HTTPS to the lyrics and metadata providers
# - tzdata: TZ=Europe/Rome and the like; the binary does not embed time zones
# - ffmpeg: transcoding; mpv: the jukebox; sqlite: the shell `lyvune doctor` points to for recovery
# - libwebp + symlinks: enables native WebP encoding via purego/dlopen
# The mesa/LLVM stack mpv pulls in for video output is dropped in this same layer,
# otherwise the deleted bytes still ship in the image.
RUN apk add -U --no-cache ca-certificates tzdata ffmpeg mpv sqlite libwebp libwebpdemux libwebpmux && \
    for lib in libwebp libwebpdemux libwebpmux; do \
        target=$(ls /usr/lib/$lib.so.* 2>/dev/null | head -1) && \
        [ -n "$target" ] && ln -sf "$target" /usr/lib/$lib.so; \
    done && \
    rm -rf /usr/lib/gallium-pipe /usr/lib/dri \
        /usr/lib/libEGL.so* /usr/lib/libgbm.so* /usr/lib/libgallium*.so /usr/lib/libLLVM.so* \
        /usr/lib/libGL.so* /usr/lib/libGLESv2.so* /usr/lib/libglapi.so*

COPY --from=mpv-stubs /out/ /usr/lib/
RUN mpv --no-video --ao=null --version > /dev/null

# An unprivileged user, and a data folder it owns: a named volume mounted on /data starts with this
# ownership. /music is left alone (it is the user's library: nothing here changes its owner)
RUN addgroup -S -g "${LYVUNE_GID}" lyvune && \
    adduser -S -D -H -u "${LYVUNE_UID}" -G lyvune -s /sbin/nologin lyvune && \
    mkdir -p /data /music && chown lyvune:lyvune /data

# Copy the binary (musl build for Docker, enables native libwebp). The build stages keep
# calling it navidrome, which the release pipeline relies on; it is lyvune from here on
COPY --from=build-alpine /out/navidrome /app/lyvune

VOLUME ["/data", "/music"]
ENV ND_MUSICFOLDER=/music
ENV ND_DATAFOLDER=/data
# lyvune.toml first; a navidrome.toml beside it is read when there is no lyvune.toml
ENV ND_CONFIGFILE=/data/lyvune.toml
ENV ND_PORT=4533
# `lyvune backup create` writes here, inside the data volume. Without it backups would go to the working
# directory, which is neither writable by the server's user nor kept. Scheduled backups stay off until
# ND_BACKUP_SCHEDULE and ND_BACKUP_COUNT are set
ENV ND_BACKUP_PATH=/data/backups
RUN touch /.nddockerenv

EXPOSE ${ND_PORT}
WORKDIR /app
ENV PATH="/app:${PATH}"

USER lyvune:lyvune

# `lyvune healthcheck` asks the server's own /ping on the port, address and TLS it is configured with:
# no curl, wget or shell needed. The start period covers a first start, which migrates the database
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ["/app/lyvune", "healthcheck"]

STOPSIGNAL SIGTERM
ENTRYPOINT ["/app/lyvune"]
