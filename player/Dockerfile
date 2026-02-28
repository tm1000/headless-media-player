FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    xserver-xorg \
    xserver-xorg-video-all \
    mpv \
    inotify-tools \
    x11-xserver-utils \
    x11-utils \
    socat \
    jq \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY xorg.conf /etc/X11/xorg.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
