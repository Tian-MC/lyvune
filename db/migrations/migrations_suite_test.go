package migrations

import (
	"testing"

	"github.com/Tian-MC/lyvune/log"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// tests.Init is omitted: the tests package imports db, which imports this package.
func TestMigrations(t *testing.T) {
	log.SetLevel(log.LevelFatal)
	RegisterFailHandler(Fail)
	RunSpecs(t, "Migrations Suite")
}
