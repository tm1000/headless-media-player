# Agent Guidelines — Lightweight Linux Signage System

This file provides context for AI coding assistants working on this codebase.

## Project Overview

A Docker Compose-based digital signage system. Two containers:

- **web** — Go HTTP server + React/Vite/shadcn/Tailwind frontend
- **player** — Bash entrypoint running Xorg + mpv on a dedicated VT

Videos are stored on bind-mounted host directories shared between containers.

## Key Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Defines web + player services and bind mounts |
| `Makefile` | `build`, `start`, `stop`, `nuke` targets |
| `web/main.go` | Go backend — all API handlers, in-memory state |
| `web/Dockerfile` | 3-stage build: Node (Vite) → Go → Alpine + ffmpeg |
| `web/ui/src/App.tsx` | Single React component — all UI logic |
| `web/ui/src/components/ui/` | shadcn Button and Card components (hand-written, no CLI) |
| `player/entrypoint.sh` | Starts Xorg, mpv, status poller, inotify watcher |
| `player/Dockerfile` | Debian + Xorg + mpv + socat + jq + curl |
| `player/xorg.conf` | Forces 1920x1080 — edit here to change resolution |

## Architecture Decisions

### No shared filesystem for IPC
The mpv Unix socket lives at `/tmp/mpv.sock` inside the player container only. The web container cannot access it. All communication is over HTTP:

- Player POSTs status to `http://web:8080/api/status` every second
- Web server returns a pending command in the POST response (if any)
- Commands: `loadfile` (play specific file) or `reload` (restart mpv with fresh playlist)

### In-memory state
Playback status and pending commands are held in Go memory (`sync.Mutex`-protected variables). They are not written to disk. Only `playlist.json` (file order) is persisted.

### Playlist ordering
`/api/list` and `/api/playlist.m3u` return files in user-defined order. Order is stored in `state/playlist.json` and loaded at web server startup. Files on disk that are not in the saved order are appended at the end.

### Thumbnail generation
ffmpeg runs asynchronously (`go generateThumbnail(...)`) after each upload. Thumbnails are stored in `./thumbnails/<filename>.jpg`. The React UI retries failed thumbnail image loads every 2 seconds using a `thumbErrors` state set.

### Player loop
The player entrypoint runs a `while true` loop:
1. Fetches `/api/playlist.m3u` from the web container
2. Starts mpv with `--playlist=/tmp/playlist.m3u` and `--input-ipc-server=/tmp/mpv.sock`
3. Simultaneously watches for filesystem changes with `inotifywait`
4. Uses `wait -n` (bash 5.1+) to block until either mpv exits or a file change occurs
5. Kills both processes, clears screen with `xsetroot`, loops

File deletion triggers the inotify watcher, which unblocks `wait -n` and kills mpv immediately.

## Conventions

### Go (`web/main.go`)
- All state is global with `sync.Mutex` — keep handlers simple and stateless otherwise
- File path sanitisation uses `filepath.Base()` on all URL-derived names to prevent path traversal
- Thumbnail generation errors are silently ignored (best-effort)
- New API endpoints go in `main.go`; register them in `main()`

### React (`web/ui/src/App.tsx`)
- Single component — keep it that way unless complexity justifies splitting
- shadcn components are hand-written in `src/components/ui/` — do not run `npx shadcn` (no lockfile tooling in this workflow)
- Tailwind classes only — no custom CSS
- Status polling uses `setInterval` in a `useEffect` with cleanup
- Drag and drop for reordering uses native HTML5 drag API, not a library

### Player (`player/entrypoint.sh`)
- `set -euo pipefail` is set — all fallible commands that should not abort the script must have `|| true`
- socat queries to the mpv IPC socket use `echo` (not `printf`) to ensure trailing newline
- The status poller runs as a background subshell — it does not have access to `$MPV_PID` from the main loop; use `pkill mpv` for reload commands
- `wait -n` requires bash 5.1+ — Debian bookworm ships bash 5.2

## Adding a New API Endpoint

1. Add a handler function to `web/main.go`
2. Register it in `main()` with `http.HandleFunc`
3. If it needs to send a command to mpv, set `pendingCmd` inside a `pendingMu.Lock()` block — the player will receive it on the next status POST response
4. If the command requires player-side logic, add a `case` to the `CMD` switch in `player/entrypoint.sh`

## Adding a New UI Feature

1. Edit `web/ui/src/App.tsx`
2. Add new shadcn components to `web/ui/src/components/ui/` if needed (copy the pattern from `button.tsx`)
3. Run `cd web/ui && npm run dev` for local development — the Vite dev server proxies `/api/*` to `localhost:8080`

## Environment Notes

- Tested on Linux aarch64 (Apple Silicon via VMware Fusion) and intended for x86_64 NUC hardware
- On VMware, `--vo=x11 --hwdec=no` is set in mpv flags due to missing GPU auth; remove these for production NUC hardware to enable hardware acceleration
- Resolution is hardcoded to 1920x1080 in `player/xorg.conf`
- The player container runs `privileged: true` for Xorg VT access

## Volumes

| Host path | Container | Purpose |
|-----------|-----------|---------|
| `./videos` | web + player `/opt/signage/videos` | Video files |
| `./state` | web `/opt/signage/state` | `playlist.json` |
| `./thumbnails` | web `/opt/signage/thumbnails` | JPEG thumbnails |
