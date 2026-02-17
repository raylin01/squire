---
name: github
description: "GitHub repository and issue management"
version: "1.0.0"
author: "Squire"
userInvocable: true
metadata:
  squire:
    emoji: "🐙"
    requires:
      bins: ["gh"]
      env: ["GITHUB_TOKEN"]
    install:
      - type: brew
        package: gh
---
# GitHub Skill

Interact with GitHub repositories, issues, and pull requests.

## Capabilities

- Browse repository structure
- Read file contents from repos
- Search issues and discussions
- Create and manage pull requests
- View commit history

## Tools Available

- `github_get_repo_structure` - Get directory listing
- `github_read_file` - Read file contents
- `github_search` - Search repos, issues, code

## Usage

When the user:
- Wants to explore a repository
- Needs to read code from GitHub
- Wants to check issue status
- Needs to review pull requests

## Best Practices

1. Use search to find relevant content quickly
2. Respect API rate limits
3. Handle authentication errors gracefully
4. Cache results when appropriate
