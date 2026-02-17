---
name: memory
description: "Persistent memory storage and retrieval for context across sessions"
version: "1.0.0"
author: "Squire"
userInvocable: true
metadata:
  squire:
    emoji: "🧠"
---
# Memory Skill

Store and retrieve memories across sessions for persistent context.

## Capabilities

- Store facts, preferences, and important information
- Search memories using semantic similarity
- Organize memories by source and workspace
- Set expiration on temporary memories

## Tools Available

- `memory_remember` - Store a new memory
- `memory_recall` - Search for memories
- `memory_forget` - Remove memories

## Usage

When the user:
- Tells you something important about their preferences
- Shares a fact you should remember
- Asks what you remember about a topic
- Wants to update or remove stored information

## Best Practices

1. Store user preferences proactively
2. Use descriptive content for better retrieval
3. Tag memories with relevant metadata
4. Review and consolidate old memories periodically
