package job

import (
	"context"
	"fmt"

	"github.com/othmanhaba/nixway-core/internal/email"
	"github.com/othmanhaba/nixway-core/internal/metrics"
	"github.com/riverqueue/river"
)

type SendEmailArgs struct {
	To       string `json:"to"`
	Subject  string `json:"subject"`
	HTMLBody string `json:"html_body"`
	TextBody string `json:"text_body"`
}

func (SendEmailArgs) Kind() string { return "send_email" }

type SendEmailWorker struct {
	river.WorkerDefaults[SendEmailArgs]
	sender email.Sender
}

func (w *SendEmailWorker) Work(ctx context.Context, job *river.Job[SendEmailArgs]) (err error) {
	defer func() { metrics.RecordJob(SendEmailArgs{}.Kind(), err) }()
	if err = w.sender.Send(ctx, job.Args.To, job.Args.Subject, job.Args.HTMLBody, job.Args.TextBody); err != nil {
		return fmt.Errorf("send email: %w", err)
	}
	return nil
}
