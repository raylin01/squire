---
name: tool_install
description: "Install a tool from a git repository. Use this to add new tools to Squire from external sources."
version: "1.0.0"
inputSchema:
  type: object
  properties:
    repository:
      type: string
      description: "Git repository URL (e.g., https://github.com/user/squire-tool-foo)"
    destination:
      type: string
      description: "Where to install: 'global' (default, ~/.squire/tools) or 'project' (./.squire/tools)"
    name:
      type: string
      description: "Optional custom name for the tool directory"
  required: [repository]
metadata:
  squire:
    requires:
      bins: [git]
    keywords: [install, tools, git, clone, download]
---

# Tool Install

Install a tool from a git repository. This clones the repository to your tools directory and makes it available to Squire.

## Usage

1. Provide a git repository URL
2. Optionally specify where to install (global or project)
3. Optionally provide a custom name
4. The tool will be cloned and registered

## Requirements

- Git must be installed and available in PATH

## Examples

```
# Install a tool globally
{ "repository": "https://github.com/user/squire-image-tool" }

# Install to current project
{ "repository": "https://github.com/user/squire-db-tool", "destination": "project" }

# Install with custom name
{ "repository": "https://github.com/user/cool-tool", "name": "my-cool-tool" }
```
