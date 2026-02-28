#!/bin/bash
set -euo pipefail

VIDEO_DIR="/opt/signage/videos"
MPV_SOCK="/tmp/mpv.sock"
WEB="http://web:8080"

# Clean up stale X lock files from previous runs (e.g. after host reboot)
rm -f /tmp/.X0-lock /tmp/.X11-unix/X0

# Start Xorg on display :0, VT2
Xorg :0 vt2 -nolisten tcp &

# Wait for X to be ready
sleep 3

export DISPLAY=:0
export XDG_RUNTIME_DIR=/tmp/runtime-root
mkdir -p "$XDG_RUNTIME_DIR"

# Background: poll mpv IPC every second, POST status to web, handle commands from response
while true; do
    if [ -S "$MPV_SOCK" ]; then
        FILENAME=$(echo '{"command":["get_property","filename"]}' \
            | socat -T1 - "UNIX-CONNECT:$MPV_SOCK" 2>/dev/null \
            | jq -r '.data // empty' 2>/dev/null || true)
        ELAPSED=$(echo '{"command":["get_property","time-pos"]}' \
            | socat -T1 - "UNIX-CONNECT:$MPV_SOCK" 2>/dev/null \
            | jq '.data // 0' 2>/dev/null || echo 0)
        DURATION=$(echo '{"command":["get_property","duration"]}' \
            | socat -T1 - "UNIX-CONNECT:$MPV_SOCK" 2>/dev/null \
            | jq '.data // 0' 2>/dev/null || echo 0)
        if [ -n "$FILENAME" ]; then
            RESPONSE=$(jq -n --arg f "$FILENAME" --argjson e "$ELAPSED" --argjson d "$DURATION" \
                '{"filename":$f,"elapsed":$e,"duration":$d}' \
                | curl -sf -X POST -H "Content-Type: application/json" -d @- "$WEB/api/status" 2>/dev/null || echo '{}')
        else
            RESPONSE=$(curl -sf -X POST -H "Content-Type: application/json" \
                -d '{"filename":null,"elapsed":0,"duration":0}' "$WEB/api/status" 2>/dev/null || echo '{}')
        fi
    else
        RESPONSE=$(curl -sf -X POST -H "Content-Type: application/json" \
            -d '{"filename":null,"elapsed":0,"duration":0}' "$WEB/api/status" 2>/dev/null || echo '{}')
    fi

    # Handle commands sent from the web server
    CMD=$(echo "$RESPONSE" | jq -r '.command // empty' 2>/dev/null || true)
    case "$CMD" in
        loadfile)
            FILE=$(echo "$RESPONSE" | jq -r '.filename // empty' 2>/dev/null || true)
            if [ -n "$FILE" ] && [ -S "$MPV_SOCK" ]; then
                echo "{\"command\":[\"loadfile\",\"$FILE\",\"replace\"]}" \
                    | socat -T1 - "UNIX-CONNECT:$MPV_SOCK" 2>/dev/null || true
            fi
            ;;
        reload)
            pkill -KILL mpv 2>/dev/null || true
            ;;
    esac

    sleep 1
done &

while true; do
    if [ -n "$(ls -A "$VIDEO_DIR" 2>/dev/null)" ]; then
        # Fetch ordered playlist from web server
        curl -sf "$WEB/api/playlist.m3u" -o /tmp/playlist.m3u 2>/dev/null || \
            find "$VIDEO_DIR" -maxdepth 1 -type f \
                \( -iname "*.mp4" -o -iname "*.mkv" -o -iname "*.avi" -o -iname "*.mov" \
                   -o -iname "*.webm" -o -iname "*.m4v" -o -iname "*.mpg" -o -iname "*.mpeg" \
                   -o -iname "*.ts" -o -iname "*.flv" -o -iname "*.wmv" -o -iname "*.ogv" \) \
                > /tmp/playlist.m3u 2>/dev/null || true

        if [ -s /tmp/playlist.m3u ]; then
            mpv \
                --fs \
                --loop-playlist \
                --no-osd-bar \
                --really-quiet \
                --vo=x11 \
                --hwdec=no \
                --input-ipc-server="$MPV_SOCK" \
                --playlist=/tmp/playlist.m3u &
            MPV_PID=$!

            inotifywait -e create,delete,move "$VIDEO_DIR" 2>/dev/null &
            WATCH_PID=$!

            wait -n $MPV_PID $WATCH_PID 2>/dev/null || true

            kill -KILL $MPV_PID 2>/dev/null || true
            kill $WATCH_PID 2>/dev/null || true
            wait $MPV_PID $WATCH_PID 2>/dev/null || true

            rm -f "$MPV_SOCK"
            xsetroot -solid black 2>/dev/null || true
        fi
    else
        xsetroot -solid black 2>/dev/null || true
        echo "No videos found, waiting..."
        inotifywait -e create,move "$VIDEO_DIR" 2>/dev/null || sleep 5
    fi
done
