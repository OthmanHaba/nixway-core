package cmd

import (
	"fmt"
	"os"

	"github.com/othmanhaba/nixway-core/apps/cli/auth"
	"github.com/othmanhaba/nixway-core/apps/cli/client"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var rootCmd = &cobra.Command{
	Use:   "nxw",
	Short: "Nixway PaaS CLI",
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func getClient() *client.Client {
	token, _ := auth.GetToken()
	return client.New(viper.GetString("api_url"), token)
}

func init() {
	rootCmd.PersistentFlags().String("api-url", "http://localhost:8080", "API base URL")
	rootCmd.PersistentFlags().String("team", "", "team ID or slug")
	viper.BindPFlag("api_url", rootCmd.PersistentFlags().Lookup("api-url"))
	viper.BindPFlag("team", rootCmd.PersistentFlags().Lookup("team"))
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath("$HOME/.nixway")
	_ = viper.ReadInConfig()
}
