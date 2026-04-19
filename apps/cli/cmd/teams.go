package cmd

import (
	"fmt"
	"os"
	"text/tabwriter"

	"github.com/othmanhaba/nixway-core/internal/model"
	"github.com/spf13/cobra"
)

var teamsCmd = &cobra.Command{
	Use:   "teams",
	Short: "Manage teams",
}

var teamsListCmd = &cobra.Command{
	Use:   "list",
	Short: "List teams",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		var teams []model.Team
		if err := getClient().Get("/api/v1/teams", &teams); err != nil {
			return err
		}
		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		fmt.Fprintln(w, "ID\tNAME\tSLUG\tCREATED")
		for _, t := range teams {
			fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", t.ID, t.Name, t.Slug, t.CreatedAt.Format("2006-01-02"))
		}
		return w.Flush()
	},
}

var teamsCreateCmd = &cobra.Command{
	Use:   "create <name>",
	Short: "Create a new team",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		body := map[string]string{"name": args[0]}
		var team model.Team
		if err := getClient().Post("/api/v1/teams", body, &team); err != nil {
			return err
		}
		fmt.Printf("Team created: %s (slug: %s, id: %s)\n", team.Name, team.Slug, team.ID)
		return nil
	},
}

var teamsMembersCmd = &cobra.Command{
	Use:   "members <team-id>",
	Short: "List members of a team",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		var members []model.TeamMember
		path := fmt.Sprintf("/api/v1/teams/%s/members", args[0])
		if err := getClient().Get(path, &members); err != nil {
			return err
		}
		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		fmt.Fprintln(w, "ID\tNAME\tEMAIL\tROLE\tJOINED")
		for _, m := range members {
			fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", m.ID, m.UserName, m.Email, m.Role, m.CreatedAt.Format("2006-01-02"))
		}
		return w.Flush()
	},
}

func init() {
	teamsCmd.AddCommand(teamsListCmd, teamsCreateCmd, teamsMembersCmd)
	rootCmd.AddCommand(teamsCmd)
}
