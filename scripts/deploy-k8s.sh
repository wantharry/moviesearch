#!/usr/bin/env bash
# One-command build + push + deploy — runs entirely on your local machine.
# No SSH into any cluster node, no manual server login of any kind.
#
# Requirements (one-time):
#   - Docker Desktop running, with an arm64-capable buildx builder:
#       docker buildx create --name arm64builder --driver docker-container --use
#       docker run --privileged --rm tonistiigi/binfmt --install linux/arm64
#   - `docker login` already done locally (so `docker push` works)
#   - `kubectl` configured with a working context for the cluster
#     (kubectl talks directly to the cluster API at 132.145.144.201:6443,
#     no SSH involved)
#
# Usage: bash scripts/deploy-k8s.sh
set -euo pipefail

IMAGE="wantharry/moviesearch:latest"
NAMESPACE="apps"
DEPLOYMENT="moviesearch"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "==> 1/3 Building linux/arm64 image locally and pushing to Docker Hub..."
docker buildx build --builder arm64builder --platform linux/arm64 \
  --progress=plain --push -t "$IMAGE" .

echo "==> 2/3 Rolling out to Kubernetes..."
kubectl rollout restart deployment/"$DEPLOYMENT" -n "$NAMESPACE"
kubectl rollout status deployment/"$DEPLOYMENT" -n "$NAMESPACE" --timeout=180s

echo "==> 3/3 Verifying..."
kubectl get pods -n "$NAMESPACE" -l app="$DEPLOYMENT" -o wide
curl -sk https://moviesearch.132-145-144-201.sslip.io/api/health && echo

echo "Done."
