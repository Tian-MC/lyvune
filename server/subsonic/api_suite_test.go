package subsonic

import (
	"io/fs"
	"testing"

	"github.com/Tian-MC/lyvune/consts"
	"github.com/Tian-MC/lyvune/core/storage/local"
	"github.com/Tian-MC/lyvune/log"
	"github.com/Tian-MC/lyvune/model/metadata"
	"github.com/Tian-MC/lyvune/tests"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

func TestSubsonicApi(t *testing.T) {
	tests.Init(t, false)
	log.SetLevel(log.LevelFatal)
	RegisterFailHandler(Fail)
	RunSpecs(t, "Subsonic API Suite")
}

// newLocalStorage fatals if the default extractor is not registered.
// Register a no-op so storage.For works in sidecar-lyrics tests.
var _ = BeforeSuite(func() {
	local.RegisterExtractor(consts.DefaultScannerExtractor, func(fs.FS, string) local.Extractor {
		return &subsonicNoopExtractor{}
	})
})

type subsonicNoopExtractor struct{}

func (e *subsonicNoopExtractor) Parse(_ ...string) (map[string]metadata.Info, error) { return nil, nil }
func (e *subsonicNoopExtractor) Version() string                                     { return "noop" }
