package template

import "testing"

func TestRegistryList(t *testing.T) {
	r := NewRegistry()
	got := r.List()
	if len(got) != 7 {
		t.Fatalf("expected 7 templates, got %d", len(got))
	}
}

func TestRegistryGetPostgreSQL(t *testing.T) {
	r := NewRegistry()
	tmpl, ok := r.Get("postgresql")
	if !ok {
		t.Fatal("expected postgresql template to exist")
	}
	if tmpl.Slug != "postgresql" {
		t.Fatalf("expected slug postgresql, got %s", tmpl.Slug)
	}
	wantVersions := []string{"14", "15", "16", "17"}
	if len(tmpl.Versions) != len(wantVersions) {
		t.Fatalf("expected %d versions, got %d", len(wantVersions), len(tmpl.Versions))
	}
	for i, want := range wantVersions {
		if tmpl.Versions[i].Version != want {
			t.Errorf("version[%d] = %q, want %q", i, tmpl.Versions[i].Version, want)
		}
	}
}

func TestRegistryGetVersion(t *testing.T) {
	r := NewRegistry()
	v, err := r.GetVersion("postgresql", "16")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if v.Version != "16" {
		t.Errorf("expected version 16, got %s", v.Version)
	}
	if v.Image != "postgres:16-alpine" {
		t.Errorf("expected image postgres:16-alpine, got %s", v.Image)
	}
}

func TestRegistryGetUnknownSlug(t *testing.T) {
	r := NewRegistry()
	if _, ok := r.Get("does-not-exist"); ok {
		t.Error("expected Get to return false for unknown slug")
	}
	if _, err := r.GetVersion("does-not-exist", "1"); err == nil {
		t.Error("expected GetVersion to error for unknown slug")
	}
	if _, err := r.GetVersion("postgresql", "99"); err == nil {
		t.Error("expected GetVersion to error for unknown version")
	}
}

func TestRegistryAllTemplatesValid(t *testing.T) {
	r := NewRegistry()
	for _, tmpl := range r.List() {
		if tmpl.Slug == "" {
			t.Errorf("template has empty slug: %+v", tmpl)
		}
		if len(tmpl.Versions) == 0 {
			t.Errorf("template %s has no versions", tmpl.Slug)
		}
		if len(tmpl.Ports) == 0 {
			t.Errorf("template %s has no ports", tmpl.Slug)
		}
		if tmpl.VolumeSpec.MountPath == "" {
			t.Errorf("template %s has no volume mount path", tmpl.Slug)
		}
		if tmpl.CredentialPolicy != "generated" {
			t.Errorf("template %s has unexpected credential policy: %s", tmpl.Slug, tmpl.CredentialPolicy)
		}
	}
}
