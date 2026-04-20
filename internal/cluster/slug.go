package cluster

import (
	"regexp"
	"strings"
)

var nonAlphaNum = regexp.MustCompile(`[^a-z0-9-]`)
var multiDash = regexp.MustCompile(`-+`)

// GenerateSlug converts a cluster name into a URL-safe slug.
func GenerateSlug(name string) string {
	slug := strings.ToLower(strings.TrimSpace(name))
	slug = nonAlphaNum.ReplaceAllString(slug, "-")
	slug = multiDash.ReplaceAllString(slug, "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		slug = "cluster"
	}
	if len(slug) > 63 {
		slug = slug[:63]
	}
	return slug
}

// ValidateSlug checks if a slug is valid for DNS usage.
func ValidateSlug(slug string) bool {
	if slug == "" || len(slug) > 63 {
		return false
	}
	matched, _ := regexp.MatchString(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`, slug)
	return matched
}
