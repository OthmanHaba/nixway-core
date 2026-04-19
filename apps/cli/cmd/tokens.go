package cmd

import (
	"fmt"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/othmanhaba/nixway-core/internal/model"
	"github.com/spf13/cobra"
)

var tokensCmd = &cobra.Command{
	Use:   "tokens",
	Short: "Manage API tokens",
}

var tokensCreateCmd = &cobra.Command{
	Use:   "create <team-id> <name>",
	Short: "Create a new API token for a team",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		teamID, name := args[0], args[1]
		body := map[string]string{"name": name}
		var result model.APITokenWithPlain
		path := fmt.Sprintf("/api/v1/teams/%s/tokens", teamID)
		if err := getClient().Post(path, body, &result); err != nil {
			return err
		}
		fmt.Printf("Token created: %s\nID:    %s\nToken: %s\n\nStore this token — it will not be shown again.\n",
			result.Name, result.ID, result.PlainToken)
		return nil
	},
}

var tokensListCmd = &cobra.Command{
	Use:   "list <team-id>",
	Short: "List API tokens for a team",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		var tokens []model.APIToken
		path := fmt.Sprintf("/api/v1/teams/%s/tokens", args[0])
		if err := getClient().Get(path, &tokens); err != nil {
			return err
		}
		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		fmt.Fprintln(w, "ID\tNAME\tSCOPES\tCREATED")
		for _, t := range tokens {
			fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", t.ID, t.Name, strings.Join(t.Scopes, ","), t.CreatedAt.Format("2006-01-02"))
		}
		return w.Flush()
	},
}

var tokensRevokeCmd = &cobra.Command{
	Use:   "revoke <team-id> <token-id>",
	Short: "Revoke an API token",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		teamID, tokenID := args[0], args[1]
		path := fmt.Sprintf("/api/v1/teams/%s/tokens/%s", teamID, tokenID)
		if err := getClient().Delete(path); err != nil {
			return err
		}
		fmt.Printf("Token %s revoked.\n", tokenID)
		return nil
	},
}

func init() {
	tokensCmd.AddCommand(tokensCreateCmd, tokensListCmd, tokensRevokeCmd)
	rootCmd.AddCommand(tokensCmd)
}
