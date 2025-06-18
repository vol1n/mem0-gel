CREATE MIGRATION m1rnojvox66a63ocum3rehkaqs4uioa7eq7skwrefcsx3fteaitiba
    ONTO m1c7ctiszifds37wnzitqif5hrqdqbgclvks5via5pn4kl77jzwnsq
{
  ALTER TYPE mem0::MemoryImpl {
      CREATE OPTIONAL PROPERTY updated_at: std::datetime;
  };
};
