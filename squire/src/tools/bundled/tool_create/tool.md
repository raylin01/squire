---
name: tool_create
description: "Create a new Squire tool. Squire can autonomously create new tools to extend its capabilities."
version: "1.0.0"
inputSchema:
  type: object
  properties:
    name:
      type: string
      description: "Name for the new tool (lowercase, use hyphens for spaces)"
    description:
      type: string
      description: "What the tool does"
    inputProperties:
      type: object
      description: "Input parameters the tool accepts (JSON schema properties)"
    destination:
      type: string
      description: "Where to create: 'global' (default) or 'project'"
  required: [name, description]
metadata:
  squire:
    keywords: [create, tools, new, generate, scaffold, extend]
---

# Tool Create

Create a new Squire tool. This tool allows Squire to extend its own capabilities by creating new tools.

## Usage

Squire can use this tool to:
1. Create new tools when it identifies a need
2. Package reusable functionality
3. Share tools with others

## Parameters

- `name`: Tool name (required) - lowercase with hyphens
- `description`: What the tool does (required)
- `inputProperties`: Input parameters as JSON Schema properties
- `destination`: Where to create (global or project)

## Generated Files

The tool creates:
- `tool.md` - Tool definition with frontmatter
- `handler.ts` - TypeScript handler template

## Example

```
{
  "name": "resize-image",
  "description": "Resize images to specified dimensions",
  "inputProperties": {
    "imagePath": { "type": "string", "description": "Path to the image" },
    "width": { "type": "number", "description": "Target width" },
    "height": { "type": "number", "description": "Target height" }
  }
}
```
