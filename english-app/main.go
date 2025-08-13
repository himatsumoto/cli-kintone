package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

//go:embed web/*
var embeddedContent embed.FS

type VocabEntry struct {
	ID        string   `json:"id"`
	Category  string   `json:"category"`
	Level     string   `json:"level,omitempty"`
	Tags      []string `json:"tags,omitempty"`
	En        string   `json:"en"`
	Ja        string   `json:"ja"`
	IPA       string   `json:"ipa,omitempty"`
	ExampleEn string   `json:"example_en,omitempty"`
	ExampleJa string   `json:"example_ja,omitempty"`
}

type errorResponse struct {
	Error string `json:"error"`
}

type okResponse struct {
	OK bool `json:"ok"`
}

func main() {
	addr := getenvDefault("PORT", "8080")
	host := flag.String("host", "0.0.0.0", "host to bind")
	flag.Parse()

	staticFS, err := fs.Sub(embeddedContent, "web")
	if err != nil {
		log.Fatalf("failed to prepare embedded FS: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, okResponse{OK: true})
	})
	mux.Handle("/api/v1/vocab", http.HandlerFunc(handleVocab))

	// Static file server
	fileServer := http.FileServer(http.FS(staticFS))
	mux.Handle("/", withSecurityHeaders(logRequests(fileServer)))

	srv := &http.Server{
		Addr:              fmt.Sprintf("%s:%s", *host, addr),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
	}

	log.Printf("Server listening on http://%s:%s", *host, addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

func handleVocab(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse{Error: "method not allowed"})
		return
	}

	payload, err := embeddedContent.ReadFile("web/data/vocab.json")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "failed to read vocab data"})
		return
	}
	var items []VocabEntry
	if err := json.Unmarshal(payload, &items); err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "failed to parse vocab data"})
		return
	}

	// Filters
	categoriesParam := strings.TrimSpace(r.URL.Query().Get("category"))
	levelsParam := strings.TrimSpace(r.URL.Query().Get("level"))
	limitParam := strings.TrimSpace(r.URL.Query().Get("limit"))
	shuffleParam := strings.TrimSpace(r.URL.Query().Get("shuffle"))

	var categorySet map[string]struct{}
	if categoriesParam != "" && categoriesParam != "all" {
		categorySet = make(map[string]struct{})
		for _, c := range strings.Split(categoriesParam, ",") {
			c = strings.TrimSpace(c)
			if c != "" {
				categorySet[c] = struct{}{}
			}
		}
	}

	var levelSet map[string]struct{}
	if levelsParam != "" {
		levelSet = make(map[string]struct{})
		for _, lv := range strings.Split(levelsParam, ",") {
			lv = strings.ToUpper(strings.TrimSpace(lv))
			if lv != "" {
				levelSet[lv] = struct{}{}
			}
		}
	}

	filtered := make([]VocabEntry, 0, len(items))
	for _, it := range items {
		if categorySet != nil {
			if _, ok := categorySet[it.Category]; !ok {
				continue
			}
		}
		if levelSet != nil {
			if _, ok := levelSet[strings.ToUpper(it.Level)]; !ok {
				continue
			}
		}
		filtered = append(filtered, it)
	}

	// Optional: shuffle
	if strings.EqualFold(shuffleParam, "true") {
		r := rand.New(rand.NewSource(time.Now().UnixNano()))
		r.Shuffle(len(filtered), func(i, j int) { filtered[i], filtered[j] = filtered[j], filtered[i] })
	}

	// Optional: limit
	if limitParam != "" {
		if n, err := strconv.Atoi(limitParam); err == nil && n >= 0 && n < len(filtered) {
			filtered = filtered[:n]
		}
	}

	// Also expose categories and levels for UI convenience
	categories := make(map[string]int)
	levels := make(map[string]int)
	for _, it := range items {
		categories[it.Category]++
		if it.Level != "" {
			levels[strings.ToUpper(it.Level)]++
		}
	}
	categoryList := make([]string, 0, len(categories))
	for k := range categories {
		categoryList = append(categoryList, k)
	}
	sort.Strings(categoryList)
	levelList := make([]string, 0, len(levels))
	for k := range levels {
		levelList = append(levelList, k)
	}
	sort.Strings(levelList)

	resp := map[string]any{
		"items":      filtered,
		"categories": categoryList,
		"levels":     levelList,
	}
	writeJSON(w, http.StatusOK, resp)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	// Basic security headers
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

func withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Content Security Policy allows self resources and inline styles for simplicity
		csp := strings.Join([]string{
			"default-src 'self'",
			"script-src 'self' 'unsafe-inline'",
			"style-src 'self' 'unsafe-inline'",
			"img-src 'self' data:",
			"font-src 'self' data:",
			"connect-src 'self'",
			"object-src 'none'",
			"base-uri 'self'",
			"frame-ancestors 'none'",
		}, "; ")
		w.Header().Set("Content-Security-Policy", csp)
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

func getenvDefault(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}