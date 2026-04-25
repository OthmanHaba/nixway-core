package discovery

import (
	"os"
	"path/filepath"
)

type BuilderCandidate struct {
	Builder    string  `json:"builder"`
	Confidence float64 `json:"confidence"`
	Reason     string  `json:"reason"`
}

func Discover(repoPath string) ([]BuilderCandidate, error) {
	var candidates []BuilderCandidate

	if fileExists(repoPath, "Dockerfile") {
		candidates = append(candidates, BuilderCandidate{
			Builder: "dockerfile", Confidence: 1.0, Reason: "Dockerfile found at root",
		})
	}

	if fileExists(repoPath, "nixpacks.toml") {
		candidates = append(candidates, BuilderCandidate{
			Builder: "nixpacks", Confidence: 0.95, Reason: "nixpacks.toml found",
		})
	}

	if fileExists(repoPath, "Procfile") {
		candidates = append(candidates, BuilderCandidate{
			Builder: "buildpacks", Confidence: 0.85, Reason: "Procfile found",
		})
	}

	if fileExists(repoPath, "package.json") {
		candidates = append(candidates, BuilderCandidate{
			Builder: "nixpacks", Confidence: 0.7, Reason: "Node.js detected (package.json)",
		})
	}
	if fileExists(repoPath, "requirements.txt") || fileExists(repoPath, "pyproject.toml") {
		reason := "Python detected"
		if fileExists(repoPath, "requirements.txt") {
			reason += " (requirements.txt)"
		} else {
			reason += " (pyproject.toml)"
		}
		candidates = append(candidates, BuilderCandidate{
			Builder: "nixpacks", Confidence: 0.7, Reason: reason,
		})
	}
	if fileExists(repoPath, "go.mod") {
		candidates = append(candidates, BuilderCandidate{
			Builder: "nixpacks", Confidence: 0.7, Reason: "Go detected (go.mod)",
		})
	}
	if fileExists(repoPath, "Cargo.toml") {
		candidates = append(candidates, BuilderCandidate{
			Builder: "nixpacks", Confidence: 0.7, Reason: "Rust detected (Cargo.toml)",
		})
	}
	if fileExists(repoPath, "Gemfile") {
		candidates = append(candidates, BuilderCandidate{
			Builder: "buildpacks", Confidence: 0.7, Reason: "Ruby detected (Gemfile)",
		})
	}

	// Deduplicate: keep highest confidence per builder
	seen := make(map[string]int)
	var deduped []BuilderCandidate
	for _, c := range candidates {
		if idx, ok := seen[c.Builder]; ok {
			if c.Confidence > deduped[idx].Confidence {
				deduped[idx] = c
			}
		} else {
			seen[c.Builder] = len(deduped)
			deduped = append(deduped, c)
		}
	}

	return deduped, nil
}

func fileExists(dir, name string) bool {
	_, err := os.Stat(filepath.Join(dir, name))
	return err == nil
}
