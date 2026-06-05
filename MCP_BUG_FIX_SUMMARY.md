# MCP Server Bug Fix Summary

This document summarizes critical bug fixes for Void's MCP (Model Context Protocol) integration that prevented MCP tools from being available to the LLM.

## Bug #1: MCP Server Not Added to Internal List When Toggled On

### Description
When toggling an MCP server ON in Void's settings, the server would connect successfully (showing green status in UI) but tools would not be available. The server was never added to the internal `infoOfClientId` mapping, causing tool calls to fail silently.

### Root Cause
In `src/vs/workbench/contrib/void/electron-main/mcpChannel.ts`, the `_toggleMCPServer` function had a critical bug around line 280-284. When toggling a server ON:

1. ✅ It created the client connection with `_createClientUnsafe()`
2. ✅ It fired an event to notify the browser process (making UI show green)
3. ❌ **It never updated `this.infoOfClientId[serverName]` with the new client**

This meant:
- UI showed server as connected (green status)
- Server had valid connection and tool list
- But stored reference to client was missing
- When trying to call a tool, code looked up `this.infoOfClientId[serverName]._client` and found nothing

### The Fix

**File:** `src/vs/workbench/contrib/void/electron-main/mcpChannel.ts`

**Line:** 284 (in the `_toggleMCPServer` function)

**Change:** Added one line to store the client info when server is toggled ON:

```typescript
private async _toggleMCPServer(serverName: string, isOn: boolean) {
    const prevServer = this.infoOfClientId[serverName]?.mcpServer
    if (isOn) {
        // Create client and get info
        const clientInfo = await this._createClientUnsafe(
            this.infoOfClientId[serverName].mcpServerEntryJSON,
            serverName,
            isOn
        )

        // FIX: Store the client info so tool calls can find it
        this.infoOfClientId[serverName] = clientInfo  // <-- THIS LINE WAS MISSING

        // Fire event to update UI
        this.mcpEmitters.serverEvent.onUpdate.fire({
            response: {
                name: serverName,
                newServer: clientInfo.mcpServer,
                prevServer: prevServer,
            }
        })
    } else {
        // ... toggle off logic
    }
}
```

---

## Bug #2: Tool Naming System Used Random Prefixes

### Description
The original MCP implementation used random prefixes (like `a1b2c3_read_file`) to make tool names unique. This was replaced with a more predictable system using the server name as the prefix (e.g., `filesystem__read_file`).

### Root Cause
The `_addUniquePrefix()` function generated random 6-character prefixes for each tool. While this prevented naming collisions, it made tools unpredictable and harder to debug.

### The Fix

**File:** `src/vs/workbench/contrib/void/common/mcpService.ts`

**Line:** 202

**Change:** Replaced random prefix with consistent server name prefix:

```typescript
// OLD (removed from mcpChannel.ts):
private _addUniquePrefix(base: string) {
    return `${Math.random().toString(36).slice(2, 8)}_${base}`;
}
name: this._addUniquePrefix(tool.name)  // Would generate: "a1b2c3_read_file"

// NEW (in mcpService.ts):
name: `${serverName}__${tool.name}`  // Generates: "filesystem__read_file"
```

**Also in `mcpChannel.ts`:**
- Removed the `_addUniquePrefix()` function (lines 232-234)
- Removed calls to `toolsWithUniqueName` mapping (lines 191, 203, 215)
- Tools are now returned as-is from MCP servers

**Benefits:**
- Predictable tool names for debugging
- Server name clearly identifies which MCP server provides the tool
- Prevents naming collisions when multiple servers have tools with the same base name
- Tool names are consistent across sessions

---

## Bug #3: Error Handling in MCP Channel

### Description
Errors in `mcpChannel.ts` `call()` method were caught but returned `undefined` instead of proper error responses, making it difficult to debug tool call failures.

### The Fix

**File:** `src/vs/workbench/contrib/void/electron-main/mcpChannel.ts`

**Lines:** 109-122

**Change:** Return proper error response for `callTool` command:

```typescript
catch (e) {
    console.error('mcp channel: Call Error:', e)
    // For callTool command, return proper error response instead of undefined
    if (command === 'callTool') {
        const p: MCPToolCallParams = params
        const errorResponse: MCPToolErrorResponse = {
            event: 'error',
            text: `MCP Channel Error: ${e instanceof Error ? e.message : String(e)}`,
            toolName: p.toolName || 'unknown',
            serverName: p.serverName || 'unknown',
        }
        return errorResponse
    }
    // For other commands, re-throw
    throw e
}
```

---

## Debug Logging Added

Added comprehensive logging to help debug MCP issues:

1. **mcpChannel.ts** (lines 210-226): Connection and tool fetching logs
2. **mcpService.ts** (lines 105-119, 192-208): Initialization and tool retrieval logs
3. **prompts.ts** (lines 404-417): Tool count and XML generation logs

**Recommendation:** Keep these logs as they're essential for debugging MCP integration issues.

---

## Testing

After all fixes:
1. ✅ Toggle MCP server ON in settings
2. ✅ Server connects and shows green status
3. ✅ Tools are registered with predictable names (e.g., `filesystem__read_file`)
4. ✅ Tools are properly available and can be called
5. ✅ Internal client references are stored correctly
6. ✅ Tool calls route to the correct MCP server using the server name prefix

---

## Files Changed

- `src/vs/workbench/contrib/void/electron-main/mcpChannel.ts` (Bug #1 fix, Bug #3 fix, removed random prefix code, logging)
- `src/vs/workbench/contrib/void/common/mcpService.ts` (Bug #2 fix - server name prefix implementation, logging)
- `src/vs/workbench/contrib/void/common/prompt/prompts.ts` (logging)

---

## Summary

These fixes resolve the core issues preventing MCP tools from being available and usable in Void:

1. **Bug #1** ensured MCP servers are properly registered internally when toggled on
2. **Bug #2** replaced random tool name prefixes with predictable server name prefixes
3. **Bug #3** improved error handling for better debugging

The tool naming system now works as follows:
- Tools are prefixed with `serverName__toolName` for uniqueness (e.g., `filesystem__read_file`)
- The prefix prevents collisions when multiple servers provide tools with the same name
- The server name is also stored separately as `mcpServerName` for routing
- When the LLM calls a tool, Void uses both the full tool name and `mcpServerName` to route correctly
