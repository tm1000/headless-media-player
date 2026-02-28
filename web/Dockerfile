# Stage 1: Build React UI
FROM node:20-alpine AS ui-builder
WORKDIR /ui
COPY ui/package*.json ./
RUN npm install
COPY ui/ .
RUN npm run build

# Stage 2: Build Go binary
FROM golang:1.22-alpine AS go-builder
WORKDIR /build
COPY main.go .
RUN go mod init signage && go build -o signage-web .

# Stage 3: Final image
FROM alpine:latest
RUN apk add --no-cache ffmpeg
WORKDIR /opt/signage/web
COPY --from=go-builder /build/signage-web .
COPY --from=ui-builder /ui/dist ./static/
EXPOSE 8080
CMD ["./signage-web"]
