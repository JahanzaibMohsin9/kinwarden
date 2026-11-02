import { describe, expect, it } from "vitest";
import { anthropicToolDefs } from "./tools";

// The gateway rejects text over a field's limit. The model sees the limit only if the description
// says it: a JSON Schema maxLength alone didn't stop it writing a 931-character family message.
describe("Tool definitions", () => {
  it("state the character limit of every long text field in its description", () => {
    const missing: string[] = [];
    for (const def of anthropicToolDefs()) {
      const props = (def.input_schema.properties ?? {}) as Record<string, { type?: string; maxLength?: number; description?: string }>;
      for (const [field, p] of Object.entries(props)) {
        if (p.type === "string" && (p.maxLength ?? 0) >= 500 && !p.description?.includes(String(p.maxLength))) {
          missing.push(`${def.name}.${field} (max ${p.maxLength})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
