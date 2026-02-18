---
name: tool_search
description: "Search for available tools using semantic search. Use this when you need a tool that doesn't exist yet or want to find tools for a specific purpose."
version: "1.0.0"
inputSchema:
  type: object
  properties:
    query:
      type: string
      description: "What kind of tool you need. Describe the functionality you're looking for."
    limit:
      type: number
      description: "Maximum number of results to return (default: 5)"
  required: [query]
metadata:
  squire:
    keywords: [search, tools, find, discover, semantic]
---

# Tool Search

Search for available Squire tools using semantic search. This tool helps you discover existing tools that might help with your current task.

## Usage

When you need a tool but don't know if one exists:
1. Describe what functionality you need in natural language
2. The search will find tools with similar descriptions
3. You can then install or use the found tools

## Examples

- "I need a tool to resize images" -> might find image manipulation tools
- "I want to interact with a database" -> might find database tools
- "I need to parse CSV files" -> might find data processing tools

## Handler

```typescript
export default async function(input: { query: string; limit?: number }, context: ToolHandlerContext) {
  // Uses QMD semantic search to find matching tools
  // Returns list of tools with descriptions and installation info
}
```
