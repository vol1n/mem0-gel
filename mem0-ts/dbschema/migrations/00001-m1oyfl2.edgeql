CREATE MIGRATION m1oyfl2zkaq74k7g4hrinc7es4rc2mgqgqmjjznugks4f2u46fgtaa
    ONTO initial
{
  CREATE EXTENSION pgvector VERSION '0.7';
  CREATE MODULE mem0 IF NOT EXISTS;
  CREATE SCALAR TYPE mem0::OpenAIEmbedding EXTENDING ext::pgvector::vector<1536>;
  CREATE FUTURE simple_scoping;
  CREATE ABSTRACT TYPE mem0::MemoryImpl {
      CREATE OPTIONAL PROPERTY actor_id: std::str;
      CREATE OPTIONAL PROPERTY agent_id: std::str;
      CREATE REQUIRED PROPERTY content: std::str;
      CREATE REQUIRED PROPERTY created_at: std::datetime {
          SET default := (std::datetime_current());
      };
      CREATE REQUIRED PROPERTY embedding: mem0::OpenAIEmbedding;
      CREATE REQUIRED PROPERTY hash: std::str;
      CREATE OPTIONAL PROPERTY memory_type: std::str;
      CREATE OPTIONAL PROPERTY metadata: std::json;
      CREATE OPTIONAL PROPERTY role: std::str;
      CREATE OPTIONAL PROPERTY run_id: std::str;
      CREATE OPTIONAL PROPERTY user_id: std::str;
      CREATE INDEX ext::pgvector::hnsw_cosine ON (.embedding);
  };
  CREATE TYPE mem0::Memory EXTENDING mem0::MemoryImpl;
  CREATE TYPE mem0::Migration EXTENDING mem0::MemoryImpl;
};
