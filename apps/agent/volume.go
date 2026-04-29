package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	agentv1 "github.com/othmanhaba/nixway-core/internal/agent/proto/agent/v1"
)

// volumesRoot is the on-disk root for managed volumes. Each volume gets a
// loopback-backed ext4 image (`<id>.img`) mounted at `<id>/` so the size
// declared by the control plane is enforced by the kernel and resizes
// actually grow what the container sees.
const volumesRoot = "/var/lib/nixway/volumes"

// HandleVolumeCreate provisions a loopback-backed ext4 volume at host_path.
// The flow is idempotent: re-running on an existing volume re-mounts it if
// the loop device was lost (e.g. across an agent restart) but never destroys
// data.
func HandleVolumeCreate(ctx context.Context, cmd *agentv1.VolumeCreateCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	res := &agentv1.VolumeResult{
		RequestId: cmd.RequestId,
		VolumeId:  cmd.VolumeId,
		Success:   true,
	}
	if cmd.HostPath == "" {
		sendVolumeResult(stream, finishVolumeError(res, "host_path is required"))
		return
	}

	sizeGB := cmd.SizeGb
	if sizeGB <= 0 {
		// Size is required for first-time create. Existing volumes (where
		// the .img already exists) re-use the on-disk size.
		if !pathExists(imagePathFor(cmd.HostPath)) {
			sendVolumeResult(stream, finishVolumeError(res, "size_gb is required for new volumes"))
			return
		}
	}

	if err := os.MkdirAll(cmd.HostPath, 0o755); err != nil {
		logger.Warn("volume create: mkdir mountpoint failed", "host_path", cmd.HostPath, "error", err)
		sendVolumeResult(stream, finishVolumeError(res, fmt.Sprintf("mkdir mountpoint: %v", err)))
		return
	}

	imgPath := imagePathFor(cmd.HostPath)
	if err := ensureLoopbackVolume(ctx, imgPath, cmd.HostPath, sizeGB, logger); err != nil {
		logger.Warn("volume create failed", "host_path", cmd.HostPath, "error", err)
		sendVolumeResult(stream, finishVolumeError(res, err.Error()))
		return
	}

	res.SizeBytes = int64(sizeGB) * 1024 * 1024 * 1024
	if used, err := dirSizeBytes(ctx, cmd.HostPath); err == nil {
		res.UsedBytes = used
	}
	sendVolumeResult(stream, res)
}

// HandleVolumeDelete unmounts the loopback (if any), removes the backing
// image, then deletes the mountpoint directory. Falls back to a plain
// recursive remove for legacy bare-directory volumes that predate loopback.
func HandleVolumeDelete(ctx context.Context, cmd *agentv1.VolumeDeleteCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	res := &agentv1.VolumeResult{
		RequestId: cmd.RequestId,
		VolumeId:  cmd.VolumeId,
		Success:   true,
	}
	if cmd.HostPath == "" {
		sendVolumeResult(stream, finishVolumeError(res, "host_path is required"))
		return
	}
	if !strings.HasPrefix(filepath.Clean(cmd.HostPath), volumesRoot+"/") {
		sendVolumeResult(stream, finishVolumeError(res, "refusing to delete path outside the volumes root"))
		return
	}

	imgPath := imagePathFor(cmd.HostPath)

	// Best-effort unmount; if nothing's mounted this exits non-zero and we
	// move on. We use --lazy so a busy mount (rare during delete, but
	// possible if the container was killed mid-shutdown) doesn't block.
	_, _ = exec.CommandContext(ctx, "umount", "-l", cmd.HostPath).CombinedOutput()

	if err := os.Remove(imgPath); err != nil && !os.IsNotExist(err) {
		logger.Warn("volume delete: remove img failed", "img", imgPath, "error", err)
	}
	if err := os.RemoveAll(cmd.HostPath); err != nil {
		logger.Warn("volume delete: remove mountpoint failed", "host_path", cmd.HostPath, "error", err)
		sendVolumeResult(stream, finishVolumeError(res, fmt.Sprintf("remove mountpoint: %v", err)))
		return
	}
	sendVolumeResult(stream, res)
}

// HandleVolumeMove rsyncs the volume to a target server over WireGuard, then
// removes the local copy on success. Failures leave the source untouched.
func HandleVolumeMove(ctx context.Context, cmd *agentv1.VolumeMoveCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	res := &agentv1.VolumeResult{
		RequestId: cmd.RequestId,
		VolumeId:  cmd.VolumeId,
		Success:   true,
	}
	if cmd.SourcePath == "" || cmd.TargetWireguardIp == "" || cmd.TargetPath == "" {
		sendVolumeResult(stream, finishVolumeError(res, "source_path, target_wireguard_ip, and target_path are required"))
		return
	}

	source := strings.TrimRight(cmd.SourcePath, "/") + "/"
	target := fmt.Sprintf("root@%s:%s/", cmd.TargetWireguardIp, strings.TrimRight(cmd.TargetPath, "/"))

	// Ensure remote directory exists. Best-effort; rsync will recreate as needed.
	mkdirCmd := exec.CommandContext(ctx, "ssh", "-o", "StrictHostKeyChecking=no", fmt.Sprintf("root@%s", cmd.TargetWireguardIp), "mkdir", "-p", cmd.TargetPath)
	if out, err := mkdirCmd.CombinedOutput(); err != nil {
		logger.Warn("volume move: remote mkdir failed", "out", string(out), "error", err)
	}

	rsync := exec.CommandContext(ctx, "rsync", "-avz", "-e", "ssh -o StrictHostKeyChecking=no", source, target)
	if out, err := rsync.CombinedOutput(); err != nil {
		logger.Warn("volume move: rsync failed", "out", string(out), "error", err)
		sendVolumeResult(stream, finishVolumeError(res, fmt.Sprintf("rsync: %v: %s", err, string(out))))
		return
	}

	// Best-effort: unmount + remove the local image and mountpoint. The
	// receiving side is expected to reconcile its own loopback on first use.
	_, _ = exec.CommandContext(ctx, "umount", "-l", cmd.SourcePath).CombinedOutput()
	if err := os.Remove(imagePathFor(cmd.SourcePath)); err != nil && !os.IsNotExist(err) {
		logger.Warn("volume move: source img cleanup failed", "source", cmd.SourcePath, "error", err)
	}
	if err := os.RemoveAll(cmd.SourcePath); err != nil {
		logger.Warn("volume move: source cleanup failed", "source", cmd.SourcePath, "error", err)
	}
	sendVolumeResult(stream, res)
}

// HandleVolumeSnapshot tarballs the volume contents into the requested output path.
func HandleVolumeSnapshot(ctx context.Context, cmd *agentv1.VolumeSnapshotCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	res := &agentv1.VolumeResult{
		RequestId: cmd.RequestId,
		VolumeId:  cmd.VolumeId,
		Success:   true,
	}
	if cmd.SourcePath == "" || cmd.OutputPath == "" {
		sendVolumeResult(stream, finishVolumeError(res, "source_path and output_path are required"))
		return
	}
	if err := os.MkdirAll(filepath.Dir(cmd.OutputPath), 0o755); err != nil {
		sendVolumeResult(stream, finishVolumeError(res, fmt.Sprintf("mkdir snapshots: %v", err)))
		return
	}

	tar := exec.CommandContext(ctx, "tar", "czf", cmd.OutputPath, "-C", cmd.SourcePath, ".")
	if out, err := tar.CombinedOutput(); err != nil {
		logger.Warn("volume snapshot failed", "output", cmd.OutputPath, "out", string(out), "error", err)
		sendVolumeResult(stream, finishVolumeError(res, fmt.Sprintf("tar: %v: %s", err, string(out))))
		return
	}

	if info, err := os.Stat(cmd.OutputPath); err == nil {
		res.SizeBytes = info.Size()
	}
	res.SnapshotPath = cmd.OutputPath
	sendVolumeResult(stream, res)
}

// HandleVolumeResize grows a loopback-backed volume online: extend the
// backing file, refresh the kernel's view of the loop device, then resize
// the ext4 filesystem in place. The container keeps running, the bind mount
// stays valid, and `df -h` inside the container reflects the new size.
//
// Legacy bare-directory volumes (no .img file) fall back to the previous
// soft-quota behavior: declared size is reported but nothing is enforced.
func HandleVolumeResize(ctx context.Context, cmd *agentv1.VolumeResizeCommand, stream agentv1.AgentService_ConnectClient, logger *slog.Logger) {
	res := &agentv1.VolumeResult{
		RequestId: cmd.RequestId,
		VolumeId:  cmd.VolumeId,
		Success:   true,
		SizeBytes: int64(cmd.NewSizeGb) * 1024 * 1024 * 1024,
	}
	if cmd.HostPath == "" {
		sendVolumeResult(stream, finishVolumeError(res, "host_path is required"))
		return
	}

	imgPath := imagePathFor(cmd.HostPath)
	if pathExists(imgPath) {
		if err := growLoopbackVolume(ctx, imgPath, cmd.HostPath, cmd.NewSizeGb, logger); err != nil {
			logger.Warn("volume resize failed", "host_path", cmd.HostPath, "error", err)
			sendVolumeResult(stream, finishVolumeError(res, err.Error()))
			return
		}
	} else {
		logger.Info("volume resize: legacy bare-directory volume; reporting declared size as soft quota",
			"host_path", cmd.HostPath, "new_size_gb", cmd.NewSizeGb)
	}

	if used, err := dirSizeBytes(ctx, cmd.HostPath); err == nil {
		res.UsedBytes = used
	}
	sendVolumeResult(stream, res)
}

func sendVolumeResult(stream agentv1.AgentService_ConnectClient, res *agentv1.VolumeResult) {
	_ = stream.Send(&agentv1.AgentMessage{
		Payload: &agentv1.AgentMessage_VolumeResult{VolumeResult: res},
	})
}

func finishVolumeError(res *agentv1.VolumeResult, msg string) *agentv1.VolumeResult {
	res.Success = false
	res.Error = msg
	return res
}

// dirSizeBytes shells out to `du -sb` to report directory usage in bytes.
func dirSizeBytes(ctx context.Context, path string) (int64, error) {
	out, err := exec.CommandContext(ctx, "du", "-sb", path).Output()
	if err != nil {
		return 0, err
	}
	parts := strings.Fields(string(out))
	if len(parts) == 0 {
		return 0, fmt.Errorf("unexpected du output: %q", string(out))
	}
	return strconv.ParseInt(parts[0], 10, 64)
}

// imagePathFor returns the loopback image path that backs a given mountpoint.
// Adjacent to the mountpoint so a single ls of /var/lib/nixway/volumes shows
// pairs like `<id>/` (mountpoint) and `<id>.img` (backing file).
func imagePathFor(hostPath string) string {
	return strings.TrimRight(hostPath, "/") + ".img"
}

// pathExists is a non-erroring "is regular file or symlink" check.
func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// isMountpoint returns true when path is a current mount target. We use the
// mountpoint(1) helper rather than parsing /proc/mounts to keep this short
// and portable across busybox/coreutils userlands.
func isMountpoint(ctx context.Context, path string) bool {
	return exec.CommandContext(ctx, "mountpoint", "-q", path).Run() == nil
}

// ensureLoopbackVolume is idempotent volume-create. Steps:
//  1. Create the sparse backing file at sizeGB if missing.
//  2. mkfs.ext4 if the file is empty (no signature).
//  3. mount -o loop if not already mounted.
//
// If everything is already in place this is a no-op. Used by both
// HandleVolumeCreate and the startup reconciler so an agent restart never
// leaves a container pointing at an unmounted directory.
func ensureLoopbackVolume(ctx context.Context, imgPath, mountPoint string, sizeGB int32, logger *slog.Logger) error {
	if !pathExists(imgPath) {
		if sizeGB <= 0 {
			return fmt.Errorf("missing image %s and no size_gb to create one", imgPath)
		}
		// truncate creates a sparse file — disk usage grows only as data is
		// written, but the filesystem inside sees the full declared size.
		if out, err := exec.CommandContext(ctx, "truncate", "-s",
			fmt.Sprintf("%dG", sizeGB), imgPath).CombinedOutput(); err != nil {
			return fmt.Errorf("truncate %s: %v: %s", imgPath, err, strings.TrimSpace(string(out)))
		}
	}

	// Check whether the file already has an ext4 signature; if not, format.
	if !hasFilesystemSignature(ctx, imgPath) {
		// -F forces creation on a non-block-special file. -E lazy_itable_init=0
		// keeps the format synchronous; without it ext4 lazily zeros inode
		// tables in the background which can starve the container's first
		// writes on a slow disk.
		if out, err := exec.CommandContext(ctx, "mkfs.ext4", "-F",
			"-E", "lazy_itable_init=0,lazy_journal_init=0", imgPath).CombinedOutput(); err != nil {
			return fmt.Errorf("mkfs.ext4 %s: %v: %s", imgPath, err, strings.TrimSpace(string(out)))
		}
		logger.Info("volume formatted", "img", imgPath)
	}

	if isMountpoint(ctx, mountPoint) {
		return nil
	}
	if out, err := exec.CommandContext(ctx, "mount", "-o", "loop", imgPath, mountPoint).CombinedOutput(); err != nil {
		return fmt.Errorf("mount %s on %s: %v: %s", imgPath, mountPoint, err, strings.TrimSpace(string(out)))
	}
	logger.Info("volume mounted", "img", imgPath, "mount", mountPoint)
	return nil
}

// growLoopbackVolume performs an online ext4 grow on an already-mounted
// loopback volume. Shrinks are not supported (would require offline e2fsck +
// resize2fs). Caller is expected to refuse newSize <= currentSize before
// dispatch; we double-check here to avoid corrupting on a misconfigured call.
func growLoopbackVolume(ctx context.Context, imgPath, mountPoint string, newSizeGB int32, logger *slog.Logger) error {
	if newSizeGB <= 0 {
		return fmt.Errorf("new_size_gb must be > 0")
	}

	curBytes := int64(0)
	if info, err := os.Stat(imgPath); err == nil {
		curBytes = info.Size()
	}
	newBytes := int64(newSizeGB) * 1024 * 1024 * 1024
	if newBytes <= curBytes {
		return fmt.Errorf("new size %dGB is not larger than current size %d bytes; shrink not supported",
			newSizeGB, curBytes)
	}

	// 1. Grow the sparse backing file.
	if out, err := exec.CommandContext(ctx, "truncate", "-s",
		fmt.Sprintf("%dG", newSizeGB), imgPath).CombinedOutput(); err != nil {
		return fmt.Errorf("truncate grow: %v: %s", err, strings.TrimSpace(string(out)))
	}

	// 2. Identify which loop device backs the mount, then refresh its size.
	loopDev, err := loopDeviceFor(ctx, mountPoint)
	if err != nil {
		return fmt.Errorf("locate loop device: %w", err)
	}
	if loopDev == "" {
		// Mountpoint isn't a loopback mount (e.g. someone manually
		// bind-mounted the .img on top). Fall back to a no-op for safety.
		logger.Warn("volume resize: mountpoint is not a loopback; skipping kernel/fs grow",
			"mount", mountPoint)
		return nil
	}
	if out, err := exec.CommandContext(ctx, "losetup", "-c", loopDev).CombinedOutput(); err != nil {
		return fmt.Errorf("losetup -c %s: %v: %s", loopDev, err, strings.TrimSpace(string(out)))
	}

	// 3. Online ext4 grow. resize2fs without a target size grows to fill
	// the (now larger) device.
	if out, err := exec.CommandContext(ctx, "resize2fs", loopDev).CombinedOutput(); err != nil {
		return fmt.Errorf("resize2fs %s: %v: %s", loopDev, err, strings.TrimSpace(string(out)))
	}
	logger.Info("volume resized", "img", imgPath, "new_size_gb", newSizeGB, "loop", loopDev)
	return nil
}

// hasFilesystemSignature returns true iff `blkid` reports a TYPE for the
// image — i.e. the file already contains a formatted filesystem and we
// shouldn't blow it away with a fresh mkfs.
func hasFilesystemSignature(ctx context.Context, imgPath string) bool {
	out, _ := exec.CommandContext(ctx, "blkid", "-o", "value", "-s", "TYPE", imgPath).Output()
	return strings.TrimSpace(string(out)) != ""
}

// loopDeviceFor returns the /dev/loopN device backing a mountpoint, or "" if
// the mountpoint isn't a loopback mount. We use `findmnt` because it parses
// /proc/self/mountinfo without us having to ourselves.
func loopDeviceFor(ctx context.Context, mountPoint string) (string, error) {
	out, err := exec.CommandContext(ctx, "findmnt", "-no", "SOURCE", mountPoint).Output()
	if err != nil {
		return "", err
	}
	src := strings.TrimSpace(string(out))
	if !strings.HasPrefix(src, "/dev/loop") {
		return "", nil
	}
	return src, nil
}

// reconcileVolumeMounts re-mounts every loopback volume the agent created
// previously. Called once at agent startup so containers with `--restart
// unless-stopped` see a populated bind-mount source the moment they retry.
//
// Iterates `/var/lib/nixway/volumes/*.img` and calls ensureLoopbackVolume on
// each. Errors are logged and skipped — one bad volume must not prevent the
// agent from coming up.
func reconcileVolumeMounts(ctx context.Context, logger *slog.Logger) {
	entries, err := os.ReadDir(volumesRoot)
	if err != nil {
		// First boot before any volume is created — nothing to do.
		return
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".img") {
			continue
		}
		imgPath := filepath.Join(volumesRoot, e.Name())
		mountPoint := strings.TrimSuffix(imgPath, ".img")
		if err := os.MkdirAll(mountPoint, 0o755); err != nil {
			logger.Warn("reconcile mount: mkdir failed", "mount", mountPoint, "error", err)
			continue
		}
		if err := ensureLoopbackVolume(ctx, imgPath, mountPoint, 0, logger); err != nil {
			logger.Warn("reconcile mount: ensure failed", "img", imgPath, "error", err)
		}
	}
}
