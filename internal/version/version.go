// SPDX-License-Identifier: 0BSD
package version

// Set at link time via -ldflags -X.
var (
	Version = "dev"
	Commit  = "unknown"
)
