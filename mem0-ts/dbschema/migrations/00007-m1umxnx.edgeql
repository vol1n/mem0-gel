CREATE MIGRATION m1umxnx7t7gf3f7nhu3ja2qdm5ekqvcgpdcnaf6v7htynnt3l3uhvq
    ONTO m1qajpk7jmwpzgk25js45vgfnqstrzr37iqsdrhpqfe3souefwwllq
{
  ALTER TYPE mem0::GraphRelationImpl {
      CREATE OPTIONAL PROPERTY metadata: std::json;
  };
};
