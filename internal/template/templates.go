package template

// builtinTemplates returns the static catalog of service templates that ship
// with the platform. To add or modify a template, edit this file directly --
// templates are not user-editable in v1.
func builtinTemplates() []Template {
	defaultResources := Resources{MilliCPU: 500, MemoryMB: 512}

	return []Template{
		{
			Slug:        "postgresql",
			Name:        "PostgreSQL",
			Category:    "database",
			Description: "PostgreSQL relational database",
			Versions: []Version{
				{Version: "14", Image: "postgres:14-alpine"},
				{Version: "15", Image: "postgres:15-alpine"},
				{Version: "16", Image: "postgres:16-alpine", Default: true},
				{Version: "17", Image: "postgres:17-alpine"},
			},
			DefaultResources: defaultResources,
			VolumeSpec:       VolumeSpec{MountPath: "/var/lib/postgresql/data", DefaultGiB: 10},
			Ports:            []int{5432},
			HealthCheck:      HealthCheck{Command: "pg_isready -U $POSTGRES_USER", Interval: 10, Timeout: 5, Retries: 5},
			ConnStringFmt:    "postgresql://{user}:{password}@{host}:{port}/{dbname}",
			// Container is initialized as the "postgres" superuser using
			// {root_password}. The app_user with {password} is created in a
			// post-init step (see apps/agent/deploy.go) so backups can keep
			// authenticating as the real superuser while apps use a scoped role.
			EnvTemplate: map[string]string{
				"POSTGRES_USER":     "{root_user}",
				"POSTGRES_PASSWORD": "{root_password}",
				"POSTGRES_DB":       "{dbname}",
				// initdb refuses to use the mount root because it contains
				// `lost+found`. Pointing PGDATA at a subdirectory follows the
				// official postgres-image recommendation for bind mounts.
				"PGDATA": "/var/lib/postgresql/data/pgdata",
			},
			CredentialPolicy: "generated",
			ShellCommand:     "psql",
		},
		{
			Slug:        "mysql",
			Name:        "MySQL",
			Category:    "database",
			Description: "MySQL relational database",
			Versions: []Version{
				{Version: "8.0", Image: "mysql:8.0", Default: true},
				{Version: "8.4", Image: "mysql:8.4"},
			},
			DefaultResources: defaultResources,
			VolumeSpec:       VolumeSpec{MountPath: "/var/lib/mysql", DefaultGiB: 10},
			Ports:            []int{3306},
			HealthCheck:      HealthCheck{Command: "mysqladmin ping -h localhost", Interval: 10, Timeout: 5, Retries: 5},
			ConnStringFmt:    "mysql://{user}:{password}@{host}:{port}/{dbname}",
			EnvTemplate: map[string]string{
				"MYSQL_ROOT_PASSWORD": "{root_password}",
				"MYSQL_USER":          "{user}",
				"MYSQL_PASSWORD":      "{password}",
				"MYSQL_DATABASE":      "{dbname}",
			},
			CredentialPolicy: "generated",
			ShellCommand:     "mysql",
		},
		{
			Slug:        "mongodb",
			Name:        "MongoDB",
			Category:    "database",
			Description: "MongoDB document database",
			Versions: []Version{
				{Version: "6", Image: "mongo:6"},
				{Version: "7", Image: "mongo:7", Default: true},
				{Version: "8", Image: "mongo:8"},
			},
			DefaultResources: defaultResources,
			VolumeSpec:       VolumeSpec{MountPath: "/data/db", DefaultGiB: 10},
			Ports:            []int{27017},
			HealthCheck:      HealthCheck{Command: "mongosh --quiet --eval 'db.adminCommand(\"ping\")' -u $MONGO_INITDB_ROOT_USERNAME -p $MONGO_INITDB_ROOT_PASSWORD --authenticationDatabase admin", Interval: 10, Timeout: 5, Retries: 5},
			ConnStringFmt:    "mongodb://{user}:{password}@{host}:{port}/{dbname}",
			// Container starts with the "admin" root user only. The app_user
			// is created post-init with readWrite on {dbname} (see deploy.go).
			EnvTemplate: map[string]string{
				"MONGO_INITDB_ROOT_USERNAME": "{root_user}",
				"MONGO_INITDB_ROOT_PASSWORD": "{root_password}",
				"MONGO_INITDB_DATABASE":      "{dbname}",
			},
			CredentialPolicy: "generated",
			ShellCommand:     "mongosh",
		},
		{
			Slug:        "redis",
			Name:        "Redis",
			Category:    "cache",
			Description: "Redis in-memory data store",
			Versions: []Version{
				{Version: "6", Image: "redis:6-alpine"},
				{Version: "7", Image: "redis:7-alpine", Default: true},
			},
			DefaultResources: defaultResources,
			VolumeSpec:       VolumeSpec{MountPath: "/data", DefaultGiB: 5},
			Ports:            []int{6379},
			HealthCheck:      HealthCheck{Command: "redis-cli -a $REDIS_PASSWORD --no-auth-warning ping", Interval: 10, Timeout: 5, Retries: 5},
			ConnStringFmt:    "redis://{user}:{password}@{host}:{port}/0",
			// requirepass = superPass: this becomes the password of Redis's
			// implicit "default" user (used by backup/admin tooling). A scoped
			// "app_user" ACL is added post-init with appPass for application
			// connections.
			EnvTemplate: map[string]string{
				"REDIS_PASSWORD": "{root_password}",
			},
			CredentialPolicy: "generated",
			ShellCommand:     "redis-cli",
			Command:          "redis-server --requirepass $REDIS_PASSWORD",
		},
		{
			Slug:        "rabbitmq",
			Name:        "RabbitMQ",
			Category:    "queue",
			Description: "RabbitMQ message broker (with management plugin)",
			Versions: []Version{
				{Version: "3.12", Image: "rabbitmq:3.12-management-alpine"},
				{Version: "3.13", Image: "rabbitmq:3.13-management-alpine", Default: true},
				{Version: "4.0", Image: "rabbitmq:4.0-management-alpine"},
			},
			DefaultResources: defaultResources,
			VolumeSpec:       VolumeSpec{MountPath: "/var/lib/rabbitmq", DefaultGiB: 10},
			Ports:            []int{5672, 15672},
			HealthCheck:      HealthCheck{Command: "rabbitmq-diagnostics check_running", Interval: 15, Timeout: 10, Retries: 5},
			ConnStringFmt:    "amqp://{user}:{password}@{host}:{port}/",
			// Default user is "admin" with superPass; the app_user is added
			// post-init with full permissions on the default vhost.
			EnvTemplate: map[string]string{
				"RABBITMQ_DEFAULT_USER": "{root_user}",
				"RABBITMQ_DEFAULT_PASS": "{root_password}",
			},
			CredentialPolicy: "generated",
			ShellCommand:     "rabbitmqctl",
		},
		{
			Slug:        "minio",
			Name:        "MinIO",
			Category:    "storage",
			Description: "MinIO S3-compatible object storage",
			Versions: []Version{
				{Version: "latest", Image: "minio/minio:latest", Default: true},
			},
			DefaultResources: defaultResources,
			VolumeSpec:       VolumeSpec{MountPath: "/data", DefaultGiB: 20},
			Ports:            []int{9000, 9001},
			HealthCheck:      HealthCheck{Command: "curl -f http://localhost:9000/minio/health/live", Interval: 15, Timeout: 5, Retries: 5},
			ConnStringFmt:    "http://{user}:{password}@{host}:{port}",
			EnvTemplate: map[string]string{
				"MINIO_ROOT_USER":     "{user}",
				"MINIO_ROOT_PASSWORD": "{password}",
			},
			CredentialPolicy: "generated",
			ShellCommand:     "mc",
			Command:          "server /data --console-address :9001",
		},
		{
			Slug:        "meilisearch",
			Name:        "Meilisearch",
			Category:    "search",
			Description: "Meilisearch full-text search engine",
			Versions: []Version{
				{Version: "1.10", Image: "getmeili/meilisearch:v1.10"},
				{Version: "1.11", Image: "getmeili/meilisearch:v1.11", Default: true},
				{Version: "1.12", Image: "getmeili/meilisearch:v1.12"},
			},
			DefaultResources: defaultResources,
			VolumeSpec:       VolumeSpec{MountPath: "/meili_data", DefaultGiB: 10},
			Ports:            []int{7700},
			HealthCheck:      HealthCheck{Command: "curl -f http://localhost:7700/health", Interval: 15, Timeout: 5, Retries: 5},
			ConnStringFmt:    "http://{host}:{port}",
			EnvTemplate: map[string]string{
				"MEILI_MASTER_KEY": "{password}",
				"MEILI_ENV":        "production",
			},
			CredentialPolicy: "generated",
			ShellCommand:     "sh",
		},
	}
}
