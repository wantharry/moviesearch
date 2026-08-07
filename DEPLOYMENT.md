# Kubernetes deployment

This app runs as a single-container Deployment on a self-hosted k3s cluster
(namespace `apps`, arm64 nodes: Oracle Ampere). Manifests live in the separate
`kubernetes` repo at `apps/moviesearch/` (`deployment.yaml`, `service.yaml`,
`ingress.yaml`).

Live URL: **https://moviesearch.132-145-144-201.sslip.io**

Everything below runs **entirely on your local machine** — no SSH into any
cluster node, no manual login to any server. `docker buildx` cross-compiles
the arm64 image locally via QEMU emulation, and `kubectl` talks directly to
the cluster's Kubernetes API (`https://132.145.144.201:6443`).

## One-time machine setup

1. **Docker Desktop** installed and running.
2. **An arm64-capable buildx builder** (only needs to be created once per
   machine — it persists across reboots as a Docker Desktop container):

   ```bash
   docker buildx create --name arm64builder --driver docker-container --use
   docker run --privileged --rm tonistiigi/binfmt --install linux/arm64
   ```

   Verify it's there any time with `docker buildx ls` / `docker buildx inspect arm64builder`.
   If Docker Desktop is ever fully reset/reinstalled, just re-run the two
   commands above.
3. **`docker login`** done once, so `docker push` can authenticate to Docker Hub.
4. **`kubectl`** installed and pointed at the cluster's kubeconfig
   (`kubectl config current-context` should show a context whose
   `cluster-info` resolves to `https://132.145.144.201:6443`).

## Redeploying after any code or dataset change

**One command:**

```bash
bash scripts/deploy-k8s.sh
```

This does everything:
1. `docker buildx build --builder arm64builder --platform linux/arm64 --push`
   — builds the image for arm64 (via QEMU emulation) directly from your
   working directory and pushes it straight to `wantharry/moviesearch:latest`
   on Docker Hub. No intermediate save/scp/load step needed.
2. `kubectl rollout restart deployment/moviesearch -n apps` — tells the
   cluster to pull the new image and replace the running pod.
3. `kubectl rollout status ...` — waits until the new pod is `Ready`.
4. Prints `kubectl get pods` and hits `/api/health` to confirm it's live.

### Doing it by hand (what the script does, step by step)

```bash
# 1. Build + push (from the project root)
docker buildx build --builder arm64builder --platform linux/arm64 \
  --progress=plain --push -t wantharry/moviesearch:latest .

# 2. Roll out the new image
kubectl rollout restart deployment/moviesearch -n apps
kubectl rollout status deployment/moviesearch -n apps --timeout=180s

# 3. Verify
kubectl get pods -n apps -l app=moviesearch
curl -sk https://moviesearch.132-145-144-201.sslip.io/api/health
```

### If you only changed `deployment.yaml` / `service.yaml` / `ingress.yaml`

No image rebuild needed — just re-apply the manifest from the `kubernetes` repo:

```bash
kubectl apply -f apps/moviesearch/
```

## Requirements baked into the Dockerfile — don't break these

- Base image must be **`node:22-slim` or newer** — `better-sqlite3` declares
  `engines: { node: ">=22" }`. Using an older Node base silently produces a
  container that segfaults (exit code 139) the instant it tries to open
  `data/movies.db`, with **no log output at all** (it's a native crash, not a
  catchable JS exception — it happens before any JS runs). If you ever see
  `npm warn EBADENGINE` during `npm ci`/`npm install` for a native-addon
  dependency, treat it as a hard build failure, not a warning to ignore.
- The Dockerfile bakes `data/movies.db` directly into the image (no volume),
  so a rebuild is required whenever the dataset changes, not just the code.
- Runs as the built-in `node` user (non-root). The Kubernetes
  `securityContext` therefore needs `runAsNonRoot: true` **and**
  `runAsUser: 1000` (a numeric UID — Kubernetes can't verify a non-numeric
  `USER` against `runAsNonRoot` on its own). This is already set correctly in
  `deployment.yaml`; don't remove it if you ever rewrite that file.

## Troubleshooting

- **`CreateContainerConfigError` mentioning "non-numeric user"**: the
  `securityContext.runAsUser: 1000` field is missing from `deployment.yaml`.
- **Pod crashes immediately with `CrashLoopBackOff` / exit code 139, no logs**:
  almost certainly the Node-version-vs-`better-sqlite3` issue above — check
  the Dockerfile's `FROM` line and the `npm ci` output for `EBADENGINE`.
- **`docker load`/`docker push` fails with `failed to connect to the docker
  API at npipe:////./pipe/dockerDesktopLinuxEngine`**: Docker Desktop isn't
  running — start it and wait for `docker info` to succeed before retrying.
- **`docker buildx build --platform linux/arm64` fails to even start
  emulation**: re-run the one-time `tonistiigi/binfmt --install linux/arm64`
  step above.

## One-time cluster setup (already done — for reference only)

```bash
kubectl create secret generic moviesearch-secrets \
  --from-literal=TMDB_API_KEY='<your TMDb key>' \
  -n apps
kubectl apply -f apps/moviesearch/   # from the kubernetes repo
```
