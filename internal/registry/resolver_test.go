package registry

import (
	"context"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/crypto"
	"github.com/othmanhaba/nixway-core/internal/db"
)

func TestResolve_DockerHub(t *testing.T) {
	key := [32]byte{1, 2, 3}
	teamID := uuid.New()
	enc, err := crypto.Encrypt([]byte("p4ss"), key, "registry:"+teamID.String())
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	r := NewResolver(key)
	auth, err := r.Resolve(context.Background(), db.RegistryCredential{
		RegistryType: "dockerhub",
		Username:     "alice",
		Password:     enc,
	}, teamID)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if auth.Server != "docker.io" {
		t.Errorf("server = %q, want docker.io", auth.Server)
	}
	if auth.Username != "alice" || auth.Password != "p4ss" {
		t.Errorf("creds = %q/%q", auth.Username, auth.Password)
	}
	if auth.TagPrefix != "alice/" {
		t.Errorf("prefix = %q, want alice/", auth.TagPrefix)
	}
}

func TestResolve_GHCR_LowercasesNamespace(t *testing.T) {
	key := [32]byte{4, 5, 6}
	teamID := uuid.New()
	enc, _ := crypto.Encrypt([]byte("ghp_xxx"), key, "registry:"+teamID.String())

	auth, err := NewResolver(key).Resolve(context.Background(), db.RegistryCredential{
		RegistryType: "ghcr",
		Username:     "OthmanHaba", // GHCR rejects mixed-case namespaces in image refs
		Password:     enc,
	}, teamID)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if auth.Server != "ghcr.io" {
		t.Errorf("server = %q", auth.Server)
	}
	if auth.TagPrefix != "ghcr.io/othmanhaba/" {
		t.Errorf("prefix = %q, want ghcr.io/othmanhaba/", auth.TagPrefix)
	}
}

func TestResolve_Generic_ExtractsHost(t *testing.T) {
	key := [32]byte{7, 8, 9}
	teamID := uuid.New()
	enc, _ := crypto.Encrypt([]byte("pw"), key, "registry:"+teamID.String())

	url := "https://registry.example.com/v2/"
	cases := []struct {
		name string
		url  string
	}{
		{"with-scheme", url},
		{"bare-host", "registry.example.com"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			auth, err := NewResolver(key).Resolve(context.Background(), db.RegistryCredential{
				RegistryType: "generic",
				RegistryUrl:  c.url,
				Username:     "u",
				Password:     enc,
			}, teamID)
			if err != nil {
				t.Fatalf("resolve: %v", err)
			}
			if auth.Server != "registry.example.com" {
				t.Errorf("server = %q", auth.Server)
			}
			if auth.TagPrefix != "registry.example.com/" {
				t.Errorf("prefix = %q", auth.TagPrefix)
			}
		})
	}
}

func TestResolve_UnsupportedType(t *testing.T) {
	_, err := NewResolver([32]byte{}).Resolve(context.Background(), db.RegistryCredential{
		RegistryType: "quay",
	}, uuid.New())
	if err == nil || !strings.Contains(err.Error(), "unsupported registry type") {
		t.Fatalf("want unsupported error, got %v", err)
	}
}

func TestDecodeECRToken(t *testing.T) {
	raw := "AWS:secret-token-here"
	encoded := base64.StdEncoding.EncodeToString([]byte(raw))
	user, pass, err := decodeECRToken(encoded)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if user != "AWS" || pass != "secret-token-here" {
		t.Errorf("got %q/%q", user, pass)
	}
}

func TestDecodeECRToken_Malformed(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString([]byte("noColonHere"))
	if _, _, err := decodeECRToken(encoded); err == nil {
		t.Error("expected error on malformed token")
	}
}

func TestRegistryHost(t *testing.T) {
	cases := map[string]string{
		"https://ghcr.io":              "ghcr.io",
		"ghcr.io":                      "ghcr.io",
		"https://reg.example.com/v2/":  "reg.example.com",
		"reg.example.com:5000":         "reg.example.com:5000",
		"https://reg.example.com:5000": "reg.example.com:5000",
	}
	for input, want := range cases {
		got, err := registryHost(input)
		if err != nil {
			t.Errorf("registryHost(%q) error: %v", input, err)
			continue
		}
		if got != want {
			t.Errorf("registryHost(%q) = %q, want %q", input, got, want)
		}
	}
}
