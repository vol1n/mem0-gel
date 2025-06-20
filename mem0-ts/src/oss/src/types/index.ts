import { z } from "zod";

export interface MultiModalMessages {
  type: "image_url";
  image_url: {
    url: string;
  };
}

export interface Message {
  role: string;
  content: string | MultiModalMessages;
  name?: string;
}

export interface EmbeddingConfig {
  apiKey?: string;
  model?: string | any;
  url?: string;
  modelProperties?: Record<string, any>;
}

export interface VectorStoreConfig {
  collectionName?: string;
  dimension?: number;
  client?: any;
  instance?: any;
  [key: string]: any;
}

export interface HistoryStoreConfig {
  provider: string;
  config: {
    historyDbPath?: string;
    supabaseUrl?: string;
    supabaseKey?: string;
    tableName?: string;
  };
}

export interface LLMConfig {
  provider?: string;
  baseURL?: string;
  config?: Record<string, any>;
  apiKey?: string;
  model?: string | any;
  modelProperties?: Record<string, any>;
}

export interface Neo4jConfig {
  url: string;
  username: string;
  password: string;
}

export interface GelGraphConfig {
  dimension: number;
  client?: any; // GEL client type
  dsn?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  tlsCaFile?: string;
  tlsSecurity?: string;
  collectionName?: string;
}

export interface GraphStoreConfig {
  provider: string;
  config: Neo4jConfig | GelGraphConfig;
  llm?: LLMConfig;
  customPrompt?: string;
}

export interface MemoryConfig {
  version?: string;
  embedder: {
    provider: string;
    config: EmbeddingConfig;
  };
  vectorStore: {
    provider: string;
    config: VectorStoreConfig;
  };
  llm: {
    provider: string;
    config: LLMConfig;
  };
  historyStore?: HistoryStoreConfig;
  disableHistory?: boolean;
  historyDbPath?: string;
  customPrompt?: string;
  graphStore?: GraphStoreConfig;
  enableGraph?: boolean;
}

export interface MemoryItem {
  id: string;
  memory: string;
  hash?: string;
  createdAt?: string;
  updatedAt?: string;
  score?: number;
  metadata?: Record<string, any>;
}

export interface SearchFilters {
  userId?: string;
  agentId?: string;
  runId?: string;
  [key: string]: any;
}

export interface GraphRelation {
  source: string;
  relationship: string;
  destination: string;
}

export interface SearchResult {
  results: MemoryItem[];
  relations?: GraphRelation[];
}

export interface VectorStoreResult {
  id: string;
  payload: Record<string, any>;
  score?: number;
}

export const MemoryConfigSchema = z.object({
  version: z.string().optional(),
  embedder: z.object({
    provider: z.string(),
    config: z.object({
      modelProperties: z.record(z.string(), z.any()).optional(),
      apiKey: z.string().optional(),
      model: z.union([z.string(), z.any()]).optional(),
      baseURL: z.string().optional(),
    }),
  }),
  vectorStore: z.object({
    provider: z.string(),
    config: z
      .object({
        collectionName: z.string().optional(),
        dimension: z.number().optional(),
        client: z.any().optional(),
      })
      .passthrough(),
  }),
  llm: z.object({
    provider: z.string(),
    config: z.object({
      apiKey: z.string().optional(),
      model: z.union([z.string(), z.any()]).optional(),
      modelProperties: z.record(z.string(), z.any()).optional(),
      baseURL: z.string().optional(),
    }),
  }),
  historyDbPath: z.string().optional(),
  customPrompt: z.string().optional(),
  enableGraph: z.boolean().optional(),
  graphStore: z
    .object({
      provider: z.string(),
      config: z.union([
        z.object({
          url: z.string(),
          username: z.string(),
          password: z.string(),
        }),
        z.object({
          dimension: z.number(),
          client: z.any().optional(),
          dsn: z.string().optional(),
          host: z.string().optional(),
          port: z.number().optional(),
          database: z.string().optional(),
          user: z.string().optional(),
          password: z.string().optional(),
          tlsCaFile: z.string().optional(),
          tlsSecurity: z.string().optional(),
          collectionName: z.string().optional(),
        }),
      ]),
      llm: z
        .object({
          provider: z.string(),
          config: z.record(z.string(), z.any()),
        })
        .optional(),
      customPrompt: z.string().optional(),
    })
    .optional(),
  historyStore: z
    .object({
      provider: z.string(),
      config: z.record(z.string(), z.any()),
    })
    .optional(),
  disableHistory: z.boolean().optional(),
});
