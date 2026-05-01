package registry

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// signedECRRequest builds an AWS SigV4-signed POST request for the ECR API.
// Used by both the validator (which discards the response) and the resolver
// (which parses the authorization token).
func signedECRRequest(ctx context.Context, region, accessKeyID, secretAccessKey, target, payload string) (*http.Request, error) {
	endpoint := fmt.Sprintf("https://ecr.%s.amazonaws.com/", region)

	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")

	headers := map[string]string{
		"content-type": "application/x-amz-json-1.1",
		"host":         fmt.Sprintf("ecr.%s.amazonaws.com", region),
		"x-amz-date":   amzDate,
		"x-amz-target": target,
	}

	canonicalHeaders := "" +
		"content-type:" + headers["content-type"] + "\n" +
		"host:" + headers["host"] + "\n" +
		"x-amz-date:" + headers["x-amz-date"] + "\n" +
		"x-amz-target:" + headers["x-amz-target"] + "\n"
	signedHeaders := "content-type;host;x-amz-date;x-amz-target"

	payloadHash := sha256Hex([]byte(payload))
	canonicalRequest := strings.Join([]string{
		"POST", "/", "", canonicalHeaders, signedHeaders, payloadHash,
	}, "\n")

	credentialScope := strings.Join([]string{dateStamp, region, "ecr", "aws4_request"}, "/")
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		credentialScope,
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")

	signingKey := deriveSigningKey(secretAccessKey, dateStamp, region, "ecr")
	signature := hex.EncodeToString(hmacSHA256(signingKey, []byte(stringToSign)))

	authHeader := fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		accessKeyID, credentialScope, signedHeaders, signature,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", headers["content-type"])
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Target", target)
	req.Header.Set("Authorization", authHeader)
	return req, nil
}

func sha256Hex(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

func hmacSHA256(key, data []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(data)
	return mac.Sum(nil)
}

func deriveSigningKey(secretKey, dateStamp, region, service string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secretKey), []byte(dateStamp))
	kRegion := hmacSHA256(kDate, []byte(region))
	kService := hmacSHA256(kRegion, []byte(service))
	kSigning := hmacSHA256(kService, []byte("aws4_request"))
	return kSigning
}
