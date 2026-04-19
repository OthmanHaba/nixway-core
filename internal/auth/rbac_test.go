package auth

import (
	"testing"

	"github.com/othmanhaba/nixway-core/internal/model"
	"github.com/stretchr/testify/assert"
)

func TestRole_AtLeast(t *testing.T) {
	tests := []struct {
		role     model.Role
		required model.Role
		want     bool
	}{
		// owner >= everything
		{model.RoleOwner, model.RoleOwner, true},
		{model.RoleOwner, model.RoleAdmin, true},
		{model.RoleOwner, model.RoleMember, true},
		// admin >= admin and member, but not owner
		{model.RoleAdmin, model.RoleOwner, false},
		{model.RoleAdmin, model.RoleAdmin, true},
		{model.RoleAdmin, model.RoleMember, true},
		// member >= member only
		{model.RoleMember, model.RoleOwner, false},
		{model.RoleMember, model.RoleAdmin, false},
		{model.RoleMember, model.RoleMember, true},
	}
	for _, tc := range tests {
		t.Run(string(tc.role)+">="+string(tc.required), func(t *testing.T) {
			assert.Equal(t, tc.want, tc.role.AtLeast(tc.required))
		})
	}
}
