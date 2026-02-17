---
name: browser
description: "Browser automation for web interaction"
version: "1.0.0"
author: "Squire"
userInvocable: true
metadata:
  squire:
    emoji: "🖥️"
    requires:
      bins: ["chromium"]
    install:
      - type: brew
        package: chromium
---
# Browser Skill

Automate browser interactions for complex web tasks.

## Capabilities

- Navigate to URLs
- Take screenshots of pages
- Click elements and fill forms
- Extract page content
- Handle multi-step workflows

## Usage

When the user:
- Needs to interact with a website
- Wants to fill out a form
- Needs a screenshot of a page
- Wants to automate a web workflow

## Best Practices

1. Wait for page loads before interacting
2. Take screenshots to verify state
3. Handle popups and dialogs gracefully
4. Clean up browser sessions
