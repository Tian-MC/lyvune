package backgrounds

import (
	"testing"

	"github.com/Tian-MC/lyvune/log"
	"github.com/Tian-MC/lyvune/tests"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

func TestBackgrounds(t *testing.T) {
	tests.Init(t, false)
	log.SetLevel(log.LevelFatal)
	RegisterFailHandler(Fail)
	RunSpecs(t, "Backgrounds Suite")
}
