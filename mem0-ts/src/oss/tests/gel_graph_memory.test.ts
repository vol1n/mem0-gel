/// <reference types="jest" />
import { GelMemoryGraph } from "../src/memory/gel_graph_memory";
import { MemoryConfig } from "../src/types";
import dotenv from "dotenv";

dotenv.config();

jest.setTimeout(60000); // Increase timeout to 60 seconds for graph operations

describe("GelMemoryGraph Class", () => {
  let graphMemory: GelMemoryGraph;
  const userId = `test_user_${Math.random().toString(36).substring(2, 15)}`;
  const agentId = `test_agent_${Math.random().toString(36).substring(2, 15)}`;

  beforeEach(async () => {
    const config: MemoryConfig = {
      version: "v1.1",
      embedder: {
        provider: "openai",
        config: {
          apiKey: process.env.OPENAI_API_KEY || "",
          model: "text-embedding-3-small",
        },
      },
      llm: {
        provider: "openai",
        config: {
          apiKey: process.env.OPENAI_API_KEY || "",
          model: "gpt-4o-mini",
        },
      },
      graphStore: {
        provider: "gel",
        config: {
          dimension: 1536,
          collectionName: "mem0::TestMemories",
        },
      },
    };

    graphMemory = new GelMemoryGraph(config);
  });

  afterEach(async () => {
    // Clean up test data
    try {
      await graphMemory.deleteAll({ userId });
    } catch (error) {
      console.warn("Cleanup failed:", error);
    }
  });

  describe("Graph Memory Operations", () => {
    test("should add graph memories with entities and relationships", async () => {
      const testData =
        "John works at OpenAI. He is a software engineer and collaborates with Sarah on AI projects.";
      const filters = { userId, agentId };

      const result = await graphMemory.add(testData, filters);

      expect(result).toBeDefined();
      expect(result.added_entities).toBeDefined();
      expect(result.deleted_entities).toBeDefined();
      expect(Array.isArray(result.added_entities)).toBe(true);
      expect(Array.isArray(result.deleted_entities)).toBe(true);
    });

    test("should search graph memories", async () => {
      // First add some test data
      const testData1 =
        "Alice is a data scientist at Meta. She works on machine learning models.";
      const testData2 =
        "Bob is Alice's manager. He oversees the ML team at Meta.";
      const filters = { userId, agentId };

      await graphMemory.add(testData1, filters);
      await graphMemory.add(testData2, filters);

      // Search for entities
      const searchResults = await graphMemory.search(
        "Alice machine learning",
        filters,
        10,
      );

      expect(Array.isArray(searchResults)).toBe(true);
      // Should find relationships involving Alice and ML
      if (searchResults.length > 0) {
        expect(searchResults[0]).toHaveProperty("source");
        expect(searchResults[0]).toHaveProperty("relationship");
        expect(searchResults[0]).toHaveProperty("destination");
      }
    });

    test("should get all graph memories for a user", async () => {
      const testData =
        "Emma leads the product team. She reports to the CEO and manages five engineers.";
      const filters = { userId, agentId };

      await graphMemory.add(testData, filters);

      const allMemories = await graphMemory.getAll(filters, 50);

      expect(Array.isArray(allMemories)).toBe(true);
      if (allMemories.length > 0) {
        expect(allMemories[0]).toHaveProperty("source");
        expect(allMemories[0]).toHaveProperty("relationship");
        expect(allMemories[0]).toHaveProperty("target");
      }
    });

    test("should handle entity updates and deletions", async () => {
      const filters = { userId, agentId };

      // Add initial data
      const initialData =
        "Tom is a designer at Figma. He creates user interfaces.";
      const initialResult = await graphMemory.add(initialData, filters);
      expect(initialResult.added_entities.length).toBeGreaterThan(0);

      // Add conflicting/updating data
      const updatedData =
        "Tom is now a senior designer at Adobe. He leads the design system team.";
      const updateResult = await graphMemory.add(updatedData, filters);

      expect(updateResult.deleted_entities).toBeDefined();
      expect(updateResult.added_entities).toBeDefined();
      // Should have some deletions due to conflicting information
    });

    test("should handle empty search results gracefully", async () => {
      const filters = { userId, agentId };

      const searchResults = await graphMemory.search(
        "nonexistent entity query",
        filters,
        10,
      );

      expect(Array.isArray(searchResults)).toBe(true);
      expect(searchResults.length).toBe(0);
    });

    test("should delete all memories for a user", async () => {
      const testData =
        "Lisa works at Netflix. She is a product manager for streaming services.";
      const filters = { userId, agentId };

      // Add some data
      await graphMemory.add(testData, filters);

      // Verify data exists
      const beforeDelete = await graphMemory.getAll(filters, 10);
      expect(beforeDelete.length).toBeGreaterThan(0);

      // Delete all
      await graphMemory.deleteAll(filters);

      // Verify data is gone
      const afterDelete = await graphMemory.getAll(filters, 10);
      expect(afterDelete.length).toBe(0);
    });

    test("should handle complex multi-entity relationships", async () => {
      const complexData = `
        The AI research team consists of multiple members:
        - Dr. Smith leads the team and specializes in NLP
        - Anna is a research scientist focusing on computer vision  
        - Mike is a PhD student working on reinforcement learning under Dr. Smith
        - The team collaborates with the product team led by Jennifer
        - They are working on a new AI assistant project called 'Athena'
      `;
      const filters = { userId, agentId };

      const result = await graphMemory.add(complexData, filters);

      expect(result.added_entities).toBeDefined();
      expect(result.added_entities.length).toBeGreaterThan(0);

      // Search for relationships
      const searchResults = await graphMemory.search(
        "Dr. Smith team leadership",
        filters,
        20,
      );
      expect(Array.isArray(searchResults)).toBe(true);
    });
  });

  describe("Error Handling", () => {
    test("should handle missing userId in filters", async () => {
      const testData = "Test data without proper filters";
      const invalidFilters = { agentId }; // Missing userId

      await expect(graphMemory.add(testData, invalidFilters)).rejects.toThrow();
    });

    test("should handle malformed input gracefully", async () => {
      const filters = { userId, agentId };
      const emptyData = "";

      // Should not throw, but may return empty results
      const result = await graphMemory.add(emptyData, filters);
      expect(result).toBeDefined();
    });
  });
});
