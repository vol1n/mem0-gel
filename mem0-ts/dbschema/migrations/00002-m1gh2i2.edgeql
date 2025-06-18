CREATE MIGRATION m1gh2i2e2imkviwjqekxffpkvel7eewilvm3umpr722h7y3c2g2zwa
    ONTO m1oyfl2zkaq74k7g4hrinc7es4rc2mgqgqmjjznugks4f2u46fgtaa
{
  DROP TYPE mem0::Migration;
  CREATE TYPE mem0::TestMemories EXTENDING mem0::MemoryImpl;
};
