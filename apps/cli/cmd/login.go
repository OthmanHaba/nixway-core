package cmd

import (
	"fmt"

	"github.com/othmanhaba/nixway-core/apps/cli/auth"
	"github.com/spf13/cobra"
)

var loginCmd = &cobra.Command{
	Use:   "login <token>",
	Short: "Store an API token in the OS keyring",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		token := args[0]
		if err := auth.StoreToken(token); err != nil {
			return fmt.Errorf("failed to store token: %w", err)
		}
		fmt.Println("Token stored successfully.")
		return nil
	},
}

func init() {
	rootCmd.AddCommand(loginCmd)
}
