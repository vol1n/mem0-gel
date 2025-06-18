CREATE MIGRATION m1qajpk7jmwpzgk25js45vgfnqstrzr37iqsdrhpqfe3souefwwllq
    ONTO m1w4ubzfjdbci5dtjb2hoka234bnbahoy3outye4juijlzmwwtxvrq
{
  CREATE ABSTRACT TYPE mem0::GraphEntityImpl {
      CREATE REQUIRED PROPERTY created_at: std::datetime {
          SET default := (std::datetime_current());
      };
      CREATE REQUIRED PROPERTY embedding: mem0::OpenAIEmbedding;
      CREATE REQUIRED PROPERTY entity_type: std::str;
      CREATE REQUIRED PROPERTY name: std::str;
      CREATE OPTIONAL PROPERTY updated_at: std::datetime;
      CREATE REQUIRED PROPERTY user_id: std::str;
      CREATE CONSTRAINT std::exclusive ON ((.name, .user_id));
      CREATE INDEX ext::pgvector::hnsw_cosine ON (.embedding);
  };
  CREATE TYPE mem0::GraphEntity EXTENDING mem0::GraphEntityImpl;
  CREATE ABSTRACT TYPE mem0::GraphRelationImpl {
      CREATE REQUIRED PROPERTY created_at: std::datetime {
          SET default := (std::datetime_current());
      };
      CREATE REQUIRED PROPERTY relationship_type: std::str;
      CREATE OPTIONAL PROPERTY updated_at: std::datetime;
  };
  CREATE TYPE mem0::GraphRelation EXTENDING mem0::GraphRelationImpl {
      CREATE REQUIRED LINK source: mem0::GraphEntity;
      CREATE REQUIRED LINK target: mem0::GraphEntity;
      CREATE CONSTRAINT std::exclusive ON ((.source, .target, .relationship_type));
  };
  CREATE TYPE mem0::TestMemoriesGraphEntity EXTENDING mem0::GraphEntityImpl;
  CREATE TYPE mem0::TestMemoriesGraphRelation EXTENDING mem0::GraphRelationImpl {
      CREATE REQUIRED LINK source: mem0::TestMemoriesGraphEntity;
      CREATE REQUIRED LINK target: mem0::TestMemoriesGraphEntity;
      CREATE CONSTRAINT std::exclusive ON ((.source, .target, .relationship_type));
  };
};
