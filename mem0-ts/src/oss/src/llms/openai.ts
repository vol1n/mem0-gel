import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { LLM, LLMResponse } from "./base";
import { LLMConfig, Message } from "../types";

export class OpenAILLM implements LLM {
  private openai: OpenAI;
  private model: string;

  constructor(config: LLMConfig) {
    this.openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.model = config.model || "gpt-4o-mini";
  }

  async generateResponse(
    messages: Message[],
    responseFormat?: { type: string },
    tools?: any[],
  ): Promise<string | LLMResponse> {
    try {
      const openaiMessages: ChatCompletionMessageParam[] = messages.map(
        (msg) => {
          // Transform content to OpenAI format
          if (typeof msg.content === "string") {
            // Text only
            return {
              role: msg.role as "system" | "user" | "assistant",
              content: msg.content,
            };
          } else {
            // Image content - only user messages can have multimodal content
            return {
              role: "user" as const,
              content: [
                {
                  type: "image_url" as const,
                  image_url: {
                    url: msg.content.image_url.url,
                  },
                },
              ],
            };
          }
        },
      );

      const completion = await this.openai.chat.completions.create({
        messages: openaiMessages,
        model: this.model,
        response_format: responseFormat as { type: "text" | "json_object" },
        ...(tools && { tools, tool_choice: "auto" }),
      });

      const response = completion.choices[0].message;

      console.log(JSON.stringify(response, null, 2));

      if (response.tool_calls) {
        const result = {
          content: response.content || "",
          role: response.role,
          toolCalls: response.tool_calls.map((call) => ({
            name: call.function.name,
            arguments: call.function.arguments,
          })),
        };
        console.log(JSON.stringify(result, null, 2));
        return result;
      }
      return response.content || "";
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new Error(`OpenAI API request failed: ${err.message}`);
    }
  }

  async generateChat(messages: Message[]): Promise<LLMResponse> {
    const completion = await this.openai.chat.completions.create({
      messages: messages.map((msg) => {
        const role = msg.role as "system" | "user" | "assistant";
        return {
          role,
          content:
            typeof msg.content === "string"
              ? msg.content
              : JSON.stringify(msg.content),
        };
      }),
      model: this.model,
    });
    const response = completion.choices[0].message;
    return {
      content: response.content || "",
      role: response.role,
    };
  }
}
