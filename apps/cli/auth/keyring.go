package auth

import "github.com/zalando/go-keyring"

const serviceName = "nixway-cli"

func StoreToken(token string) error {
	return keyring.Set(serviceName, "api_token", token)
}

func GetToken() (string, error) {
	return keyring.Get(serviceName, "api_token")
}

func DeleteToken() error {
	return keyring.Delete(serviceName, "api_token")
}
