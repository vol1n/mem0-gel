import { VectorStore } from "./base";
import { SearchFilters, VectorStoreConfig, VectorStoreResult } from "../types";
import { createClient } from "gel";
import type { Client } from "gel";

interface GelConfig extends VectorStoreConfig {
  dimension: number;
  client?: Client;
  dsn?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  tlsCaFile?: string;
  tlsSecurity?: string;
}

interface OutputData {
  id?: string;
  score?: number;
  payload?: Record<string, any>;
}

export class Gel implements VectorStore {
  private client: Client;
  private namespace: string;
  private memoryTypeName: string;
  private collectionName: string;
  private fullyQualifiedType: string;
  private embeddingModelDims: number;

  constructor(config: GelConfig) {
    const collectionName = config.collectionName || "memories";
    this.embeddingModelDims = config.dimension;

    // Parse collection_name to determine namespace and type
    if (collectionName.includes("::")) {
      const [namespace, memoryTypeName] = collectionName.split("::", 2);
      this.namespace = namespace;
      this.memoryTypeName = memoryTypeName;
    } else {
      // Default to mem0 namespace for simple names
      this.namespace = "mem0";
      // Handle special cases
      if (collectionName === "mem0migrations") {
        this.memoryTypeName = "Migration";
      } else {
        this.memoryTypeName = collectionName;
      }
    }

    this.fullyQualifiedType = `${this.namespace}::${this.memoryTypeName}`;
    this.collectionName = this.fullyQualifiedType;

    if (config.client) {
      this.client = config.client;
    } else {
      // Build connection parameters
      const connectParams: Record<string, any> = {};
      if (config.dsn) {
        connectParams.dsn = config.dsn;
      } else {
        if (config.host) connectParams.host = config.host;
        if (config.port) connectParams.port = config.port;
        if (config.database) connectParams.database = config.database;
        if (config.user) connectParams.user = config.user;
        if (config.password) connectParams.password = config.password;
        if (config.tlsCaFile) connectParams.tls_ca_file = config.tlsCaFile;
        if (config.tlsSecurity) connectParams.tls_security = config.tlsSecurity;
      }

      this.client = createClient({
        dsn: config.dsn,
      });
    }
  }

  async initialize(): Promise<void> {
    try {
      // Create mem0::Migration type equivalent for telemetry (like memory_migrations table)
      // This follows the same pattern as pgvector but adapted for EdgeDB
      await this.createMigrationType();

      // Validate the main schema
      await this.createCol(this.fullyQualifiedType, this.embeddingModelDims);
    } catch (error) {
      throw error;
    }
  }

  private async createMigrationType(): Promise<void> {
    // Check if mem0::Migration type exists (equivalent to memory_migrations table)
    try {
      const migrationTypeInfo = await this.client.query<{
        name: string;
      }>(`
        SELECT schema::ObjectType {
          name
        }
        FILTER .name = "mem0::Migration"
      `);

      if (!migrationTypeInfo || migrationTypeInfo.length === 0) {
        // Migration type not found - schema should include this type for telemetry
      }
    } catch (error: any) {
      // Could not check for mem0::Migration type
    }
  }

  private async listCols(): Promise<string[]> {
    try {
      // Query for all ObjectTypes that have the required memory schema properties
      const typesInfo = await this.client.query<{
        name: string;
      }>(`
        SELECT schema::ObjectType {
          name
        }
        FILTER any(.properties.name = 'embedding')
          AND any(.properties.name = 'content')
          AND any(.properties.name = 'hash')
          AND any(.properties.name = 'created_at')
      `);
      return typesInfo.map((typeInfo) => typeInfo.name);
    } catch (error: any) {
      return [this.fullyQualifiedType];
    }
  }

  private async createCol(
    name: string,
    vectorSize: number,
    distance: string = "cosine",
  ): Promise<void> {
    // Use introspection to check if the type exists
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
        FILTER .name = "${this.fullyQualifiedType}"
      `);

      if (!schemaInfo || schemaInfo.length === 0) {
        if (this.fullyQualifiedType.includes("Migration")) {
          throw new Error(
            "If you are using MEM0_TELEMETRY on, please create a Migration type in your schema as follows: " +
              "Expected schema should include:\n" +
              "- Vector index on the embedding property using ext::pgvector::HNSW\n" +
              "- Properties: id, content, embedding, hash, created_at, etc.",
          );
        }
        throw new Error(
          `Gel schema error: The '${this.fullyQualifiedType}' type does not exist in the database. ` +
            `Please ensure you have migrated the schema to your Gel instance. ` +
            `Expected schema should include:\n` +
            `- Vector index on the embedding property using ext::pgvector::HNSW\n` +
            `- Properties: id, content, embedding, hash, created_at, etc.`,
        );
      }

      // Check if Memory type has embedding property
      const memoryType = schemaInfo[0];
      const embeddingProp = memoryType.properties.find(
        (prop) => prop.name === "embedding",
      );

      if (!embeddingProp) {
        throw new Error(
          `Gel schema error: The '${this.fullyQualifiedType}' type exists but is missing the 'embedding' property. ` +
            `Please ensure the schema includes an 'embedding' property of type ext::pgvector::vector<1536>.`,
        );
      }

      // Verify embedding property is correct type
      if (
        !embeddingProp.target ||
        embeddingProp.target.name != "array<float32>"
      ) {
        throw new Error(
          `Gel schema error: The 'embedding' property on '${this.fullyQualifiedType}' should be of type array<float32>, ` +
            `but found: ${embeddingProp.target?.name || "unknown type"}.`,
        );
      }
    } catch (error: any) {
      throw new Error(
        `Gel connection or query error: ${error.message}. ` +
          `Please ensure Gel is running and accessible, and the schema has been applied.`,
      );
    }

    // Gel collections are implicit - collection is ready once schema is verified
  }

  async insert(
    vectors: number[][],
    ids: string[],
    payloads: Record<string, any>[],
  ): Promise<void> {
    if (!vectors || vectors.length === 0) {
      return;
    }

    // Prepare data for bulk insert
    const bulkData = vectors.map((vector, i) => {
      const payload = payloads[i] || {};
      // Extract known fields
      const {
        data,
        hash,
        userId,
        agentId,
        runId,
        actorId,
        role,
        memoryType,
        createdAt,
        updatedAt,
        ...otherMetadata
      } = payload;

      return {
        id: ids[i] || null,
        content: data || "",
        embedding: vector,
        hash: hash || "",
        user_id: userId || null,
        agent_id: agentId || null,
        run_id: runId || null,
        actor_id: actorId || null,
        role: role || null,
        memory_type: memoryType || null,
        // Store all other fields (including isPrivate) as metadata
        metadata: Object.keys(otherMetadata).length > 0 ? otherMetadata : null,
      };
    });

    // Bulk insert query
    const query = `
      with
      raw_data := <json>$data,
      for item in <json>json_array_unpack(raw_data) union (
      insert ${this.fullyQualifiedType} {
      mem0_id := <str>item['id'],
      content := <str>item['content'],
      embedding := <mem0::OpenAIEmbedding>item['embedding'],
      hash := <str>item['hash'],
      created_at := datetime_current(),
      user_id := <optional str>item['user_id'],
      agent_id := <optional str>item['agent_id'],
      run_id := <optional str>item['run_id'],
      actor_id := <optional str>item['actor_id'],
      role := <optional str>item['role'],
      memory_type := <optional str>item['memory_type'],
      metadata := <optional json>item['metadata']
      }
      )
    `;
    await this.client.query(query, { data: bulkData });
  }

  async search(
    query: number[],
    limit: number = 5,
    filters?: SearchFilters,
  ): Promise<VectorStoreResult[]> {
    if (!query || query.length === 0) {
      return [];
    }

    // Build filter conditions
    const filterConditions: string[] = [];
    const queryParams: Record<string, any> = {
      query_vector: query,
      limit: limit,
    };

    if (filters) {
      if (filters.userId) {
        filterConditions.push(".user_id = <optional str>$user_id");
        queryParams.user_id = filters.userId;
      }
      if (filters.agentId) {
        filterConditions.push(".agent_id = <optional str>$agent_id");
        queryParams.agent_id = filters.agentId;
      }
      if (filters.runId) {
        filterConditions.push(".run_id = <optional str>$run_id");
        queryParams.run_id = filters.runId;
      }
      if (filters.actor_id) {
        filterConditions.push(".actor_id = <optional str>$actor_id");
        queryParams.actor_id = filters.actor_id;
      }
      if (filters.role) {
        filterConditions.push(".role = <optional str>$role");
        queryParams.role = filters.role;
      }
    }

    const filterClause =
      filterConditions.length > 0
        ? `FILTER ${filterConditions.join(" AND ")}`
        : "";

    // Use Gel's ext::ai vector similarity search
    const searchQuery = `
      SELECT ${this.fullyQualifiedType} {
        mem0_id,
        content,
        hash,
        created_at,
        updated_at,
        user_id,
        agent_id,
        run_id,
        actor_id,
        role,
        memory_type,
        metadata,
        distance := ext::pgvector::cosine_distance(.embedding, <mem0::OpenAIEmbedding><array<float32>>$query_vector)
      }
      ${filterClause}
      ORDER BY .distance
      LIMIT <int32>$limit
    `;

    const results = await this.client.query<{
      mem0_id: string;
      content: string;
      hash: string;
      created_at: Date | null;
      updated_at: Date | null;
      user_id: string | null;
      agent_id: string | null;
      run_id: string | null;
      actor_id: string | null;
      role: string | null;
      memory_type: string | null;
      metadata: any;
    }>(searchQuery, queryParams);

    return results.map((result) => {
      const payload: Record<string, any> = {
        id: result.mem0_id,
        data: result.content,
        hash: result.hash,
        createdAt: result.created_at?.toISOString(),
        updatedAt: result.updated_at?.toISOString(),
        userId: result.user_id,
        agentId: result.agent_id,
        runId: result.run_id,
        actorId: result.actor_id,
        role: result.role,
        memoryType: result.memory_type,
      };

      if (result.metadata) {
        Object.assign(payload, result.metadata);
      }

      return {
        id: result.mem0_id,
        payload: payload,
        score: 1.0, // Gel doesn't return distance directly, would need to calculate
      };
    });
  }

  async get(vectorId: string): Promise<VectorStoreResult | null> {
    const result = await this.client.querySingle<{
      mem0_id: string;
      content: string;
      embedding: number[];
      hash: string;
      created_at: Date | null;
      updated_at: Date | null;
      user_id: string | null;
      agent_id: string | null;
      run_id: string | null;
      actor_id: string | null;
      role: string | null;
      memory_type: string | null;
      metadata: any;
    }>(
      `
      SELECT ${this.fullyQualifiedType} {
        mem0_id,
        content,
        embedding,
        hash,
        created_at,
        updated_at,
        user_id,
        agent_id,
        run_id,
        actor_id,
        role,
        memory_type,
        metadata
      }
      FILTER .mem0_id = <str>$vector_id
    `,
      {
        vector_id: vectorId,
      },
    );

    if (!result) {
      return null;
    }

    const payload: Record<string, any> = {
      data: result.content,
      hash: result.hash,
      created_at: result.created_at?.toISOString(),
      updated_at: result.updated_at?.toISOString(),
      user_id: result.user_id,
      agent_id: result.agent_id,
      run_id: result.run_id,
      actor_id: result.actor_id,
      role: result.role,
      memory_type: result.memory_type,
    };

    if (result.metadata) {
      Object.assign(payload, result.metadata);
    }

    return {
      id: result.mem0_id,
      payload: payload,
      score: 1.0, // Perfect match since we're getting by ID
    };
  }

  async update(
    vectorId: string,
    vector: number[],
    payload: Record<string, any>,
  ): Promise<void> {
    if (!vector && !payload) {
      return;
    }

    // Build update query
    const updateFields: string[] = ["updated_at := datetime_current()"];
    const queryParams: Record<string, any> = {
      vector_id: vectorId,
    };

    if (vector) {
      updateFields.push(
        "embedding := <mem0::OpenAIEmbedding><array<float32>>$embedding",
      );
      queryParams.embedding = vector;
    }

    if (payload) {
      if (payload.data) {
        updateFields.push("content := <str>$content");
        queryParams.content = payload.data;
      }
      if (payload.hash) {
        updateFields.push("hash := <str>$hash");
        queryParams.hash = payload.hash;
      }
      if (payload.user_id) {
        updateFields.push("user_id := <optional str>$user_id");
        queryParams.user_id = payload.user_id;
      }
      if (payload.agent_id) {
        updateFields.push("agent_id := <optional str>$agent_id");
        queryParams.agent_id = payload.agent_id;
      }
      if (payload.run_id) {
        updateFields.push("run_id := <optional str>$run_id");
        queryParams.run_id = payload.run_id;
      }
      if (payload.actor_id) {
        updateFields.push("actor_id := <optional str>$actor_id");
        queryParams.actor_id = payload.actor_id;
      }
      if (payload.role) {
        updateFields.push("role := <optional str>$role");
        queryParams.role = payload.role;
      }
      if (payload.memory_type) {
        updateFields.push("memory_type := <optional str>$memory_type");
        queryParams.memory_type = payload.memory_type;
      }
      if (payload.metadata) {
        updateFields.push("metadata := <optional json>$metadata");
        queryParams.metadata = payload.metadata;
      }
    }

    const updateQuery = `
      UPDATE ${this.fullyQualifiedType}
      FILTER .mem0_id = <str>$vector_id
      SET {
        ${updateFields.join(", ")}
      }
    `;

    await this.client.query(updateQuery, queryParams);
  }

  async delete(vectorId: string): Promise<void> {
    await this.client.query(
      `
      DELETE ${this.fullyQualifiedType}
      FILTER .mem0_id = <str>$vector_id
    `,
      {
        vector_id: vectorId,
      },
    );
  }

  async deleteCol(): Promise<void> {
    // Gel types are defined at the schema level and cannot be deleted at runtime.
    // Instead, we'll clear all data from the collection using reset()
    await this.reset();
  }

  private async colInfo(): Promise<Record<string, any>> {
    const result = await this.client.querySingle<{
      memory_count: number;
    }>(`
      SELECT {
        memory_count := count((SELECT ${this.fullyQualifiedType})),
      }
    `);

    return {
      collection_name: this.fullyQualifiedType,
      memory_count: result?.memory_count,
      embedding_dims: this.embeddingModelDims,
    };
  }

  async list(
    filters?: SearchFilters,
    limit: number = 100,
  ): Promise<[VectorStoreResult[], number]> {
    // Build filter conditions
    const filterConditions: string[] = [];
    const queryParams: Record<string, any> = {};

    if (filters) {
      if (filters.userId) {
        filterConditions.push(".user_id = <optional str>$user_id");
        queryParams.user_id = filters.userId;
      }
      if (filters.agentId) {
        filterConditions.push(".agent_id = <optional str>$agent_id");
        queryParams.agent_id = filters.agentId;
      }
      if (filters.runId) {
        filterConditions.push(".run_id = <optional str>$run_id");
        queryParams.run_id = filters.runId;
      }
    }

    const filterClause =
      filterConditions.length > 0
        ? `FILTER ${filterConditions.join(" AND ")}`
        : "";

    const limitClause = limit ? `LIMIT <int32>$limit` : "";

    if (limit) {
      queryParams.limit = limit;
    }

    const listQuery = `
      SELECT ${this.fullyQualifiedType} {
        mem0_id,
        content,
        hash,
        created_at,
        updated_at,
        user_id,
        agent_id,
        run_id,
        actor_id,
        role,
        memory_type,
        metadata
      }
      ${filterClause}
      ORDER BY .created_at DESC
      ${limitClause}
    `;

    const results = await this.client.query<{
      mem0_id: string;
      content: string;
      hash: string;
      created_at: Date | null;
      updated_at: Date | null;
      user_id: string | null;
      agent_id: string | null;
      run_id: string | null;
      actor_id: string | null;
      role: string | null;
      memory_type: string | null;
      metadata: any;
    }>(listQuery, queryParams);

    const outputData = results.map((result) => {
      const payload: Record<string, any> = {
        data: result.content,
        hash: result.hash,
        created_at: result.created_at?.toISOString(),
        user_id: result.user_id,
        agent_id: result.agent_id,
        run_id: result.run_id,
        actor_id: result.actor_id,
        role: result.role,
        memory_type: result.memory_type,
      };

      if (result.metadata) {
        Object.assign(payload, result.metadata);
      }

      return {
        id: result.mem0_id,
        payload: payload,
        score: 1.0,
      };
    });

    return [outputData, outputData.length];
  }

  async getUserId(): Promise<string> {
    // Use mem0::Migration type (equivalent to memory_migrations table in pgvector)
    try {
      const result = await this.client.querySingle<{
        user_id: string;
      }>(`
        SELECT mem0::Migration {
          user_id
        }
        LIMIT 1
      `);

      if (result?.user_id) {
        return result.user_id;
      }
    } catch (error) {
      // Could not query mem0::Migration type for user_id
    }

    // Generate a random user_id if none exists
    const randomUserId =
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);

    try {
      await this.client.query(
        `
        INSERT mem0::Migration {
          user_id := <str>$user_id
        }
      `,
        { user_id: randomUserId },
      );
    } catch (error) {
      // Could not insert into mem0::Migration type
    }

    return randomUserId;
  }

  async setUserId(userId: string): Promise<void> {
    // Clear existing user_id and set new one (like pgvector implementation)
    try {
      await this.client.query(`DELETE mem0::Migration`);
      await this.client.query(
        `
        INSERT mem0::Migration {
          user_id := <str>$user_id
        }
      `,
        { user_id: userId },
      );
    } catch (error) {
      // Could not update mem0::Migration type
    }
  }

  async reset(): Promise<void> {
    const deleteQuery = `DELETE ${this.fullyQualifiedType}`;
    await this.client.query(deleteQuery);
  }
}
