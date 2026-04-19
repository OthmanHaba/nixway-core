package integration

import (
	"context"
	"testing"
	"time"

	"github.com/othmanhaba/nixway-core/internal/email"
	"github.com/othmanhaba/nixway-core/internal/job"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestJobEnqueueAndProcess verifies Phase 0 exit criterion #2:
// Job enqueued from API is picked up by worker, runs, reports completion.
func TestJobEnqueueAndProcess(t *testing.T) {
	env := SetupTestEnv(t)
	ctx := env.Ctx

	// Create a River client with workers
	emailSender := email.NewConsoleSender(env.Logger)
	riverClient, err := job.NewClient(ctx, env.Pool, env.Queries, emailSender, env.Logger)
	require.NoError(t, err)

	// Start the River client (begins processing jobs)
	err = riverClient.Start(ctx)
	require.NoError(t, err)
	t.Cleanup(func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = riverClient.Stop(shutdownCtx)
	})

	// Enqueue a SendEmail job
	insertResult, err := riverClient.Insert(ctx, job.SendEmailArgs{
		To:       "test@example.com",
		Subject:  "Test Job",
		HTMLBody: "<p>Hello from job queue test</p>",
		TextBody: "Hello from job queue test",
	}, nil)
	require.NoError(t, err)
	require.NotNil(t, insertResult)
	jobID := insertResult.Job.ID

	// Wait for the job to complete (poll the DB)
	var jobState string
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		row := env.Pool.QueryRow(ctx,
			"SELECT state FROM river_job WHERE id = $1", jobID)
		err = row.Scan(&jobState)
		require.NoError(t, err)
		if jobState == "completed" {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	assert.Equal(t, "completed", jobState, "job should be completed within timeout")

	// Verify job details
	var jobKind string
	var jobAttempt int
	row := env.Pool.QueryRow(ctx,
		"SELECT kind, attempt FROM river_job WHERE id = $1", jobID)
	err = row.Scan(&jobKind, &jobAttempt)
	require.NoError(t, err)
	assert.Equal(t, "send_email", jobKind)
	assert.Equal(t, 1, jobAttempt)
}

// TestJobEnqueueWithoutWorker verifies that jobs stay in the queue
// when no worker is running.
func TestJobEnqueueWithoutWorker(t *testing.T) {
	env := SetupTestEnv(t)
	ctx := env.Ctx

	// Create a client in insert-only mode (no workers registered)
	insertClient, err := river.NewClient(riverpgxv5.New(env.Pool), &river.Config{})
	require.NoError(t, err)

	// Enqueue a job
	result, err := insertClient.Insert(ctx, job.SendEmailArgs{
		To:       "queued@example.com",
		Subject:  "Queued Job",
		HTMLBody: "<p>This should stay queued</p>",
		TextBody: "This should stay queued",
	}, nil)
	require.NoError(t, err)
	jobID := result.Job.ID

	// Verify job is in available/scheduled state
	var jobState string
	row := env.Pool.QueryRow(ctx,
		"SELECT state FROM river_job WHERE id = $1", jobID)
	err = row.Scan(&jobState)
	require.NoError(t, err)
	assert.Contains(t, []string{"available", "scheduled"}, jobState,
		"job should be available or scheduled when no worker is running")
}

// TestMultipleJobsProcessed verifies multiple jobs are processed concurrently.
func TestMultipleJobsProcessed(t *testing.T) {
	env := SetupTestEnv(t)
	ctx := env.Ctx

	emailSender := email.NewConsoleSender(env.Logger)
	riverClient, err := job.NewClient(ctx, env.Pool, env.Queries, emailSender, env.Logger)
	require.NoError(t, err)

	err = riverClient.Start(ctx)
	require.NoError(t, err)
	t.Cleanup(func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = riverClient.Stop(shutdownCtx)
	})

	// Enqueue 5 jobs
	jobIDs := make([]int64, 5)
	for i := range 5 {
		result, err := riverClient.Insert(ctx, job.SendEmailArgs{
			To:       "batch@example.com",
			Subject:  "Batch Job",
			HTMLBody: "<p>Job batch test</p>",
			TextBody: "Job batch test",
		}, nil)
		require.NoError(t, err)
		jobIDs[i] = result.Job.ID
	}

	// Wait for all jobs to complete
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		var completedCount int
		row := env.Pool.QueryRow(ctx,
			"SELECT COUNT(*) FROM river_job WHERE id = ANY($1) AND state = 'completed'",
			jobIDs)
		err = row.Scan(&completedCount)
		require.NoError(t, err)
		if completedCount == 5 {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	// Verify all completed
	var completedCount int
	row := env.Pool.QueryRow(ctx,
		"SELECT COUNT(*) FROM river_job WHERE id = ANY($1) AND state = 'completed'",
		jobIDs)
	err = row.Scan(&completedCount)
	require.NoError(t, err)
	assert.Equal(t, 5, completedCount, "all 5 jobs should be completed")
}

