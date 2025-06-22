import { createClient } from "gel";
import type { Client } from "gel";
import { BM25 } from "../utils/bm25";
import type { MemoryConfig, GelGraphConfig, GraphRelation } from "../types";
import { EmbedderFactory, LLMFactory } from "../utils/factory";
import { Embedder } from "../embeddings/base";
import { LLM } from "../llms/base";
import {
  DELETE_MEMORY_TOOL_GRAPH,
  EXTRACT_ENTITIES_TOOL,
  RELATIONS_TOOL,
  CLASSIFY_PRIVACY_TOOL,
} from "../graphs/tools";
import {
  EXTRACT_RELATIONS_PROMPT,
  getDeleteMessages,
  IS_PRIVATE_PROMPT,
} from "../graphs/utils";
import { logger } from "../utils/logger";

interface SearchOutput {
  source: string;
  source_id: string;
  relationship: string;
  relation_id: string;
  destination: string;
  destination_id: string;
  similarity: number;
  metadata?: Record<string, any>;
}

interface ToolCall {
  name: string;
  arguments: string;
}

interface Tool {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

interface GraphMemoryResult {
  deleted_entities: any[];
  added_entities: any[];
  relations?: any[];
}

export class GelMemoryGraph {
  private config: MemoryConfig;
  private client: Client;
  private embeddingModel: Embedder;
  private llm: LLM;
  private structuredLlm: LLM;
  private llmProvider: string;
  private threshold: number;
  private collectionName: string;
  private dimension: number;

  constructor(config: MemoryConfig) {
    this.config = config;

    // Initialize Gel client with proper type guarding
    const gelConfig = config.graphStore?.config as GelGraphConfig;
    if (!gelConfig) {
      throw new Error("GEL graph store configuration is required");
    }

    this.client = createClient();

    // Parse collection name with namespace support
    this.collectionName = gelConfig.collectionName || "DefaultGraphMemories";

    this.dimension = gelConfig.dimension || 1536;

    this.embeddingModel = EmbedderFactory.create(
      this.config.embedder.provider,
      this.config.embedder.config,
    );

    this.llmProvider = "openai";
    if (this.config.llm?.provider) {
      this.llmProvider = this.config.llm.provider;
    }
    if (this.config.graphStore?.llm?.provider) {
      this.llmProvider = this.config.graphStore.llm.provider;
    }

    this.llm = LLMFactory.create(this.llmProvider, this.config.llm.config);
    this.structuredLlm = LLMFactory.create(
      "openai_structured",
      this.config.llm.config,
    );
    this.threshold = 0.7;

    // Initialize and validate schema
    this.initialize().catch((error) => {
      throw error;
    });
  }

  async initialize(): Promise<void> {
    try {
      // Validate the graph schema exists
      await this.validateGraphSchema();
    } catch (error) {
      throw error;
    }
  }

  private async validateGraphSchema(): Promise<void> {
    // Check if the graph entity and relation types exist
    await this.validateGraphEntityType();
    await this.validateGraphRelationType();
  }

  private async validateGraphEntityType(): Promise<void> {
    const entityTypeName = `${this.collectionName}GraphEntity`;

    try {
      const schemaInfo = await this.client.query<{
        name: string;
        properties: {
          name: string;
          target: {
            name: string;
          } | null;
        }[];
      }>(`
        SELECT schema::ObjectType {
          name,
          properties: {
            name,
            target: {
              name
            }
          }
        }
        FILTER .name = "${entityTypeName}"
      `);

      if (!schemaInfo || schemaInfo.length === 0) {
        throw new Error(
          `Graph schema error: The '${entityTypeName}' type does not exist in the database. ` +
            `Please ensure your EdgeDB schema includes the graph entity type. ` +
            `Expected schema should include:\n` +
            `- GraphEntity type with properties: name, entity_type, user_id, embedding, created_at\n` +
            `- Vector index on the embedding property using ext::pgvector::hnsw_cosine\n` +
            `- Unique constraint on (name, user_id)\n\n` +
            `Example schema:\n` +
            `type ${entityTypeName} extending GraphEntityImpl;\n` +
            `\n` +
            `Where GraphEntityImpl is defined as:\n` +
            `abstract type GraphEntityImpl {\n` +
            `  required name: str;\n` +
            `  required entity_type: str;\n` +
            `  required user_id: str;\n` +
            `  required embedding: OpenAIEmbedding;\n` +
            `  required created_at: datetime { default := datetime_current() };\n` +
            `  optional updated_at: datetime;\n` +
            `  constraint exclusive on ((.name, .user_id));\n` +
            `  index ext::pgvector::hnsw_cosine on (.embedding);\n` +
            `}`,
        );
      }

      // Validate required properties exist
      const entityType = schemaInfo[0];
      const requiredProps = [
        "name",
        "entity_type",
        "user_id",
        "embedding",
        "created_at",
      ];

      for (const propName of requiredProps) {
        const prop = entityType.properties.find((p) => p.name === propName);
        if (!prop) {
          throw new Error(
            `Graph schema error: The '${entityTypeName}' type is missing the required '${propName}' property. ` +
              `Please ensure your schema includes all required properties for graph entities.`,
          );
        }
      }

      // Validate embedding property type
      const embeddingProp = entityType.properties.find(
        (p) => p.name === "embedding",
      );
    } catch (error: any) {
      if (error.message.includes("Graph schema error:")) {
        throw error;
      }
      throw new Error(
        `Graph connection or query error: ${error.message}. ` +
          `Please ensure EdgeDB is running and accessible, and the graph schema has been applied.`,
      );
    }
  }

  private async validateGraphRelationType(): Promise<void> {
    const relationTypeName = `${this.collectionName}GraphRelation`;

    try {
      const schemaInfo = await this.client.query<{
        name: string;
        properties: {
          name: string;
          target: {
            name: string;
          } | null;
        }[];
      }>(`
        SELECT schema::ObjectType {
          name,
          properties: {
            name,
            target: {
              name
            }
          }
        }
        FILTER .name = "${relationTypeName}"
      `);

      if (!schemaInfo || schemaInfo.length === 0) {
        throw new Error(
          `Graph schema error: The '${relationTypeName}' type does not exist in the database. ` +
            `Please ensure your EdgeDB schema includes the graph relation type. ` +
            `Expected schema should include:\n` +
            `- GraphRelation type with properties: source, target, relationship_type, created_at\n` +
            `- Unique constraint on (source, target, relationship_type)\n\n` +
            `Example schema:\n` +
            `type ${relationTypeName} extending GraphRelationImpl {\n` +
            `  source: ${this.collectionName}GraphEntity;\n` +
            `  target: ${this.collectionName}GraphEntity;\n` +
            `};\n` +
            `\n` +
            `Where GraphRelationImpl is defined as:\n` +
            `abstract type GraphRelationImpl {\n` +
            `  required source: GraphEntityImpl;\n` +
            `  required target: GraphEntityImpl;\n` +
            `  required relationship_type: str;\n` +
            `  required created_at: datetime { default := datetime_current() };\n` +
            `  optional updated_at: datetime;\n` +
            `  constraint exclusive on ((.source, .target, .relationship_type));\n` +
            `}`,
        );
      }
    } catch (error: any) {
      if (error.message.includes("Graph schema error:")) {
        throw error;
      }
      throw new Error(
        `Graph connection or query error: ${error.message}. ` +
          `Please ensure EdgeDB is running and accessible, and the graph schema has been applied.`,
      );
    }
  }

  async add(
    data: string,
    filters: Record<string, any>,
  ): Promise<GraphMemoryResult> {
    const entityTypeMap = await this._retrieveNodesFromData(data, filters);
    const toBeAdded = await this._establishNodesRelationsFromData(
      data,
      filters,
      entityTypeMap,
    );
    const searchOutput = await this._searchGraphDb(
      Object.keys(entityTypeMap),
      filters,
    );
    const toBeDeleted = await this._getDeleteEntitiesFromSearchOutput(
      searchOutput,
      data,
      filters,
    );
    const deletedEntities = await this._deleteEntities(
      toBeDeleted,
      filters["userId"],
    );
    const addedEntities = await this._addEntities(
      toBeAdded,
      filters["userId"],
      entityTypeMap,
    );
    return {
      deleted_entities: deletedEntities,
      added_entities: addedEntities,
      relations: toBeAdded,
    };
  }

  async search(
    query: string,
    filters: Record<string, any>,
    limit = 100,
  ): Promise<GraphRelation[]> {
    const entityTypeMap = await this._retrieveNodesFromData(query, filters);
    const searchOutput = await this._searchGraphDb(
      Object.keys(entityTypeMap),
      filters,
    );

    if (!searchOutput.length) {
      return [];
    }

    // Filter out private relations if filterPrivate is true (default false)
    const filteredOutput =
      filters.filterPrivate === true
        ? searchOutput.filter((item) => !item.metadata.isPrivate)
        : searchOutput;

    const searchOutputsSequence = filteredOutput.map((item) => [
      item.source,
      item.relationship,
      item.destination,
    ]);

    const bm25 = new BM25(searchOutputsSequence);
    const tokenizedQuery = query.split(" ");
    const rerankedResults = bm25.search(tokenizedQuery).slice(0, 5);

    const searchResults = rerankedResults.map((item) => ({
      source: item[0],
      relationship: item[1],
      destination: item[2],
    }));

    logger.info(`Returned ${searchResults.length} search results`);
    return searchResults;
  }

  async deleteAll(filters: Record<string, any>) {
    // First delete all relationships for this user
    const deleteRelationsQuery = `
      delete ${this.collectionName}GraphRelation
      filter .source.user_id = <str>$user_id or .target.user_id = <str>$user_id
    `;

    await this.client.query(deleteRelationsQuery, {
      user_id: filters["userId"],
    });

    // Then delete all entities for this user
    const deleteEntitiesQuery = `
      delete ${this.collectionName}GraphEntity
      filter .user_id = <str>$user_id
    `;

    await this.client.query(deleteEntitiesQuery, {
      user_id: filters["userId"],
    });
  }

  async getAll(filters: Record<string, any>, limit = 100) {
    const query = `
      select ${this.collectionName}GraphEntity {
        name,
        entity_type,
        out_relations := .<source[is ${this.collectionName}GraphRelation] {
          relationship_type,
          metadata,
          target: { name }
        }
      }
      filter .user_id = <str>$user_id
      limit <int64>$limit
    `;

    const result = await this.client.query(query, {
      user_id: filters["userId"],
      limit: limit,
    });

    const finalResults: Array<{
      source: string;
      relationship: string;
      target: string;
    }> = [];

    for (const entity of result as any[]) {
      for (const relation of entity.out_relations || []) {
        // Filter out private relations if filterPrivate is true (default false)
        if (filters.filterPrivate === true && relation.metadata?.isPrivate) {
          continue;
        }

        finalResults.push({
          source: entity.name,
          relationship: relation.relationship_type,
          target: relation.target.name,
        });
      }
    }

    logger.info(`Retrieved ${finalResults.length} relationships`);
    return finalResults;
  }

  private async _retrieveNodesFromData(
    data: string,
    filters: Record<string, any>,
  ) {
    const tools = [EXTRACT_ENTITIES_TOOL] as Tool[];
    const searchResults = await this.structuredLlm.generateResponse(
      [
        {
          role: "system",
          content: `You are a smart assistant who understands entities and their types in a given text. If user message contains self reference such as 'I', 'me', 'my' etc. then use ${filters["userId"]} as the source entity. Extract all the entities from the text. ***DO NOT*** answer the question itself if the given text is a question.`,
        },
        { role: "user", content: data },
      ],
      { type: "json_object" },
      tools,
    );

    let entityTypeMap: Record<string, string> = {};
    try {
      if (typeof searchResults !== "string" && searchResults.toolCalls) {
        for (const call of searchResults.toolCalls) {
          if (call.name === "extract_entities") {
            const args = JSON.parse(call.arguments);
            for (const item of args.entities) {
              entityTypeMap[item.entity] = item.entity_type;
            }
          }
        }
      }
    } catch (e) {
      logger.error(`Error in search tool: ${e}`);
    }

    entityTypeMap = Object.fromEntries(
      Object.entries(entityTypeMap).map(([k, v]) => [
        k.toLowerCase().replace(/ /g, "_"),
        v.toLowerCase().replace(/ /g, "_"),
      ]),
    );

    logger.debug(`Entity type map: ${JSON.stringify(entityTypeMap)}`);
    return entityTypeMap;
  }

  private async _establishNodesRelationsFromData(
    data: string,
    filters: Record<string, any>,
    entityTypeMap: Record<string, string>,
  ) {
    let messages;
    if (this.config.graphStore?.customPrompt) {
      const systemContent =
        EXTRACT_RELATIONS_PROMPT.replace("USER_ID", filters["userId"]).replace(
          "CUSTOM_PROMPT",
          `4. ${this.config.graphStore.customPrompt}`,
        ) + "\nPlease provide your response in JSON format.";

      messages = [
        {
          role: "system",
          content: systemContent,
        },
        { role: "user", content: data },
      ];
    } else {
      const systemContent =
        EXTRACT_RELATIONS_PROMPT.replace("USER_ID", filters["userId"]) +
        "\nPlease provide your response in JSON format.";
      const userContent = `List of entities: ${Object.keys(entityTypeMap)}. \n\nText: ${data}`;

      messages = [
        {
          role: "system",
          content: systemContent,
        },
        {
          role: "user",
          content: userContent,
        },
      ];
    }

    const tools = [RELATIONS_TOOL] as Tool[];
    const extractedEntities = await this.structuredLlm.generateResponse(
      messages,
      { type: "json_object" },
      tools,
    );

    let entities: any[] = [];
    if (typeof extractedEntities !== "string" && extractedEntities.toolCalls) {
      const toolCall = extractedEntities.toolCalls[0];
      if (toolCall && toolCall.arguments) {
        const args = JSON.parse(toolCall.arguments);
        entities = args.entities || [];
      }
    }

    entities = this._removeSpacesFromEntities(entities);

    // Add privacy metadata to each relation using IS_PRIVATE_PROMPT
    const entitiesWithPrivacy = await this._checkRelationsPrivacy(entities);

    logger.debug(`Extracted entities: ${JSON.stringify(entitiesWithPrivacy)}`);
    return entitiesWithPrivacy;
  }

  private async _searchGraphDb(
    nodeList: string[],
    filters: Record<string, any>,
    limit = 100,
  ): Promise<SearchOutput[]> {
    const resultRelations: SearchOutput[] = [];

    for (const node of nodeList) {
      let nEmbedding: number[];
      try {
        // Add 30 second timeout for embedding requests
        nEmbedding = await Promise.race([
          this.embeddingModel.embed(node),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Embedding timeout")), 10000),
          ),
        ]);
      } catch (error) {
        continue; // Skip this node and continue with the next one
      }

      // EdgeQL query for similarity search with relationships
      const query = `
        with 
          query_embedding := <array<float32>>$n_embedding,
          similar_entities := (
            select ${this.collectionName}GraphEntity {
              id,
              name,
              entity_type,
              embedding,
              user_id,
              cosine_similarity := ext::pgvector::cosine_distance(.embedding, <mem0::OpenAIEmbedding>query_embedding)
            }
            filter .user_id = <str>$user_id and exists .embedding
          )
        select similar_entities {
          id,
          name,
          entity_type,
          cosine_similarity,
          out_relations := .<source[is ${this.collectionName}GraphRelation] {
            id,
            relationship_type,
            target: { id, name },
            metadata
          },
          in_relations := .<target[is ${this.collectionName}GraphRelation] {
            id,
            relationship_type,
            source: { id, name },
            metadata
          }
        }
        filter .cosine_similarity >= <float32>$threshold
        order by .cosine_similarity desc
        limit <int64>$limit
      `;

      const result = await this.client.query(query, {
        n_embedding: nEmbedding,
        threshold: this.threshold,
        user_id: filters["userId"],
        limit: limit,
      });

      // Process outgoing relationships
      for (const entity of result as any[]) {
        for (const relation of entity.out_relations || []) {
          resultRelations.push({
            source: entity.name,
            source_id: entity.id,
            relationship: relation.relationship_type,
            relation_id: relation.id,
            destination: relation.target.name,
            destination_id: relation.target.id,
            similarity: entity.cosine_similarity,
            metadata: relation.metadata,
          });
        }

        // Process incoming relationships
        for (const relation of entity.in_relations || []) {
          resultRelations.push({
            source: relation.source.name,
            source_id: relation.source.id,
            relationship: relation.relationship_type,
            relation_id: relation.id,
            destination: entity.name,
            destination_id: entity.id,
            similarity: entity.cosine_similarity,
            metadata: relation.metadata,
          });
        }
      }
    }

    return resultRelations;
  }

  private async _getDeleteEntitiesFromSearchOutput(
    searchOutput: SearchOutput[],
    data: string,
    filters: Record<string, any>,
  ) {
    const searchOutputString = searchOutput
      .map(
        (item) =>
          `${item.source} -- ${item.relationship} -- ${item.destination}`,
      )
      .join("\n");

    let systemPrompt: string;
    let userPrompt: string;

    if (this.config.graphStore?.customDeletePrompt) {
      // Use custom delete prompt
      systemPrompt = this.config.graphStore.customDeletePrompt.replace(
        "USER_ID",
        filters["userId"],
      );
      userPrompt = `Here are the existing memories: ${searchOutputString} \n\n New Information: ${data}`;
    } else {
      // Use default delete prompt
      [systemPrompt, userPrompt] = getDeleteMessages(
        searchOutputString,
        data,
        filters["userId"],
      );
    }

    const tools = [DELETE_MEMORY_TOOL_GRAPH] as Tool[];
    const memoryUpdates = await this.structuredLlm.generateResponse(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { type: "json_object" },
      tools,
    );

    const toBeDeleted: any[] = [];
    if (typeof memoryUpdates !== "string" && memoryUpdates.toolCalls) {
      for (const item of memoryUpdates.toolCalls) {
        if (item.name === "delete_graph_memory") {
          toBeDeleted.push(JSON.parse(item.arguments));
        }
      }
    }

    const cleanedToBeDeleted = this._removeSpacesFromEntities(toBeDeleted);
    logger.debug(
      `Deleted relationships: ${JSON.stringify(cleanedToBeDeleted)}`,
    );
    return cleanedToBeDeleted;
  }

  private async _deleteEntities(toBeDeleted: any[], userId: string) {
    const results: any[] = [];

    for (const item of toBeDeleted) {
      const { source, destination, relationship } = item;

      const query = `
        delete ${this.collectionName}GraphRelation
        filter 
          .source.name = <str>$source_name and
          .target.name = <str>$dest_name and
          .relationship_type = <str>$relationship and
          .source.user_id = <str>$user_id and
          .target.user_id = <str>$user_id
      `;

      const result = await this.client.query(query, {
        source_name: source,
        dest_name: destination,
        relationship: relationship,
        user_id: userId,
      });

      results.push(result);
    }

    return results;
  }

  private async _addEntities(
    toBeAdded: any[],
    userId: string,
    entityTypeMap: Record<string, string>,
  ) {
    const results: any[] = [];

    for (const item of toBeAdded) {
      const { source, destination, relationship, metadata } = item;
      const sourceType = entityTypeMap[source] || "known";
      const destinationType = entityTypeMap[destination] || "unknown";

      let sourceEmbedding: number[];
      let destEmbedding: number[];
      try {
        // Add 30 second timeout for embedding requests
        [sourceEmbedding, destEmbedding] = await Promise.all([
          Promise.race([
            this.embeddingModel.embed(source),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("Source embedding timeout")),
                10000,
              ),
            ),
          ]),
          Promise.race([
            this.embeddingModel.embed(destination),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("Destination embedding timeout")),
                10000,
              ),
            ),
          ]),
        ]);
      } catch (error) {
        continue; // Skip this relationship and continue with the next one
      }

      // Create or get source entity
      const sourceQuery = `
        with existing := (
          select ${this.collectionName}GraphEntity
          filter .name = <str>$source_name and .user_id = <str>$user_id
        )
        select (
          (insert ${this.collectionName}GraphEntity {
            name := <str>$source_name,
            entity_type := <str>$source_type,
            embedding := <array<float32>>$source_embedding,
            user_id := <str>$user_id,
            created_at := datetime_current()
          })
          if not exists existing
          else (
            update existing
            set {
              embedding := <array<float32>>$source_embedding,
              updated_at := datetime_current()
            }
          )
        )

      `;

      // const sourceResult = await this.client.query(sourceQuery, {
      //   source_name: source,
      //   source_type: sourceType,
      //   source_embedding: sourceEmbedding,
      //   user_id: userId,
      // });

      // Create or get destination entity
      const destQuery = `
        with existing := (
          select ${this.collectionName}GraphEntity
          filter .name = <str>$dest_name and .user_id = <str>$user_id
        )
        select (
          (insert ${this.collectionName}GraphEntity {
            name := <str>$dest_name,
            entity_type := <str>$dest_type,
            embedding := <array<float32>>$dest_embedding,
            user_id := <str>$user_id,
            created_at := datetime_current()
          })
          if not exists existing
          else (
            update existing
            set {
              embedding := <array<float32>>$dest_embedding,
              updated_at := datetime_current()
            }
          )
        )`;

      // const destResult = await this.client.query(destQuery, {
      //   dest_name: destination,
      //   dest_type: destinationType,
      //   dest_embedding: destEmbedding,
      //   user_id: userId,
      // });

      // Create relationship
      const relationQuery = `
        with
          source_entity := (${sourceQuery}),
          dest_entity := (${destQuery}),
          existing := (
            select ${this.collectionName}GraphRelation
            filter .source = source_entity
              and .target = dest_entity
              and .relationship_type = <str>$relationship
          ),
          relationship := (
            select (
              (insert ${this.collectionName}GraphRelation {
                source := source_entity,
                target := dest_entity,
                relationship_type := <str>$relationship,
                metadata := <optional json>$metadata,
                created_at := datetime_current()
              })
              if not exists existing
              else (select existing)
            )
          )
        select {
          source := source_entity,
          destination := dest_entity,
          relationship := relationship
        }
      `;

      try {
        const result = await this.client.query(relationQuery, {
          source_name: source,
          source_type: sourceType,
          source_embedding: sourceEmbedding,
          dest_name: destination,
          dest_type: destinationType,
          dest_embedding: destEmbedding,
          relationship: relationship,
          metadata: metadata,
          user_id: userId,
        });
        results.push(result);
      } catch (error) {
        throw error;
      }
    }

    return results;
  }

  private async _checkRelationsPrivacy(entities: any[]): Promise<any[]> {
    if (!entities.length) return entities;

    try {
      // Format entities for IS_PRIVATE_PROMPT
      const relationObjects = entities.map((entity) => ({
        source: entity.source,
        relation: entity.relationship,
        target: entity.destination,
      }));

      const response = await this.structuredLlm.generateResponse(
        [
          {
            role: "user",
            content: `${IS_PRIVATE_PROMPT}\n\nRelations to classify: ${JSON.stringify(relationObjects)}`,
          },
        ],
        { type: "json_object" },
        [CLASSIFY_PRIVACY_TOOL],
      );

      let classifiedRelations = [];
      if (typeof response !== "string" && response.toolCalls) {
        const toolCall = response.toolCalls[0];
        if (toolCall && toolCall.arguments) {
          const args = JSON.parse(toolCall.arguments);
          classifiedRelations = args.relations || [];
        }
      }

      // Add metadata to original entities
      return entities.map((entity, index) => {
        const classified = classifiedRelations[index];
        return {
          ...entity,
          metadata: { isPrivate: classified?.isPrivate || false },
        };
      });
    } catch (error) {
      logger.error(`Error checking privacy for relations: ${error}`);
      // Default to public if error
      return entities.map((entity) => ({
        ...entity,
        metadata: { isPrivate: false },
      }));
    }
  }

  private _removeSpacesFromEntities(entityList: any[]) {
    return entityList.map((item) => ({
      ...item,
      source: item.source.toLowerCase().replace(/ /g, "_"),
      relationship: item.relationship.toLowerCase().replace(/ /g, "_"),
      destination: item.destination.toLowerCase().replace(/ /g, "_"),
    }));
  }
}
