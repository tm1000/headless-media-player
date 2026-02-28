package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
)

const videoDir = "/opt/signage/videos"
const stateFile = "/opt/signage/state/playlist.json"
const thumbDir = "/opt/signage/thumbnails"

var (
	statusMu      sync.Mutex
	currentStatus = []byte(`{"filename":null,"elapsed":0,"duration":0}`)
)

var (
	pendingMu  sync.Mutex
	pendingCmd []byte
)

var (
	orderMu   sync.Mutex
	fileOrder []string
)

type State struct {
	Order []string `json:"order"`
}

func loadOrder() []string {
	data, err := os.ReadFile(stateFile)
	if err != nil {
		return []string{}
	}
	var s State
	if err := json.Unmarshal(data, &s); err != nil {
		return []string{}
	}
	return s.Order
}

func saveOrder(order []string) {
	data, _ := json.MarshalIndent(State{Order: order}, "", "  ")
	os.WriteFile(stateFile, data, 0644)
}

func orderedFiles() []string {
	entries, _ := os.ReadDir(videoDir)
	onDisk := map[string]bool{}
	for _, e := range entries {
		if !e.IsDir() {
			onDisk[e.Name()] = true
		}
	}

	orderMu.Lock()
	order := append([]string{}, fileOrder...)
	orderMu.Unlock()

	result := []string{}
	seen := map[string]bool{}
	for _, f := range order {
		if onDisk[f] {
			result = append(result, f)
			seen[f] = true
		}
	}
	for _, e := range entries {
		if !e.IsDir() && !seen[e.Name()] {
			result = append(result, e.Name())
		}
	}
	return result
}

func generateThumbnail(name string) {
	exec.Command("ffmpeg",
		"-i", filepath.Join(videoDir, name),
		"-ss", "00:00:01",
		"-vframes", "1",
		"-q:v", "2",
		"-y", filepath.Join(thumbDir, name+".jpg"),
	).Run()
}

func listHandler(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(orderedFiles())
}

func playlistHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	for _, f := range orderedFiles() {
		fmt.Fprintf(w, "%s\n", filepath.Join(videoDir, f))
	}
}

func orderHandler(w http.ResponseWriter, r *http.Request) {
	var order []string
	if err := json.NewDecoder(r.Body).Decode(&order); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	orderMu.Lock()
	fileOrder = order
	orderMu.Unlock()
	saveOrder(order)

	pendingMu.Lock()
	pendingCmd = []byte(`{"command":"reload"}`)
	pendingMu.Unlock()

	w.Write([]byte("OK"))
}

func uploadHandler(w http.ResponseWriter, r *http.Request) {
	r.ParseMultipartForm(500 << 20)
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	defer file.Close()

	dst, err := os.Create(filepath.Join(videoDir, header.Filename))
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer dst.Close()
	io.Copy(dst, file)

	orderMu.Lock()
	found := false
	for _, f := range fileOrder {
		if f == header.Filename {
			found = true
			break
		}
	}
	if !found {
		fileOrder = append(fileOrder, header.Filename)
		snap := append([]string{}, fileOrder...)
		orderMu.Unlock()
		saveOrder(snap)
	} else {
		orderMu.Unlock()
	}

	go generateThumbnail(header.Filename)
	w.Write([]byte("OK"))
}

func deleteHandler(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.URL.Path[len("/api/delete/"):])
	if err := os.Remove(filepath.Join(videoDir, name)); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	os.Remove(filepath.Join(thumbDir, name+".jpg"))

	orderMu.Lock()
	newOrder := []string{}
	for _, f := range fileOrder {
		if f != name {
			newOrder = append(newOrder, f)
		}
	}
	fileOrder = newOrder
	orderMu.Unlock()
	saveOrder(newOrder)

	w.Write([]byte("OK"))
}

func thumbnailHandler(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.URL.Path[len("/api/thumbnail/"):])
	http.ServeFile(w, r, filepath.Join(thumbDir, name+".jpg"))
}

func playHandler(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.URL.Path[len("/api/play/"):])
	cmd, _ := json.Marshal(map[string]string{
		"command":  "loadfile",
		"filename": filepath.Join(videoDir, name),
	})
	pendingMu.Lock()
	pendingCmd = cmd
	pendingMu.Unlock()
	w.Write([]byte("OK"))
}

func statusHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodPost {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		statusMu.Lock()
		currentStatus = body
		statusMu.Unlock()

		pendingMu.Lock()
		cmd := pendingCmd
		pendingCmd = nil
		pendingMu.Unlock()

		if cmd != nil {
			w.Write(cmd)
		} else {
			w.Write([]byte("{}"))
		}
		return
	}
	statusMu.Lock()
	data := currentStatus
	statusMu.Unlock()
	w.Write(data)
}

func downloadHandler(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.URL.Path[len("/api/download/"):])
	http.ServeFile(w, r, filepath.Join(videoDir, name))
}

func main() {
	os.MkdirAll(videoDir, 0755)
	os.MkdirAll(filepath.Dir(stateFile), 0755)
	os.MkdirAll(thumbDir, 0755)

	orderMu.Lock()
	fileOrder = loadOrder()
	orderMu.Unlock()

	fs := http.FileServer(http.Dir("./static"))
	http.Handle("/", fs)

	http.HandleFunc("/api/list", listHandler)
	http.HandleFunc("/api/playlist.m3u", playlistHandler)
	http.HandleFunc("/api/order", orderHandler)
	http.HandleFunc("/api/thumbnail/", thumbnailHandler)
	http.HandleFunc("/api/play/", playHandler)
	http.HandleFunc("/api/status", statusHandler)
	http.HandleFunc("/api/upload", uploadHandler)
	http.HandleFunc("/api/delete/", deleteHandler)
	http.HandleFunc("/api/download/", downloadHandler)

	log.Println("Signage web UI running on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
