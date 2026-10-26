package lyrics_test

import (
	"os"
	"runtime"

	. "github.com/onsi/ginkgo/v2"
)

// skipWithoutDirectoryPermissions skips a spec that makes a folder unwritable with chmod. Root ignores the mode, and
// Windows has no such mode for folders, so the read-only case is only exercised elsewhere.
func skipWithoutDirectoryPermissions() {
	if runtime.GOOS == "windows" {
		Skip("a folder cannot be made read-only with chmod on Windows")
	}
	if os.Geteuid() == 0 {
		Skip("root ignores directory permissions")
	}
}
