#!/usr/bin/env bash
# Builds the Life Game Docker image and pushes it to GitHub Container Registry (GHCR).
#
#   ./deploy.sh                  tags: latest and the short git commit (e.g. 3fa21bc)
#   ./deploy.sh 1.2.0            also tags 1.2.0 and 1.2
#   DRY_RUN=1 ./deploy.sh        build only, push nothing
#   PLATFORMS=linux/amd64,linux/arm64 ./deploy.sh     a multi-architecture image
#
# Environment (all optional):
#   GHCR_OWNER   GitHub user or org that owns the image       (default: msvhora)
#   GHCR_TOKEN   token to log in with (see below); not needed if you already ran docker login
#   GHCR_USER    user name for that login                      (default: GHCR_OWNER)
#   PLATFORMS    target CPU architectures                      (default: linux/amd64, what most servers use)
#                Check yours with `uname -m` on the server: x86_64 = linux/amd64, aarch64 = linux/arm64.
#   ALLOW_DIRTY  set to 1 to build with uncommitted changes
#
# First time only: create a classic personal access token with the write:packages scope at
# https://github.com/settings/tokens and log in once:
#   echo "<token>" | docker login ghcr.io -u <github-user> --password-stdin
#
# On the server afterwards:  cd apps/life-game && docker compose pull && docker compose up -d
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

OWNER="${GHCR_OWNER:-msvhora}"
IMAGE="${IMAGE:-ghcr.io/${OWNER}/life-game}"
PLATFORMS="${PLATFORMS:-linux/amd64}"
VERSION="${1:-}"
DRY_RUN="${DRY_RUN:-0}"

command -v docker >/dev/null 2>&1 || { echo "Error: docker is not installed." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Error: Docker is not running." >&2; exit 1; }

if [ -n "${VERSION}" ] && ! [[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: version must look like 1.2.3 (got '${VERSION}')." >&2
    exit 1
fi

# Build only what is committed, so the image can always be traced back to a commit.
if [ -n "$(git status --porcelain)" ] && [ "${ALLOW_DIRTY:-0}" != "1" ]; then
    echo "Error: there are uncommitted changes. Commit them first, or run with ALLOW_DIRTY=1." >&2
    git status --short >&2
    exit 1
fi
SHA="$(git rev-parse --short=7 HEAD)"

echo "=========================================================="
echo " Life Game image"
echo "   image:     ${IMAGE}"
echo "   commit:    ${SHA}"
echo "   platforms: ${PLATFORMS}"
[ "${DRY_RUN}" = "1" ] && echo "   mode:      DRY RUN (nothing is pushed)"
echo "=========================================================="

# Never publish an image built from a tree that contains secrets or personal files.
bash scripts/check-secrets.sh --all
echo "Secret scan: clean"

TAGS=(-t "${IMAGE}:latest" -t "${IMAGE}:${SHA}")
if [ -n "${VERSION}" ]; then
    TAGS+=(-t "${IMAGE}:${VERSION}" -t "${IMAGE}:${VERSION%.*}")
fi

# Log in if a token was given.
if [ "${DRY_RUN}" != "1" ] && [ -n "${GHCR_TOKEN:-}" ]; then
    echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USER:-${OWNER}}" --password-stdin
fi

# Several architectures at once need a builder that supports it (Docker's default one does not).
BUILDER=()
if [[ "${PLATFORMS}" == *,* ]]; then
    if ! docker buildx inspect lifegame-builder >/dev/null 2>&1; then
        echo "Creating a buildx builder for multi-architecture images (downloads moby/buildkit once)..."
        docker buildx create --name lifegame-builder --driver docker-container >/dev/null
    fi
    BUILDER=(--builder lifegame-builder)
fi

OUTPUT=(--push)
[ "${DRY_RUN}" = "1" ] && OUTPUT=()

echo "Building..."
# (The ${ARR[@]+...} form keeps empty arrays working under `set -u` on the old bash that ships with macOS.)
if ! docker buildx build ${BUILDER[@]+"${BUILDER[@]}"} \
    --platform "${PLATFORMS}" \
    --provenance=false \
    --label "org.opencontainers.image.revision=${SHA}" \
    -f server/Dockerfile \
    "${TAGS[@]}" \
    ${OUTPUT[@]+"${OUTPUT[@]}"} \
    .; then
    echo "" >&2
    echo "Build or push failed." >&2
    echo "If it says 'denied' or 'unauthorized': log in with a token that has write:packages:" >&2
    echo "  echo \"<token>\" | docker login ghcr.io -u <github-user> --password-stdin" >&2
    exit 1
fi

echo "=========================================================="
if [ "${DRY_RUN}" = "1" ]; then
    echo " Dry run finished: the image builds. Nothing was pushed."
else
    echo " Pushed:"
    for t in "${TAGS[@]}"; do [ "${t}" = "-t" ] || echo "   ${t}"; done
    echo ""
    echo " Update the server:  cd apps/life-game && docker compose pull && docker compose up -d"
    echo " Pin this build:     LIFE_GAME_IMAGE_TAG=${SHA} in the server's .env"
    echo ""
    echo " First push? Open https://github.com/users/${OWNER}/packages and make the package Public,"
    echo " or run 'docker login ghcr.io' on the server with a read:packages token."
fi
echo "=========================================================="
