# Windows Docker Desktop / WSL2 build diagnostics

## Identify the failing stage

`failed to fetch oauth token: Post "https://auth.docker.io/token": EOF` during `load metadata for docker.io/library/node:18-bookworm-slim` means Docker cannot finish the Docker Hub authentication/network exchange. Public image pulls also obtain a scoped bearer token. This happens before Dockerfile RUN commands and before Angular or Server compilation; changing the base image tag does not fix the network or proxy path. EOF alone does not identify which proxy, firewall or remote endpoint closed the connection.

The checked-in Dockerfile uses `node:18-bookworm` for both builders and `node:18-bookworm-slim` for the final runtime. `compose.dev.yml` builds it with `INSTALL_ODBC=false` and retains the existing `.local/fuxa-dev` mounts. The CI Docker job uses the same build argument on a GitHub-hosted Ubuntu runner, loads the manager/generator from the final image, and tests isolated SQLite restart persistence. CI Node.js 20 tests do not validate the local Docker Desktop network. `.dockerignore` now excludes nested `**/.angular` caches as well as the root cache: a local evaluation initially transferred 2.05 GB because `client/.angular` was not covered. This reduces unnecessary context transfer; it cannot fix token exchange EOF. Existing Docker `npm install` and SQLite source-install steps are unchanged; CI uses `npm ci` with the lockfiles.

## Read-only checks

Run from PowerShell. These checks do not stop containers, change Desktop settings, prune caches or remove images/volumes. Keep complete Docker info/configuration and proxy settings local: they may contain personal infrastructure or credentials.

```powershell
docker version --format '{{.Client.Version}} {{.Server.Version}}'
docker context show
wsl --status
wsl --list --verbose
docker compose -f compose.dev.yml config --quiet
docker image inspect node:18-bookworm --format '{{.Id}}'
docker image inspect node:18-bookworm-slim --format '{{.Id}}'
docker buildx du
Resolve-DnsName auth.docker.io
Resolve-DnsName registry-1.docker.io
Test-NetConnection auth.docker.io -Port 443
Test-NetConnection registry-1.docker.io -Port 443
curl.exe --silent --show-error --output NUL --write-out '%{http_code}' --connect-timeout 10 --max-time 20 'https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/node:pull'
curl.exe --silent --show-error --output NUL --write-out '%{http_code}' --connect-timeout 10 --max-time 20 'https://registry-1.docker.io/v2/'
```

The token probe normally returns HTTP 200; the unauthenticated registry probe normally returns HTTP 401 with an authentication challenge. Token contents are discarded. Host probes test the Windows path, not necessarily the Docker daemon or BuildKit path. An absent local image is a cache miss, not proof of a broken application. BuildKit may have cache records independently of `docker image inspect`.

Check Docker Desktop **Settings → Resources → Proxies** (or the Proxies settings page in your installed version). Confirm its system/manual proxy mode matches the intended environment. Shell `HTTP_PROXY` / `HTTPS_PROXY` settings do not necessarily configure the Desktop daemon. Check VPN, firewall, DNS and authenticated proxy access to Docker Hub's auth/registry/image-delivery endpoints. WSL2 and Windows can take different network paths. Do not publish proxy URLs, account names, passwords, bearer tokens or settings dumps. Do not disable TLS verification or add insecure registries as a workaround.

Inspect Desktop sign-in status locally. If credentials need renewal, use Desktop sign-in or interactive `docker login` separately; never embed credentials in repository files, command-line examples or Docker build arguments. An anonymous public pull should still reach the auth endpoint; login does not repair EOF caused by networking. Do not reset Desktop, stop WSL or change production settings during an application source task.

## Separate pull and isolated build

These actions download images and populate build cache; they do not start the development Compose service or attach its data. Run them separately to locate the failure:

```powershell
docker pull node:18-bookworm-slim
docker pull node:18-bookworm
docker build --progress=plain --build-arg INSTALL_ODBC=false -t nexfuxa-network-check .
docker run --rm --network none --entrypoint node nexfuxa-network-check -e "require('./api/plc-device-models/manager'); require('../tools/plc-device-model/generator.cjs'); console.log('runtime modules loaded')"
```

A successful cached build does not prove Docker Hub is reachable. A separate pull is the network check; `--pull` requests refreshed base metadata when deliberately testing connectivity. Do not use `--no-cache` or cache pruning as an authentication fix. Avoid `docker compose up` during diagnosis: it can recreate the operator's development container and use existing data. Never run `docker system prune`, `docker volume prune`, `docker compose down -v` or a Desktop factory reset for this problem.

## Node.js 22 evaluation

Node.js 18 is EOL; the current Docker tag is retained for this safety fix, not recommended as a long-term supported runtime. Angular 18.2's historical compatibility table allows Node.js `^22.0.0`; Angular 18 itself is now outside LTS. Node.js 20 used by the existing CI is also EOL as of this evaluation. A supported-runtime migration needs its own reviewed change; resolving Docker Hub EOF and changing Node.js are separate tasks.

Evaluate all stages together, using a temporary copy of the Dockerfile outside the repository with only its three Node tags changed to `22-bookworm` / `22-bookworm-slim`. Do not commit that copy as a networking fix. Run the complete model/Server/Client tests, production build, real Angular E2E, native-module load and isolated SQLite reopen checks before recommending migration.

| Component | Compatibility evidence / remaining gate |
| --- | --- |
| Angular 18.2 | Official Node.js 22 range; actual production build and browser E2E required |
| Server | Full suite and TypeScript build required on Node.js 22 |
| sqlite3 5.1.7 | Node-API v3/v6 bindings; test SQLite writes/reopen and Linux source rebuild in final image |
| SerialPort 12 / bindings-cpp 12.0.1 | Load native bindings on Windows and Linux; hardware communication remains unverified |
| ADS Client | Runtime plugin registry pins `ads-client` 2.1.0 outside the server lockfile; test exact-package loading, not a real PLC connection |
| Final image | Build all three Node.js 22 stages and load generator/manager, sqlite3 and SerialPort; check isolated restart |
| Optional integrations | ODBC-enabled image, optional Snap7 and other dynamically installed device plugins are outside `INSTALL_ODBC=false` CI; do not claim them validated |

Evaluation results are recorded with the PR. Passing the default image's tests does not certify optional drivers, real serial hardware or TwinCAT connectivity. Until the supported-runtime migration covers its intended deployment profile, keep the checked-in Dockerfile and CI runtime versions unchanged.

### Measured compatibility results (2026-10-14)

The official Node.js 22.23.3 Windows binary was downloaded to OS temporary storage and checked against the official SHA256 checksum. With the existing installed dependency versions, model tests passed 38/38, client tests passed 40/40 (5 script + 35 generator cases), production Angular build passed, and real Angular/API/temporary SQLite E2E passed all four viewports and the complete model/Apply/reuse flow. Server TypeScript build and sqlite3/SerialPort loading passed. The exact ADS plugin 2.1.0 was installed separately in OS temporary storage and loaded without making a PLC connection.

The Windows Node.js 22 full Server run did **not** pass: 307 passed and 2 failures were reported. The existing alarm migration test calls asynchronous `alarmstorage.close()` and immediately unlinks `alarms.fuxap.db`, causing `EBUSY`; its cleanup hook then reports a closed SQLite handle / duplicate completion. This identifies a close/unlink race rather than proving a Node.js 22 application incompatibility, but it is an unresolved full-suite gate. The current local Node.js 24 run passed all 309 tests after adding seven Restore regression cases; the standard Node.js 20 CI remains the release check.

The Node.js 22 Docker evaluation also reports client tooling `EBADENGINE` warnings for `eslint-plugin-jsdoc@39.5.0` and its `@es-joy/jsdoccomment` dependency, whose declared ranges omit Node.js 22. Build success does not validate that tooling. Together with the unresolved Windows full-suite race and untested optional driver profile, these prevent recommending an unconditional upgrade in this PR. No checked-in base image tags or CI Node versions were changed.

Docker Desktop's separate Node.js 18 slim pull succeeded during this investigation; the original EOF was not reproduced. Both the current Node.js 18 final image and the temporary Node.js 22 evaluation image built successfully with `INSTALL_ODBC=false`, loaded generator/manager plus sqlite3/SerialPort, initialized the real application and Generator API, and preserved custom model defaults and legacy/v2 configurations across isolated container reopen. Local Docker checks used new OS temporary bind directories and dedicated test containers, with no existing mounts or Docker volume cleanup. These are successful default-profile checks, not a replacement for the failed Node.js 22 full Server gate.

Sources: [Docker Desktop proxy settings](https://docs.docker.com/desktop/settings-and-maintenance/settings/), [Docker login](https://docs.docker.com/reference/cli/docker/login/), [Angular version compatibility](https://angular.dev/reference/versions), [Node.js release lifecycle](https://nodejs.org/en/about/previous-releases), [sqlite3 Node-API support](https://github.com/TryGhost/node-sqlite3).
