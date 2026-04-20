package dns

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildRecords(t *testing.T) {
	members := []MemberDNSInfo{
		{ServerName: "web-1", WireGuardIP: "10.100.0.1"},
		{ServerName: "db-1", WireGuardIP: "10.100.0.2"},
	}

	records := BuildRecords("prod-us", members)
	require.Len(t, records, 2)
	assert.Equal(t, "web-1.prod-us.internal", records[0].Hostname)
	assert.Equal(t, "10.100.0.1", records[0].IP)
	assert.Equal(t, "db-1.prod-us.internal", records[1].Hostname)
	assert.Equal(t, "10.100.0.2", records[1].IP)
}

func TestGenerateHostsFile(t *testing.T) {
	records := []Record{
		{Hostname: "web-1.prod.internal", IP: "10.100.0.1"},
		{Hostname: "db-1.prod.internal", IP: "10.100.0.2"},
	}

	hosts := GenerateHostsFile(records)
	assert.Contains(t, hosts, "10.100.0.1\tweb-1.prod.internal")
	assert.Contains(t, hosts, "10.100.0.2\tdb-1.prod.internal")
}

func TestGenerateCorefile(t *testing.T) {
	corefile := GenerateCorefile("my-cluster")
	assert.Contains(t, corefile, "my-cluster.internal")
	assert.Contains(t, corefile, "hosts /etc/coredns/hosts")
	assert.Contains(t, corefile, "forward . 8.8.8.8 1.1.1.1")
}

func TestGetCoreDNSScript(t *testing.T) {
	script, err := GetCoreDNSScript()
	require.NoError(t, err)
	assert.Contains(t, string(script), "#!/bin/bash")
	assert.Contains(t, string(script), "coredns")
}
