import { Vertical, ToolCall, ToolResult } from '../types';
import { marketTools, executeTool as execMarket } from './tools/market';
import { apptekaTools, executeTool as execAppteka } from './tools/appteka';
import { travelTools, executeTool as execTravel } from './tools/travel';

// FR-201 — Tool Router: maps vertical → tool schemas and executors
// NFR-6 — idempotency handled per tool; retry with exponential backoff (Phase 1)

type AnthropicTool = {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required: string[] };
};

export function getToolsForVertical(vertical: Vertical): AnthropicTool[] {
  switch (vertical) {
    case 'market':      return [...marketTools] as AnthropicTool[];
    case 'appteka':     return [...apptekaTools] as AnthropicTool[];
    case 'travel':      return [...travelTools] as AnthropicTool[];
    case 'kino':        return []; // OPEN: kino tools — Phase 5
    case 'restaurants': return []; // OPEN: restaurants tools — Phase 5 (API in dev)
    default:
      return [...marketTools, ...apptekaTools] as AnthropicTool[];
  }
}

export function getAllTools(): AnthropicTool[] {
  return [...marketTools, ...apptekaTools, ...travelTools] as AnthropicTool[];
}

export async function executeToolCall(call: ToolCall, clientId: string): Promise<ToolResult> {
  try {
    let data: unknown;

    if (call.name.startsWith('market_')) {
      data = execMarket(call.name, call.input, clientId);
    } else if (call.name.startsWith('appteka_')) {
      data = execAppteka(call.name, call.input);
    } else if (call.name.startsWith('travel_')) {
      data = execTravel(call.name, call.input);
    } else {
      return { toolName: call.name, success: false, error: `No executor for tool: ${call.name}` };
    }

    return { toolName: call.name, success: true, data };
  } catch (err) {
    return { toolName: call.name, success: false, error: String(err) };
  }
}
