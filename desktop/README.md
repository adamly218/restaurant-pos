# POSR Desktop (Tauri 2 MVP)

Native shell around the existing Vite React app, plus a **print server sidecar** (`printing/server.js` on port `3132`).

## Prerequisites

1. **Rust** — [rustup](https://rustup.rs/) (`rustc` / `cargo` on `PATH`)
2. **Bun** — for Vite + this package’s Tauri CLI
3. **Node.js** — for the print sidecar (nvm or system `node`). Override with `NODE_BINARY=/path/to/node` if needed.
4. **Linux system libs** (Ubuntu/Debian) — preferred:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
  libgtk-3-dev libglib2.0-dev
```

If you cannot use `sudo`, this machine can use a user-local sysroot via [`env.sh`](env.sh) (auto-sourced by [`tauri.sh`](tauri.sh)).

5. Print deps once:

```bash
cd printing && npm install
```

Optional: `POSR_REPO_ROOT=/path/to/posr-react` if the app cannot find `printing/` next to the repo.

Copy env from the main checkout (needed for gateway login + print CORS/JWT):

```bash
cp /path/to/posr-react/.env.local .env.local && ln -sfn .env.local .env
```

## Dev

From repo root: stop Docker **`app`** if it binds **5173**. Keep **surrealdb** + **gateway** up for login.

**USB printing:** prefer the Docker **`printer`** service (runs as root with `/dev/bus/usb`) — same as before. Tauri skips its host sidecar when `:3132/health` is already up, or when `POSR_PRINT_SIDECAR=0`.

```bash
docker stop posr-react-app-1                         # free Vite port
docker compose up -d surrealdb gateway printer       # USB via Docker
bun run desktop:dev
```

Only stop `printer` if you intentionally want the host Node sidecar instead.

Or:

```bash
cd desktop && bun run dev
```

Success checks:

1. A native **POSR** window opens with the web UI (same as `bun run dev` in the browser).
2. Print health: `curl -s http://127.0.0.1:3132/health`
3. Closing the window stops the print child process.

The print sidecar is started with `GATEWAY_ALLOWED_ORIGINS` (from `.env.local` or a Vite/Tauri default allow-list) so browser CORS from `http://127.0.0.1:5173` works. It also loads `GATEWAY_JWT_SECRET` from `.env.local` when present so `/print` accepts the same session JWT as the gateway.

### Linux USB: Docker vs host sidecar

| How you run print | USB access |
|---|---|
| Docker `printer` | Root process + `/dev/bus/usb` mount — usually works (restart container if a claim gets stuck) |
| Host sidecar (Tauri) | Your user → often `LIBUSB_ERROR_ACCESS` because nodes are `root:lp` `0664` |

Restarting the print process clears a stuck libusb/usblp claim; that is separate from permission errors. Docker “just works” mainly because it is **root**, not because restart magic differs.

For Tauri MVP, keep using Docker `printer`. To force host sidecar later: stop the container and optionally `sudo usermod -aG lp "$USER"` then re-login.

Optional env:

- `NODE_BINARY` — Node executable for the print sidecar
- `POSR_REPO_ROOT` — repo root if `printing/` cannot be resolved automatically
- `POSR_PRINT_SIDECAR=0` — never spawn host print; use whatever is on `:3132` (Docker)
- `GATEWAY_ALLOWED_ORIGINS` / `GATEWAY_JWT_SECRET` — override values passed to the sidecar


## Windows (build & test on a Windows PC)

GUI bundles must be built **on Windows** (WebView2 / NSIS). Cross-compiling the installer from Linux is not supported for this MVP.

### Prerequisites

1. [Rust](https://rustup.rs/) (`stable-x86_64-pc-windows-msvc`) + **MSVC Build Tools** / Visual Studio C++ workload  
2. [Bun](https://bun.sh) and **Node.js** (for the print sidecar)  
3. WebView2 — usually already on Windows 10/11; the NSIS installer embeds the bootstrapper if missing  
4. From repo root:

```powershell
copy .env.example .env.local   # or copy your Linux .env.local
cd printing; npm install; cd ..
bun install
cd desktop; bun install; cd ..
```

### Dev

```powershell
# Point POSR_REPO_ROOT at this checkout if needed
$env:POSR_REPO_ROOT = (Resolve-Path .).Path
bun run desktop:dev
```

Or: `cd desktop; .\tauri.ps1 dev`

Print sidecar uses host Node + USB. For USB receipt printers, install [WinUSB via Zadig](https://zadig.akeo.ie/) for that device (see `printing/README.md`). Network/serial printers do not need Zadig.

### NSIS installer

```powershell
bun run desktop:build:windows
# same as: cd desktop; bun run build:windows
```

Config:

- [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) — shared Windows defaults (`embedBootstrapper`, NSIS `currentUser`)
- [`src-tauri/tauri.windows.conf.json`](src-tauri/tauri.windows.conf.json) — Windows-only merge (`targets: ["nsis"]`)

Artifact: `desktop/src-tauri/target/release/bundle/nsis/POSR_*_x64-setup.exe`

For a silent install smoke test: `.\POSR_0.1.0_x64-setup.exe /S`

## Production build (Linux)

```bash
bun run desktop:build
# or: cd desktop && bunx tauri build --bundles deb
```

Frontend packaging uses `vite build` (skips `tsc` — the repo currently has unrelated TS errors that would block `bun run build`).

Artifacts land under `desktop/src-tauri/target/release/bundle/` (e.g. `.deb` / AppImage on Linux; NSIS `.exe` on Windows).

The MVP does **not** yet bundle Node or `printing/node_modules` into the installer — release builds still expect Node + a reachable `printing/` tree (or `POSR_REPO_ROOT`).

## Out of scope (later)

- Bundled Node / Surreal / gateway / payment sidecars
- Windows code signing, macOS notarization, mobile
- System tray health UI
