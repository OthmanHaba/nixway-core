package ssh

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"strings"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

type Client struct {
	config *gossh.ClientConfig
	addr   string
}

type ConnectResult struct {
	Uname     string
	DiskSpace string
	HasSudo   bool
	OS        string
	OSVersion string
	Arch      string
}

func NewClient(host string, port int, user string, privateKey []byte) (*Client, error) {
	signer, err := gossh.ParsePrivateKey(privateKey)
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}
	config := &gossh.ClientConfig{
		User:            user,
		Auth:            []gossh.AuthMethod{gossh.PublicKeys(signer)},
		HostKeyCallback: gossh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}
	return &Client{config: config, addr: net.JoinHostPort(host, fmt.Sprintf("%d", port))}, nil
}

func (c *Client) RunCommand(ctx context.Context, command string) (string, error) {
	conn, err := gossh.Dial("tcp", c.addr, c.config)
	if err != nil {
		return "", fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	session, err := conn.NewSession()
	if err != nil {
		return "", fmt.Errorf("new session: %w", err)
	}
	defer session.Close()

	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	if err := session.Run(command); err != nil {
		return "", fmt.Errorf("run %q: %w (stderr: %s)", command, err, stderr.String())
	}
	return stdout.String(), nil
}

func (c *Client) ConnectivityCheck(ctx context.Context) (*ConnectResult, error) {
	result := &ConnectResult{}

	uname, err := c.RunCommand(ctx, "uname -a")
	if err != nil {
		return nil, fmt.Errorf("connectivity check failed: %w", err)
	}
	result.Uname = strings.TrimSpace(uname)

	disk, err := c.RunCommand(ctx, "df -h /")
	if err == nil {
		result.DiskSpace = strings.TrimSpace(disk)
	}

	_, err = c.RunCommand(ctx, "sudo -n true")
	result.HasSudo = err == nil

	osRelease, err := c.RunCommand(ctx, "cat /etc/os-release")
	if err == nil {
		result.OS, result.OSVersion = parseOSRelease(osRelease)
	}

	arch, err := c.RunCommand(ctx, "uname -m")
	if err == nil {
		result.Arch = strings.TrimSpace(arch)
	}

	return result, nil
}

func (c *Client) PushFile(ctx context.Context, content []byte, remotePath string, mode string) error {
	conn, err := gossh.Dial("tcp", c.addr, c.config)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	session, err := conn.NewSession()
	if err != nil {
		return fmt.Errorf("new session: %w", err)
	}
	defer session.Close()

	cmd := fmt.Sprintf("cat > %s && chmod %s %s", remotePath, mode, remotePath)
	session.Stdin = bytes.NewReader(content)
	return session.Run(cmd)
}

// RunCommandStreaming executes a command on the remote server and calls
// onOutput for each line of combined stdout/stderr output.
func (c *Client) RunCommandStreaming(ctx context.Context, command string, onOutput func(line string)) error {
	conn, err := gossh.Dial("tcp", c.addr, c.config)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	session, err := conn.NewSession()
	if err != nil {
		return fmt.Errorf("new session: %w", err)
	}
	defer session.Close()

	// Use an io.Pipe to merge stdout and stderr into a single reader.
	pr, pw := io.Pipe()
	session.Stdout = pw
	session.Stderr = pw

	if err := session.Start(command); err != nil {
		return fmt.Errorf("start %q: %w", command, err)
	}

	// Read lines in a goroutine; close the pipe writer when the session exits.
	done := make(chan error, 1)
	go func() {
		done <- session.Wait()
		pw.Close()
	}()

	scanner := bufio.NewScanner(pr)
	for scanner.Scan() {
		onOutput(scanner.Text())
	}

	return <-done
}

// InteractiveSession represents a PTY-backed SSH session for terminal access.
type InteractiveSession struct {
	conn    *gossh.Client
	session *gossh.Session
	Stdin   io.WriteCloser
	Stdout  io.Reader
}

// StartInteractiveSession opens an SSH connection with a PTY for interactive use.
func (c *Client) StartInteractiveSession(cols, rows int) (*InteractiveSession, error) {
	conn, err := gossh.Dial("tcp", c.addr, c.config)
	if err != nil {
		return nil, fmt.Errorf("dial: %w", err)
	}

	session, err := conn.NewSession()
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("new session: %w", err)
	}

	modes := gossh.TerminalModes{
		gossh.ECHO:          1,
		gossh.TTY_OP_ISPEED: 14400,
		gossh.TTY_OP_OSPEED: 14400,
	}

	if err := session.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		session.Close()
		conn.Close()
		return nil, fmt.Errorf("request pty: %w", err)
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		conn.Close()
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}

	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		conn.Close()
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}

	if err := session.Shell(); err != nil {
		session.Close()
		conn.Close()
		return nil, fmt.Errorf("start shell: %w", err)
	}

	return &InteractiveSession{
		conn:    conn,
		session: session,
		Stdin:   stdin,
		Stdout:  stdout,
	}, nil
}

// Resize changes the terminal size.
func (s *InteractiveSession) Resize(cols, rows int) error {
	return s.session.WindowChange(rows, cols)
}

// Close terminates the SSH session and connection.
func (s *InteractiveSession) Close() {
	s.session.Close()
	s.conn.Close()
}

// Wait waits for the session to finish.
func (s *InteractiveSession) Wait() error {
	return s.session.Wait()
}

func parseOSRelease(content string) (string, string) {
	var id, version string
	for _, line := range strings.Split(content, "\n") {
		if strings.HasPrefix(line, "ID=") {
			id = strings.Trim(strings.TrimPrefix(line, "ID="), "\"")
		}
		if strings.HasPrefix(line, "VERSION_ID=") {
			version = strings.Trim(strings.TrimPrefix(line, "VERSION_ID="), "\"")
		}
	}
	return id, version
}
