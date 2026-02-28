# Lightweight Linux Signage System

A minimal digital signage system for headless Linux machines with HDMI output. Replaces heavy CMS platforms with a simple Go web server, mpv player, and Xorg session — all managed by Docker Compose.

## Requirements

- Docker + Docker Compose
- A Linux host (bare metal or VM) with a GPU accessible at `/dev/dri`
- Port 80 available on the host

## Quick Start

```bash
git clone <repo>
cd player
make start
```

The web UI is available at `http://<host-ip>`.

## Makefile

```bash
make build    # Build Docker images
make start    # Build and start in background
make stop     # Stop containers
make nuke     # Stop + delete all videos, state, and thumbnails
```

## Web UI

Open `http://<host-ip>` in a browser.

- **Upload** — drag and drop video files onto the upload zone, or click to browse
- **Reorder** — drag the grip handle (`⠿`) on any file to change play order
- **Play now** — click the play button on any file to jump to it immediately
- **Download / Delete** — per-file actions on the right
- **Now Playing** — green status bar shows the current file and elapsed / total time

## Architecture

```
┌─────────────────────────────────────────────────┐
│ Docker Compose                                  │
│                                                 │
│  ┌──────────────┐        ┌───────────────────┐  │
│  │  web         │        │  player           │  │
│  │              │        │                   │  │
│  │  Go :8080    │◄──POST─┤  entrypoint.sh    │  │
│  │  React UI    │        │  Xorg + mpv       │  │
│  │  ffmpeg      │        │  socat/jq/curl    │  │
│  └──────┬───────┘        └───────────────────┘  │
│         │                                       │
│  ./videos  ./state  ./thumbnails  (bind mounts) │
└─────────────────────────────────────────────────┘
```

Two containers share a `./videos` bind mount:

- **web** — serves the React UI, handles uploads/deletes, generates thumbnails via ffmpeg, and maintains playback status in memory
- **player** — runs Xorg and mpv, polls mpv's IPC socket every second, POSTs status to the web container, and receives commands (play, reload) in the response

## Directory Layout

```
player/
├── docker-compose.yml
├── Makefile
├── videos/          ← uploaded video files (persists on host)
├── state/           ← playlist.json (persists on host)
├── thumbnails/      ← generated .jpg thumbnails (persists on host)
├── web/
│   ├── Dockerfile   ← 3-stage: Node (UI) → Go (binary) → Alpine + ffmpeg
│   ├── main.go
│   └── ui/          ← React + Vite + shadcn/ui + Tailwind
└── player/
    ├── Dockerfile   ← Debian + Xorg + mpv + socat + jq + curl
    ├── entrypoint.sh
    └── xorg.conf    ← forced 1920x1080 resolution
```

## API Reference

| Method | Endpoint               | Description                                           |
|--------|------------------------|-------------------------------------------------------|
| GET    | `/api/list`            | Ordered list of filenames (JSON)                      |
| GET    | `/api/playlist.m3u`    | Ordered playlist for mpv (text)                       |
| POST   | `/api/order`           | Save new file order (JSON array of filenames)         |
| POST   | `/api/upload`          | Upload a video file (multipart)                       |
| DELETE | `/api/delete/:name`    | Delete a video and its thumbnail                      |
| GET    | `/api/download/:name`  | Download a video file                                 |
| GET    | `/api/thumbnail/:name` | Serve a generated JPEG thumbnail                      |
| POST   | `/api/play/:name`      | Queue an immediate play command for mpv               |
| GET    | `/api/status`          | Current playback status (filename, elapsed, duration) |
| POST   | `/api/status`          | Player reports status; response may contain a command |

## Player ↔ Web Communication

The player container polls every second by POSTing to `/api/status`. The web server may include a command in the response:

```json
{ "command": "loadfile", "filename": "/opt/signage/videos/clip.mp4" }
{ "command": "reload" }
```

- `loadfile` — player sends the command directly to mpv via its Unix IPC socket
- `reload` — player kills mpv; the main loop restarts it with a fresh playlist fetched from `/api/playlist.m3u`

## Supported Video Formats

mpv supports all formats via its bundled ffmpeg libraries. Recommended: **H.264 MP4** for maximum compatibility and hardware acceleration.

## Display

Xorg is configured for **1920x1080** via `player/xorg.conf`. To change the resolution, update the `Modeline` and `Modes` values in that file and rebuild.

## Dual HDMI

To run independent content on two displays, create a second player service in `docker-compose.yml` targeting `:1` on VT3, with its own video volume.
