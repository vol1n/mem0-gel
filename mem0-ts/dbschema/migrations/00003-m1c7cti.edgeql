CREATE MIGRATION m1c7ctiszifds37wnzitqif5hrqdqbgclvks5via5pn4kl77jzwnsq
    ONTO m1gh2i2e2imkviwjqekxffpkvel7eewilvm3umpr722h7y3c2g2zwa
{
  CREATE TYPE mem0::Migration {
      CREATE REQUIRED PROPERTY created_at: std::datetime {
          SET default := (std::datetime_current());
      };
      CREATE REQUIRED PROPERTY user_id: std::str {
          CREATE CONSTRAINT std::exclusive;
      };
  };
};
